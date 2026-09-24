import json

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from backend.audit import audit, security_event
from backend.catalog import DELIVERY_HOME_PAISE, INSTALL_EACH_PAISE
from backend.deps import (
    db_session, hit_limit, require_csrf, require_permission, require_user, request_ip,
)
from backend.models import (
    CommissionRule, Order, OrderItem, Payment, Product, ProfessionalProfile,
    Refund, SellerProfile, Settlement, User, WebhookEvent,
)
from backend.security import PRODUCT_STATUSES, SERVICE_STATUSES, SLUG_RE, clean_text, signatures_match

router = APIRouter(prefix="/api", tags=["commerce"])


def _order_out(order: Order, include_address: bool) -> dict:
    data = {
        "id": order.id,
        "order_type": order.order_type,
        "status": order.status,
        "payment_status": order.payment_status,
        "goods_paise": order.goods_paise,
        "install_paise": order.install_paise,
        "delivery_paise": order.delivery_paise,
        "tax_paise": order.tax_paise,
        "total_paise": order.total_paise,
        "currency": order.currency,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "items": [
            {
                "product_id": item.product_id,
                "name": item.name,
                "qty": item.qty,
                "unit_paise": item.unit_paise,
                "install": item.install,
                "seller_code": item.seller_code,
            }
            for item in order.items
        ],
    }
    if include_address:
        data["address"] = json.loads(order.address_json or "{}")
    return data


def _owns_seller_line(db: Session, user: User, order: Order) -> bool:
    profile = db.query(SellerProfile).filter(SellerProfile.user_id == user.id).one_or_none()
    if profile is None:
        return False
    return any(item.seller_code == profile.shop_code for item in order.items)


def _can_read_order(db: Session, user: User, order: Order) -> bool:
    if order.customer_id == user.id:
        return True
    if user.account_type == "professional" and order.assigned_professional_id == user.id:
        return True
    if user.account_type == "seller" and _owns_seller_line(db, user, order):
        return True
    if user.account_type == "admin" and (
        require_permission_bool(user, "orders.read") or require_permission_bool(user, "payments.read")
    ):
        return True
    return False


def require_permission_bool(user, perm: str) -> bool:
    from backend.security import has_permission
    return has_permission(user, perm)


@router.post("/orders")
def create_order(payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    if user.account_type != "customer":
        raise HTTPException(status_code=403, detail="customers_only")
    if hit_limit(f"order:{user.id}", 30, 3600):
        raise HTTPException(status_code=429, detail="rate_limited")
    key = clean_text(request.headers.get("idempotency-key") or payload.get("idempotency_key") or "", 80)
    if key:
        existing = db.query(Order).filter(Order.customer_id == user.id, Order.idempotency_key == key).one_or_none()
        if existing:
            return _order_out(existing, True)
    items = payload.get("items")
    if not isinstance(items, list) or not items or len(items) > 20:
        raise HTTPException(status_code=400, detail="invalid_items")
    delivery = payload.get("delivery") if payload.get("delivery") in {"pickup", "home"} else None
    if delivery is None:
        raise HTTPException(status_code=400, detail="invalid_delivery")
    address = {
        "name": clean_text((payload.get("address") or {}).get("name"), 120),
        "phone": clean_text((payload.get("address") or {}).get("phone"), 16),
        "line": clean_text((payload.get("address") or {}).get("line"), 240),
        "area": clean_text((payload.get("address") or {}).get("area"), 80),
        "pincode": clean_text((payload.get("address") or {}).get("pincode"), 6),
    }
    if not address["name"] or not address["line"]:
        raise HTTPException(status_code=400, detail="invalid_address")
    goods = 0
    install_total = 0
    built = []
    for raw in items:
        pid = str(raw.get("product_id") or "")
        if not SLUG_RE.match(pid):
            raise HTTPException(status_code=400, detail="invalid_product")
        try:
            qty = int(raw.get("qty"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="invalid_qty")
        if qty < 1 or qty > 20:
            raise HTTPException(status_code=400, detail="invalid_qty")
        product = db.query(Product).filter(Product.id == pid).one_or_none()
        if product is None or product.status != "PUBLISHED":
            raise HTTPException(status_code=400, detail="invalid_product")
        if product.stock < qty:
            raise HTTPException(status_code=409, detail="insufficient_stock")
        product.stock -= qty
        install = bool(raw.get("install"))
        line = product.price_paise * qty
        install_line = INSTALL_EACH_PAISE * qty if install else 0
        goods += line
        install_total += install_line
        built.append((product, qty, install, line + install_line))
    delivery_paise = DELIVERY_HOME_PAISE if delivery == "home" else 0
    settings = request.app.state.settings
    taxable = goods + install_total + delivery_paise
    tax = 0 if settings.tax_bps is None else (taxable * settings.tax_bps) // 10000
    order = Order(
        customer_id=user.id,
        order_type="product",
        status="CONFIRMED",
        payment_status="UNPAID",
        goods_paise=goods,
        install_paise=install_total,
        delivery_paise=delivery_paise,
        tax_paise=tax,
        total_paise=taxable + tax,
        address_json=json.dumps(address),
        idempotency_key=key or None,
    )
    db.add(order)
    db.flush()
    for product, qty, install, line_paise in built:
        db.add(OrderItem(
            order_id=order.id,
            product_id=product.id,
            seller_code=product.seller_code,
            name=product.name,
            qty=qty,
            unit_paise=product.price_paise,
            install=install,
            line_paise=line_paise,
        ))
    audit(db, actor_id=user.id, action="order_created", resource_type="order", resource_id=order.id, new=str(order.total_paise), ip=request_ip(request))
    db.commit()
    db.refresh(order)
    return _order_out(order, True)


@router.get("/orders")
def list_orders(request: Request, db: Session = Depends(db_session)):
    user = require_user(request, db)
    if user.account_type == "customer":
        rows = db.query(Order).filter(Order.customer_id == user.id).order_by(Order.created_at.desc()).all()
    elif user.account_type == "professional":
        rows = db.query(Order).filter(Order.assigned_professional_id == user.id).all()
    elif user.account_type == "seller":
        profile = db.query(SellerProfile).filter(SellerProfile.user_id == user.id).one_or_none()
        if profile is None:
            rows = []
        else:
            rows = (
                db.query(Order)
                .join(OrderItem)
                .filter(OrderItem.seller_code == profile.shop_code)
                .all()
            )
    else:
        require_permission(user, "orders.read")
        rows = db.query(Order).order_by(Order.created_at.desc()).limit(100).all()
    return {"orders": [_order_out(row, row.customer_id == user.id or user.account_type == "admin") for row in rows]}


@router.get("/orders/{order_id}")
def get_order(order_id: str, request: Request, db: Session = Depends(db_session)):
    user = require_user(request, db)
    order = db.get(Order, order_id)
    if order is None or not _can_read_order(db, user, order):
        security_event(db, kind="idor_denied", actor_id=user.id, ip=request_ip(request), detail="order_read")
        db.commit()
        raise HTTPException(status_code=404, detail="not_found")
    return _order_out(order, order.customer_id == user.id or user.account_type == "admin")


@router.post("/orders/{order_id}/status")
def change_status(order_id: str, payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="not_found")
    nxt = str(payload.get("status") or "")
    if nxt in {"PAYMENT_COMPLETED", "PAID"} or payload.get("payment_status"):
        raise HTTPException(status_code=400, detail="payment_status_is_verified_separately")
    if user.account_type == "admin":
        require_permission(user, "orders.status")
        if nxt not in PRODUCT_STATUSES and nxt not in SERVICE_STATUSES and nxt != "CANCELLED":
            raise HTTPException(status_code=400, detail="invalid_status")
    elif user.account_type == "professional" and order.assigned_professional_id == user.id:
        if nxt not in _next_ok(order.status) or nxt not in {"ON_THE_WAY", "WORK_STARTED", "WORK_IN_PROGRESS", "WORK_COMPLETED"}:
            raise HTTPException(status_code=409, detail="invalid_transition")
    elif order.customer_id == user.id and nxt == "CANCELLED" and order.status in {"CONFIRMED", "BOOKING_RECEIVED"} and order.payment_status == "UNPAID":
        pass
    elif order.customer_id == user.id and nxt == "CUSTOMER_CONFIRMATION" and order.status == "WORK_COMPLETED":
        pass
    else:
        raise HTTPException(status_code=403, detail="forbidden")
    if nxt == "ORDER_CLOSED" and order.payment_status != "PAID":
        raise HTTPException(status_code=409, detail="unpaid_order_cannot_close")
    old = order.status
    order.status = nxt
    audit(db, actor_id=user.id, action="order_status", resource_type="order", resource_id=order.id, old=old, new=nxt, ip=request_ip(request))
    db.commit()
    return {"id": order.id, "status": order.status, "payment_status": order.payment_status}


def _next_ok(status: str) -> set[str]:
    from backend.security import SAFE_TRANSITIONS
    return SAFE_TRANSITIONS.get(status, set())


@router.post("/orders/{order_id}/assign")
def assign_professional(order_id: str, payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    require_permission(user, "orders.assign")
    order = db.get(Order, order_id)
    pro = db.get(User, str(payload.get("professional_id") or ""))
    if order is None or pro is None or pro.account_type != "professional":
        raise HTTPException(status_code=404, detail="not_found")
    profile = db.query(ProfessionalProfile).filter(ProfessionalProfile.user_id == pro.id).one_or_none()
    if profile is None or profile.verification_status != "APPROVED":
        raise HTTPException(status_code=409, detail="professional_not_approved")
    order.assigned_professional_id = pro.id
    if order.status == "FINDING_PROFESSIONAL":
        order.status = "PROFESSIONAL_ASSIGNED"
    audit(db, actor_id=user.id, action="professional_assigned", resource_type="order", resource_id=order.id, new=pro.id, ip=request_ip(request))
    db.commit()
    return {"id": order.id, "assigned_professional_id": pro.id}


@router.post("/payments/initiate")
def initiate_payment(payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    order = db.get(Order, str(payload.get("order_id") or ""))
    if order is None or order.customer_id != user.id:
        raise HTTPException(status_code=404, detail="not_found")
    if order.payment_status == "PAID":
        raise HTTPException(status_code=409, detail="already_paid")
    settings = request.app.state.settings
    amount = order.total_paise
    payment = Payment(order_id=order.id, amount_paise=amount, status="INITIATED", provider="razorpay")
    db.add(payment)
    db.flush()
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        audit(db, actor_id=user.id, action="payment_initiate_blocked", resource_type="payment", resource_id=payment.id, new="gateway_not_configured", ip=request_ip(request))
        db.commit()
        raise HTTPException(status_code=503, detail="gateway_not_configured")
    try:
        gateway = httpx.post(
            "https://api.razorpay.com/v1/orders",
            auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            json={
                "amount": amount,
                "currency": "INR",
                "receipt": order.id.replace("-", "")[:40],
                "payment_capture": 1,
                "notes": {"nayan_order_id": order.id},
            },
            timeout=15,
        )
    except httpx.HTTPError:
        payment.status = "FAILED"
        db.commit()
        raise HTTPException(status_code=503, detail="gateway_unavailable")
    if gateway.status_code >= 400 or not gateway.json().get("id"):
        payment.status = "FAILED"
        audit(db, actor_id=user.id, action="payment_initiate_blocked", resource_type="payment", resource_id=payment.id, new="gateway_unavailable", ip=request_ip(request))
        db.commit()
        raise HTTPException(status_code=503, detail="gateway_unavailable")
    payment.provider_order_id = str(gateway.json()["id"])
    payment.status = "PENDING"
    db.commit()
    return {
        "payment_id": payment.id,
        "amount_paise": amount,
        "currency": "INR",
        "key_id": settings.razorpay_key_id,
        "provider_order_id": payment.provider_order_id,
    }


@router.post("/payments/confirm")
def confirm_payment(payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    order = db.get(Order, str(payload.get("order_id") or ""))
    if order is None or order.customer_id != user.id:
        raise HTTPException(status_code=404, detail="not_found")
    secret = request.app.state.settings.razorpay_key_secret or request.app.state.settings.payment_webhook_secret
    message = f"{payload.get('provider_order_id')}|{payload.get('provider_payment_id')}".encode()
    if payload.get("success") is True and not payload.get("signature"):
        security_event(db, kind="payment_signature_rejected", actor_id=user.id, ip=request_ip(request), detail="frontend_success_ignored")
        db.commit()
        raise HTTPException(status_code=400, detail="payment_not_verified")
    if not signatures_match(secret, message, str(payload.get("signature") or "")):
        security_event(db, kind="payment_signature_rejected", actor_id=user.id, ip=request_ip(request), detail=order.id)
        db.commit()
        raise HTTPException(status_code=400, detail="payment_not_verified")
    _mark_paid(db, order, str(payload.get("provider_payment_id") or ""), int(payload.get("amount_paise") or 0), request)
    db.commit()
    return {"payment_status": order.payment_status}


@router.post("/payments/webhook")
async def webhook(request: Request, db: Session = Depends(db_session)):
    body = await request.body()
    secret = request.app.state.settings.payment_webhook_secret
    signature = request.headers.get("x-nayan-signature") or request.headers.get("x-razorpay-signature") or ""
    if not signatures_match(secret, body, signature):
        security_event(db, kind="webhook_rejected", ip=request_ip(request), detail="bad_signature")
        db.commit()
        raise HTTPException(status_code=401, detail="invalid_signature")
    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid_payload")
    if payload.get("event") and isinstance(payload.get("payload"), dict) and not payload.get("event_id"):
        entity = ((payload.get("payload") or {}).get("payment") or {}).get("entity") or {}
        notes = entity.get("notes") or {}
        order_id = str(notes.get("nayan_order_id") or "")
        if not order_id and entity.get("order_id"):
            linked = db.query(Payment).filter(Payment.provider_order_id == str(entity.get("order_id"))).one_or_none()
            order_id = linked.order_id if linked else ""
        captured = payload.get("event") == "payment.captured" and entity.get("status") == "captured"
        payload = {
            "event_id": request.headers.get("x-razorpay-event-id") or entity.get("id") or "",
            "order_id": order_id,
            "payment_id": entity.get("id") or "",
            "amount_paise": entity.get("amount"),
            "status": "paid" if captured else "ignored",
        }
    event_id = clean_text(payload.get("event_id"), 120)
    if not event_id:
        raise HTTPException(status_code=400, detail="invalid_event")
    seen = db.query(WebhookEvent).filter(WebhookEvent.provider_event_id == event_id).one_or_none()
    if seen:
        return {"ok": True, "duplicate": True}
    order = db.get(Order, str(payload.get("order_id") or ""))
    if order is None:
        db.add(WebhookEvent(provider_event_id=event_id, result="unknown_order"))
        db.commit()
        raise HTTPException(status_code=404, detail="not_found")
    amount = payload.get("amount_paise")
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        amount = -1
    if payload.get("status") != "paid" or amount != order.total_paise:
        db.add(WebhookEvent(provider_event_id=event_id, order_id=order.id, result="amount_mismatch"))
        security_event(db, kind="webhook_mismatch", ip=request_ip(request), detail=order.id)
        db.commit()
        raise HTTPException(status_code=409, detail="amount_mismatch")
    _mark_paid(db, order, clean_text(payload.get("payment_id"), 80), amount, request)
    db.add(WebhookEvent(provider_event_id=event_id, order_id=order.id, result="paid"))
    db.commit()
    return {"ok": True, "payment_status": "PAID"}


def _mark_paid(db: Session, order: Order, provider_payment_id: str, amount: int, request: Request) -> None:
    if amount != order.total_paise:
        raise HTTPException(status_code=409, detail="amount_mismatch")
    if provider_payment_id:
        existing = db.query(Payment).filter(Payment.provider_payment_id == provider_payment_id).one_or_none()
        if existing and existing.order_id != order.id:
            raise HTTPException(status_code=409, detail="duplicate_payment")
        if existing and existing.signature_verified and order.payment_status == "PAID":
            return
    if order.payment_status == "PAID":
        return
    payment = db.query(Payment).filter(Payment.order_id == order.id).order_by(Payment.created_at.desc()).first()
    if payment is None:
        payment = Payment(order_id=order.id, amount_paise=order.total_paise, provider="webhook")
        db.add(payment)
        db.flush()
    payment.status = "PAID"
    payment.amount_paise = order.total_paise
    payment.signature_verified = True
    if provider_payment_id:
        payment.provider_payment_id = provider_payment_id
    order.payment_status = "PAID"
    _ensure_settlements(db, order)
    audit(db, actor_id=None, action="payment_verified", resource_type="order", resource_id=order.id, new=str(order.total_paise), ip=request_ip(request))


def _commission_bps(db: Session, seller_code: str, category: str) -> int:
    rules = db.query(CommissionRule).filter(CommissionRule.active.is_(True)).all()
    ranked = []
    for rule in rules:
        if rule.scope == "seller" and rule.scope_id == seller_code:
            ranked.append((1, rule.rate_bps))
        elif rule.scope == "product_category" and rule.scope_id == category:
            ranked.append((2, rule.rate_bps))
        elif rule.scope == "global" and rule.scope_id == "*":
            ranked.append((3, rule.rate_bps))
    if not ranked:
        return 0
    ranked.sort()
    return ranked[0][1]


def _ensure_settlements(db: Session, order: Order) -> None:
    existing = db.query(Settlement).filter(Settlement.order_id == order.id).all()
    if existing:
        return
    grouped: dict[str, int] = {}
    categories: dict[str, str] = {}
    for item in order.items:
        grouped[item.seller_code] = grouped.get(item.seller_code, 0) + item.line_paise
        product = db.get(Product, item.product_id)
        categories[item.seller_code] = product.category if product else ""
    for seller_code, gross in grouped.items():
        bps = _commission_bps(db, seller_code, categories.get(seller_code, ""))
        commission = (gross * bps) // 10000
        db.add(Settlement(
            order_id=order.id,
            seller_code=seller_code,
            gross_paise=gross,
            commission_paise=commission,
            refund_paise=0,
            net_paise=gross - commission,
            status="PENDING",
        ))


@router.post("/refunds")
def create_refund(payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    require_permission(user, "refunds.manage")
    order = db.get(Order, str(payload.get("order_id") or ""))
    if order is None or order.payment_status not in {"PAID", "PARTIALLY_REFUNDED"}:
        raise HTTPException(status_code=409, detail="refund_not_available")
    payment = db.query(Payment).filter(Payment.order_id == order.id, Payment.signature_verified.is_(True)).first()
    if payment is None:
        raise HTTPException(status_code=409, detail="payment_not_verified")
    try:
        amount = int(payload.get("amount_paise"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="invalid_amount")
    already = sum(row.amount_paise for row in db.query(Refund).filter(Refund.order_id == order.id, Refund.status != "FAILED"))
    if amount < 1 or already + amount > order.total_paise:
        raise HTTPException(status_code=409, detail="refund_exceeds_payment")
    refund = Refund(
        order_id=order.id,
        payment_id=payment.id,
        amount_paise=amount,
        reason=clean_text(payload.get("reason"), 240) or "approved refund",
        status="INITIATED",
        created_by=user.id,
    )
    db.add(refund)
    remaining = order.total_paise - (already + amount)
    order.payment_status = "REFUNDED" if remaining == 0 else "PARTIALLY_REFUNDED"
    for settlement in db.query(Settlement).filter(Settlement.order_id == order.id):
        share = amount if len(order.items) else 0
        # Apply the refund to settlements in seller-code order, without going negative.
        take = min(share, settlement.net_paise + settlement.refund_paise)
        # Distribute sequentially below.
    left = amount
    for settlement in db.query(Settlement).filter(Settlement.order_id == order.id).all():
        room = settlement.gross_paise - settlement.refund_paise
        take = min(left, max(room, 0))
        settlement.refund_paise += take
        settlement.net_paise = max(0, settlement.gross_paise - settlement.commission_paise - settlement.refund_paise)
        settlement.status = "ON_HOLD"
        left -= take
    audit(db, actor_id=user.id, action="refund", resource_type="order", resource_id=order.id, new=str(amount), ip=request_ip(request))
    db.commit()
    return {"id": refund.id, "status": refund.status, "payment_status": order.payment_status}


@router.get("/settlements")
def list_settlements(request: Request, db: Session = Depends(db_session)):
    user = require_user(request, db)
    if user.account_type == "seller":
        profile = db.query(SellerProfile).filter(SellerProfile.user_id == user.id).one_or_none()
        rows = [] if profile is None else db.query(Settlement).filter(Settlement.seller_code == profile.shop_code).all()
    else:
        require_permission(user, "settlements.manage")
        rows = db.query(Settlement).order_by(Settlement.created_at.desc()).limit(100).all()
    return {"settlements": [_settlement_out(row) for row in rows]}


def _settlement_out(row: Settlement) -> dict:
    return {
        "id": row.id,
        "order_id": row.order_id,
        "seller_code": row.seller_code,
        "gross_paise": row.gross_paise,
        "commission_paise": row.commission_paise,
        "refund_paise": row.refund_paise,
        "net_paise": row.net_paise,
        "status": row.status,
    }


@router.post("/commission-rules")
def add_rule(payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    require_permission(user, "commission.manage")
    scope = str(payload.get("scope") or "")
    if scope not in {"global", "seller", "product_category", "service", "professional", "product"}:
        raise HTTPException(status_code=400, detail="invalid_scope")
    try:
        rate = int(payload.get("rate_bps"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="invalid_rate")
    if rate < 0 or rate > 5000:
        raise HTTPException(status_code=400, detail="invalid_rate")
    rule = CommissionRule(scope=scope, scope_id=clean_text(payload.get("scope_id") or "*", 40), rate_bps=rate, active=True)
    db.add(rule)
    audit(db, actor_id=user.id, action="commission_changed", resource_type="commission_rule", resource_id=rule.id, new=f"{scope}:{rule.rate_bps}", ip=request_ip(request))
    db.commit()
    return {"id": rule.id, "rate_bps": rule.rate_bps}


@router.post("/products")
def create_product(payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    profile = db.query(SellerProfile).filter(SellerProfile.user_id == user.id).one_or_none()
    if profile is None or profile.verification_status != "APPROVED":
        if not require_permission_bool(user, "products.manage"):
            raise HTTPException(status_code=403, detail="forbidden")
        seller_code = clean_text(payload.get("seller_code"), 40)
    else:
        seller_code = profile.shop_code
    pid = clean_text(payload.get("id"), 40)
    if not SLUG_RE.match(pid):
        raise HTTPException(status_code=400, detail="invalid_product")
    if db.get(Product, pid):
        raise HTTPException(status_code=409, detail="exists")
    try:
        price = int(payload.get("price_paise"))
        stock = int(payload.get("stock"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="invalid_money")
    if price < 0 or stock < 0 or price > 10_000_000_00:
        raise HTTPException(status_code=400, detail="invalid_money")
    product = Product(
        id=pid,
        name=clean_text(payload.get("name"), 160) or "Untitled",
        seller_code=seller_code,
        price_paise=price,
        stock=stock,
        status="PENDING_APPROVAL",
        is_sample=False,
        category=clean_text(payload.get("category") or "cctv", 40),
    )
    db.add(product)
    audit(db, actor_id=user.id, action="product_created", resource_type="product", resource_id=pid, ip=request_ip(request))
    db.commit()
    return {"id": product.id, "status": product.status}


@router.patch("/products/{product_id}")
def update_product(product_id: str, payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="not_found")
    profile = db.query(SellerProfile).filter(SellerProfile.user_id == user.id).one_or_none()
    owns = profile is not None and profile.shop_code == product.seller_code
    if not owns and not require_permission_bool(user, "products.manage"):
        security_event(db, kind="idor_denied", actor_id=user.id, ip=request_ip(request), detail="product_update")
        db.commit()
        raise HTTPException(status_code=404, detail="not_found")
    old_price = product.price_paise
    if "price_paise" in payload:
        product.price_paise = int(payload["price_paise"])
        if owns and not require_permission_bool(user, "products.manage"):
            product.status = "PENDING_APPROVAL"
        audit(db, actor_id=user.id, action="price_changed", resource_type="product", resource_id=product.id, old=str(old_price), new=str(product.price_paise), ip=request_ip(request))
    if "status" in payload and require_permission_bool(user, "products.manage"):
        status = str(payload["status"])
        if status not in {"PUBLISHED", "REJECTED", "INACTIVE", "PENDING_APPROVAL"}:
            raise HTTPException(status_code=400, detail="invalid_status")
        product.status = status
        audit(db, actor_id=user.id, action="product_published" if status == "PUBLISHED" else "product_status", resource_type="product", resource_id=product.id, new=status, ip=request_ip(request))
    db.commit()
    return {"id": product.id, "status": product.status, "price_paise": product.price_paise}


@router.post("/providers/{user_id}/verification")
def set_verification(user_id: str, payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    actor = require_user(request, db)
    status = str(payload.get("status") or "")
    if status not in {"PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "BLOCKED"}:
        raise HTTPException(status_code=400, detail="invalid_status")
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="not_found")
    if target.account_type == "professional":
        require_permission(actor, "professionals.manage")
        profile = db.query(ProfessionalProfile).filter(ProfessionalProfile.user_id == target.id).one_or_none()
    elif target.account_type == "seller":
        require_permission(actor, "sellers.manage")
        profile = db.query(SellerProfile).filter(SellerProfile.user_id == target.id).one_or_none()
    else:
        raise HTTPException(status_code=400, detail="not_a_provider")
    if profile is None:
        raise HTTPException(status_code=404, detail="not_found")
    old = profile.verification_status
    profile.verification_status = status
    if status in {"SUSPENDED", "BLOCKED"}:
        target.status = status
    audit(db, actor_id=actor.id, action="provider_verification", resource_type="user", resource_id=target.id, old=old, new=status, ip=request_ip(request))
    db.commit()
    return {"id": target.id, "verification_status": status}
