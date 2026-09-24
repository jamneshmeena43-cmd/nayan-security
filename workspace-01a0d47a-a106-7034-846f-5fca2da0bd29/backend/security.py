import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt

from backend.config import Settings

COOKIE = "ns_session"
TAG_RE = re.compile(r"<[^>]*>")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}$")
PHONE_RE = re.compile(r"^[6-9]\d{9}$")
SLUG_RE = re.compile(r"^[a-z0-9-]{1,40}$")

PERMISSIONS = {
    "SUPER_ADMIN": {"*"},
    "OPERATIONS_ADMIN": {
        "customers.read", "professionals.manage", "sellers.manage",
        "orders.read", "orders.status", "orders.assign", "security.read",
    },
    "FINANCE_ADMIN": {
        "payments.read", "refunds.manage", "commission.manage",
        "settlements.manage", "orders.read", "security.read",
    },
    "SUPPORT_ADMIN": {
        "customers.read", "orders.read", "support.manage", "security.read",
    },
    "SERVICE_MANAGER": {
        "professionals.manage", "orders.read", "orders.assign",
    },
    "PRODUCT_MANAGER": {"products.manage", "inventory.read"},
    "CONTENT_MANAGER": {"content.manage"},
}

PRODUCT_STATUSES = {
    "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY",
    "DELIVERED", "CANCELLED", "RETURN", "REFUND",
}
SERVICE_STATUSES = {
    "BOOKING_RECEIVED", "FINDING_PROFESSIONAL", "PROFESSIONAL_ASSIGNED",
    "PROFESSIONAL_ACCEPTED", "VISIT_SCHEDULED", "ON_THE_WAY", "WORK_STARTED",
    "WORK_IN_PROGRESS", "WORK_COMPLETED", "CUSTOMER_CONFIRMATION",
    "PAYMENT_COMPLETED", "ORDER_CLOSED",
}
SAFE_TRANSITIONS = {
    "CONFIRMED": {"PROCESSING", "CANCELLED"},
    "PROCESSING": {"READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "CANCELLED"},
    "READY_FOR_PICKUP": {"DELIVERED", "CANCELLED"},
    "OUT_FOR_DELIVERY": {"DELIVERED"},
    "DELIVERED": {"RETURN"},
    "RETURN": {"REFUND"},
    "BOOKING_RECEIVED": {"FINDING_PROFESSIONAL", "CANCELLED"},
    "FINDING_PROFESSIONAL": {"PROFESSIONAL_ASSIGNED", "CANCELLED"},
    "PROFESSIONAL_ASSIGNED": {"PROFESSIONAL_ACCEPTED", "CANCELLED"},
    "PROFESSIONAL_ACCEPTED": {"VISIT_SCHEDULED"},
    "VISIT_SCHEDULED": {"ON_THE_WAY"},
    "ON_THE_WAY": {"WORK_STARTED"},
    "WORK_STARTED": {"WORK_IN_PROGRESS"},
    "WORK_IN_PROGRESS": {"WORK_COMPLETED"},
    "WORK_COMPLETED": {"CUSTOMER_CONFIRMATION"},
    "CUSTOMER_CONFIRMATION": {"ORDER_CLOSED"},
}


def hash_password(password: str, rounds: int) -> str:
    salt = bcrypt.gensalt(rounds=rounds)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(password: str, stored: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8"))
    except ValueError:
        return False


def password_ok(password: str) -> str | None:
    if not isinstance(password, str) or len(password) < 10 or len(password) > 128:
        return "Password must be 10 to 128 characters."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Password needs a letter and a number."
    lowered = password.lower()
    if lowered in {"password123", "nayansecurity", "1234567890", "changeme123"}:
        return "Choose a less common password."
    return None


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def clean_text(value, max_len: int) -> str:
    text = TAG_RE.sub("", str(value or ""))
    text = text.replace("\x00", "").strip()
    return text[:max_len]


def valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value or "")) and len(value) <= 254


def has_permission(user, perm: str) -> bool:
    if user is None or user.account_type != "admin" or user.status != "ACTIVE":
        return False
    granted = PERMISSIONS.get(user.admin_role or "", set())
    return "*" in granted or perm in granted


def client_ip(request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client:
        return request.client.host[:64]
    return ""


def sign_hex(secret: str, payload: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def signatures_match(secret: str, payload: bytes, provided: str) -> bool:
    if not secret or not provided:
        return False
    expected = sign_hex(secret, payload)
    return hmac.compare_digest(expected, provided.strip())


def session_expiry(hours: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=hours)


def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
