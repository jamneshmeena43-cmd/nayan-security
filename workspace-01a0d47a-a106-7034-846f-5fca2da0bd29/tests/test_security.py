import hashlib
import hmac
import json
import os
import uuid

import pytest
from fastapi.testclient import TestClient

os.environ["PYTEST_CURRENT_TEST"] = "security"
os.environ["DATABASE_URL"] = "sqlite:////tmp/nayan-security-test.db"
os.environ["PAYMENT_WEBHOOK_SECRET"] = "test-webhook-secret"
os.environ["ADMIN_EMAIL"] = "security-admin@example.com"
os.environ["ADMIN_PASSWORD"] = "AdminTest123"
os.environ["BCRYPT_ROUNDS"] = "4"
os.environ["LOGIN_IP_LIMIT"] = "500"
os.environ["REGISTER_IP_LIMIT"] = "500"
os.environ.pop("RAZORPAY_KEY_SECRET", None)
os.environ.pop("RAZORPAY_KEY_ID", None)

if os.path.exists("/tmp/nayan-security-test.db"):
    os.remove("/tmp/nayan-security-test.db")

from backend.main import create_app
from backend.models import User

app = create_app()
client = TestClient(app)


def csrf(c: TestClient) -> str:
    me = c.get("/api/auth/me")
    assert me.status_code == 200
    return me.json()["csrf"]


def login(email, password) -> TestClient:
    c = TestClient(app)
    res = c.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return c


def register(email, password="Customer123", account_type="customer", **extra):
    c = TestClient(app)
    res = c.post("/api/auth/register", json={
        "name": extra.pop("name", "Test User"),
        "email": email,
        "phone": extra.pop("phone", ""),
        "password": password,
        "account_type": account_type,
        **extra,
    })
    assert res.status_code == 200, res.text
    return c, res.json()


def test_password_is_hashed_and_health_has_no_secrets():
    email = f"hash-{uuid.uuid4().hex[:8]}@example.com"
    register(email, password="HashCheck123")
    db = app.state.session_factory()
    user = db.query(User).filter(User.email == email).one()
    assert user.password_hash != "HashCheck123"
    assert user.password_hash.startswith("$2")
    db.close()
    health = client.get("/api/health")
    assert health.status_code == 200
    assert "secret" not in health.text.lower()
    assert "HashCheck123" not in health.text


def test_login_failure_does_not_reveal_account_and_locks():
    email = f"lock-{uuid.uuid4().hex[:8]}@example.com"
    register(email)
    missing = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-pass-1"})
    bad = client.post("/api/auth/login", json={"email": email, "password": "wrong-pass-1"})
    assert missing.status_code == 401
    assert bad.status_code == 401
    assert missing.json()["error"] == bad.json()["error"]
    for _ in range(4):
        client.post("/api/auth/login", json={"email": email, "password": "wrong-pass-1"})
    locked = client.post("/api/auth/login", json={"email": email, "password": "Customer123"})
    assert locked.status_code == 401


def test_logout_revokes_session():
    c, _ = register(f"out-{uuid.uuid4().hex[:8]}@example.com")
    assert c.get("/api/auth/me").json()["user"]
    token = csrf(c)
    assert c.post("/api/auth/logout", headers={"X-CSRF-Token": token}).status_code == 200
    assert c.get("/api/auth/me").json()["user"] is None


def test_hidden_admin_route_requires_auth_and_rbac():
    assert client.get("/api/admin/security").status_code == 401
    customer, _ = register(f"cust-{uuid.uuid4().hex[:8]}@example.com")
    assert customer.get("/api/admin/security").status_code == 403
    admin = login("security-admin@example.com", "AdminTest123")
    assert admin.get("/api/admin/security").status_code == 200
    body = admin.get("/api/admin/security").json()
    assert "sessions" in body
    dumped = json.dumps(body)
    assert "password" not in dumped.lower()
    assert "token_hash" not in dumped
    token = csrf(admin)
    support = admin.post("/api/admin/users", headers={"X-CSRF-Token": token}, json={
        "name": "Support",
        "email": f"support-{uuid.uuid4().hex[:6]}@example.com",
        "password": "Support1234",
        "admin_role": "SUPPORT_ADMIN",
    })
    assert support.status_code == 200, support.text
    email = support.request.url  # keep the request object referenced
    del email
    created_email = f"support-view-{uuid.uuid4().hex[:6]}@example.com"
    created = admin.post("/api/admin/users", headers={"X-CSRF-Token": csrf(admin)}, json={
        "name": "Support view",
        "email": created_email,
        "password": "Support1234",
        "admin_role": "SUPPORT_ADMIN",
    })
    assert created.status_code == 200, created.text
    support_client = login(created_email, "Support1234")
    assert support_client.get("/api/admin/security").status_code == 200


def test_support_cannot_change_commission_or_read_other_roles_beyond_permission():
    admin = login("security-admin@example.com", "AdminTest123")
    email = f"fin-{uuid.uuid4().hex[:6]}@example.com"
    support_email = f"sup-{uuid.uuid4().hex[:6]}@example.com"
    token = csrf(admin)
    assert admin.post("/api/admin/users", headers={"X-CSRF-Token": token}, json={
        "name": "Finance", "email": email, "password": "Finance1234", "admin_role": "FINANCE_ADMIN",
    }).status_code == 200
    assert admin.post("/api/admin/users", headers={"X-CSRF-Token": token}, json={
        "name": "Support", "email": support_email, "password": "Support1234", "admin_role": "SUPPORT_ADMIN",
    }).status_code == 200
    support = login(support_email, "Support1234")
    denied = support.post("/api/commission-rules", headers={"X-CSRF-Token": csrf(support)}, json={
        "scope": "global", "scope_id": "*", "rate_bps": 1000,
    })
    assert denied.status_code == 403
    finance = login(email, "Finance1234")
    allowed = finance.post("/api/commission-rules", headers={"X-CSRF-Token": csrf(finance)}, json={
        "scope": "global", "scope_id": "*", "rate_bps": 1000,
    })
    assert allowed.status_code == 200, allowed.text
    product_email = f"pm-{uuid.uuid4().hex[:6]}@example.com"
    assert admin.post("/api/admin/users", headers={"X-CSRF-Token": csrf(admin)}, json={
        "name": "Products", "email": product_email, "password": "Product1234", "admin_role": "PRODUCT_MANAGER",
    }).status_code == 200
    product_admin = login(product_email, "Product1234")
    assert product_admin.get("/api/orders").status_code == 403


def _order(c: TestClient, product="dome-2mp", qty=1, extra=None):
    body = {
        "items": [{"product_id": product, "qty": qty, "install": False, "price_paise": 100}],
        "delivery": "pickup",
        "address": {"name": "Asha", "phone": "9876543210", "line": "Station Road", "area": "Kote Gate", "pincode": "334001"},
        "total_paise": 100,
        "commission_paise": 0,
    }
    if extra:
        body.update(extra)
    return c.post("/api/orders", headers={"X-CSRF-Token": csrf(c), "Idempotency-Key": uuid.uuid4().hex}, json=body)


def test_price_tamper_and_idor_and_csrf():
    owner, _ = register(f"own-{uuid.uuid4().hex[:8]}@example.com")
    other, _ = register(f"oth-{uuid.uuid4().hex[:8]}@example.com")
    missing = owner.post("/api/orders", json={"items": [{"product_id": "dome-2mp", "qty": 1}], "delivery": "pickup", "address": {"name": "A", "line": "B"}})
    assert missing.status_code == 403
    created = _order(owner)
    assert created.status_code == 200, created.text
    assert created.json()["total_paise"] == 204900
    assert created.json()["goods_paise"] == 204900
    fetched = other.get(f"/api/orders/{created.json()['id']}")
    assert fetched.status_code == 404
    injected = other.get("/api/orders/' OR 1=1 --")
    assert injected.status_code in {404, 401}
    assert "sql" not in injected.text.lower()


def test_payment_frontend_success_is_rejected_and_webhook_is_idempotent():
    buyer, _ = register(f"pay-{uuid.uuid4().hex[:8]}@example.com")
    order = _order(buyer, product="psu-12v")
    assert order.status_code == 200, order.text
    oid = order.json()["id"]
    total = order.json()["total_paise"]
    initiated = buyer.post("/api/payments/initiate", headers={"X-CSRF-Token": csrf(buyer)}, json={"order_id": oid})
    assert initiated.status_code == 503
    assert initiated.json()["error"] == "gateway_not_configured"
    fake = buyer.post("/api/payments/confirm", headers={"X-CSRF-Token": csrf(buyer)}, json={
        "order_id": oid, "success": True, "provider_payment_id": "pay_fake", "provider_order_id": "ord_fake",
    })
    assert fake.status_code == 400
    still = buyer.get(f"/api/orders/{oid}")
    assert still.json()["payment_status"] == "UNPAID"
    payload = {"event_id": "evt-" + uuid.uuid4().hex, "order_id": oid, "payment_id": "pay-" + uuid.uuid4().hex, "amount_paise": total, "status": "paid"}
    raw = json.dumps(payload).encode()
    sig = hmac.new(b"test-webhook-secret", raw, hashlib.sha256).hexdigest()
    bad = client.post("/api/payments/webhook", content=raw, headers={"X-Nayan-Signature": "deadbeef", "Content-Type": "application/json"})
    assert bad.status_code == 401
    good = client.post("/api/payments/webhook", content=raw, headers={"X-Nayan-Signature": sig, "Content-Type": "application/json"})
    assert good.status_code == 200, good.text
    again = client.post("/api/payments/webhook", content=raw, headers={"X-Nayan-Signature": sig, "Content-Type": "application/json"})
    assert again.status_code == 200
    assert again.json()["duplicate"] is True
    paid = buyer.get(f"/api/orders/{oid}").json()
    assert paid["payment_status"] == "PAID"
    finance = login("security-admin@example.com", "AdminTest123")
    # super admin has * so refunds.manage works
    refund = finance.post("/api/refunds", headers={"X-CSRF-Token": csrf(finance)}, json={
        "order_id": oid, "amount_paise": 10000, "reason": "test partial",
    })
    assert refund.status_code == 200, refund.text
    settlements = finance.get("/api/settlements")
    assert settlements.status_code == 200
    match = [row for row in settlements.json()["settlements"] if row["order_id"] == oid]
    assert match
    assert match[0]["status"] == "ON_HOLD"
    assert match[0]["refund_paise"] == 10000


def test_seller_cannot_edit_another_sellers_product():
    seller, _ = register(f"sel-{uuid.uuid4().hex[:8]}@example.com", account_type="seller", shop_name="Own Shop")
    admin = login("security-admin@example.com", "AdminTest123")
    me = seller.get("/api/auth/me").json()["user"]["id"]
    approved = admin.post(f"/api/providers/{me}/verification", headers={"X-CSRF-Token": csrf(admin)}, json={"status": "APPROVED"})
    assert approved.status_code == 200, approved.text
    created = seller.post("/api/products", headers={"X-CSRF-Token": csrf(seller)}, json={
        "id": "own-" + uuid.uuid4().hex[:8], "name": "Own camera", "price_paise": 50000, "stock": 2,
    })
    assert created.status_code == 200, created.text
    other, _ = register(f"sel2-{uuid.uuid4().hex[:8]}@example.com", account_type="seller")
    other_id = other.get("/api/auth/me").json()["user"]["id"]
    admin.post(f"/api/providers/{other_id}/verification", headers={"X-CSRF-Token": csrf(admin)}, json={"status": "APPROVED"})
    stolen = other.patch(f"/api/products/{created.json()['id']}", headers={"X-CSRF-Token": csrf(other)}, json={"price_paise": 1})
    assert stolen.status_code == 404


def test_upload_rejects_executables_and_ignores_filename():
    user, _ = register(f"up-{uuid.uuid4().hex[:8]}@example.com")
    token = csrf(user)
    evil = user.post("/api/uploads", headers={"X-CSRF-Token": token}, files={"file": ("evil.jpg.exe", b"MZ\x00\x00fake", "image/jpeg")}, data={"purpose": "site-photo"})
    assert evil.status_code == 400
    html = user.post("/api/uploads", headers={"X-CSRF-Token": token}, files={"file": ("note.jpg", b"<html><script>alert(1)</script>", "image/jpeg")}, data={"purpose": "site-photo"})
    assert html.status_code == 400
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
    good = user.post("/api/uploads", headers={"X-CSRF-Token": token}, files={"file": ("../../etc/passwd.jpg", jpeg, "image/jpeg")}, data={"purpose": "site-photo"})
    assert good.status_code == 200, good.text
    assert "passwd" not in good.json()["id"]
    downloaded = user.get(f"/api/uploads/{good.json()['id']}")
    assert downloaded.status_code == 200
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert downloaded.headers["content-type"].startswith("image/jpeg")
    stranger, _ = register(f"str-{uuid.uuid4().hex[:8]}@example.com")
    assert stranger.get(f"/api/uploads/{good.json()['id']}").status_code == 404


def test_security_headers_and_static_secret_files_are_not_public():
    home = client.get("/")
    assert home.status_code == 200
    csp = home.headers["content-security-policy"]
    assert "frame-ancestors" in csp
    assert "object-src 'none'" in csp
    assert home.headers["x-content-type-options"] == "nosniff"
    assert "x-frame-options" not in {k.lower() for k in home.headers}
    assert client.get("/.env").status_code == 404
    assert client.get("/backend/config.py").status_code == 404
    assert client.get("/data/nayan.db").status_code == 404


def test_xss_name_is_stripped_and_audit_has_no_password():
    email = f"xss-{uuid.uuid4().hex[:8]}@example.com"
    c, body = register(email, name="<script>alert(1)</script>")
    assert "<script>" not in body["user"]["name"]
    admin = login("security-admin@example.com", "AdminTest123")
    overview = admin.get("/api/admin/security").json()
    blob = json.dumps(overview)
    assert "AdminTest123" not in blob
    assert "Customer123" not in blob


def test_backup_file_is_created_and_recoverable(tmp_path):
    from backend.backup import create_backup, restore_backup
    admin = login("security-admin@example.com", "AdminTest123")
    created = admin.post("/api/admin/backups", headers={"X-CSRF-Token": csrf(admin)})
    assert created.status_code == 200, created.text
    name = created.json()["file"]
    assert name.startswith("nayan-")
    path = os.path.join(app.state.settings.root_dir, "data", "backups", name)
    assert os.path.isfile(path)
    # Recovery function rejects paths outside the backup folder.
    with pytest.raises(RuntimeError):
        restore_backup("/etc/passwd", app.state.settings.database_url, app.state.settings.root_dir)
    assert create_backup(app.state.settings.database_url, app.state.settings.root_dir)
