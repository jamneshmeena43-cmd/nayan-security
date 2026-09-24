import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session as DbSession

from backend.models import Session as AuthSession, User
from backend.security import COOKIE, aware, client_ip, has_permission, hash_token

_buckets: dict[str, deque] = defaultdict(deque)


def hit_limit(key: str, limit: int, window: int) -> bool:
    now = time.time()
    bucket = _buckets[key]
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= limit:
        return True
    bucket.append(now)
    return False


def db_session(request: Request) -> DbSession:
    factory = request.app.state.session_factory
    db = factory()
    try:
        yield db
    finally:
        db.close()


def current_session(request: Request, db: DbSession) -> AuthSession | None:
    raw = request.cookies.get(COOKIE)
    if not raw:
        return None
    row = db.query(AuthSession).filter(AuthSession.token_hash == hash_token(raw)).one_or_none()
    if row is None or row.revoked_at is not None:
        return None
    expires = aware(row.expires_at)
    if expires is None or expires <= datetime.now(timezone.utc):
        return None
    return row


def current_user(request: Request, db: DbSession) -> User | None:
    row = current_session(request, db)
    if row is None:
        return None
    user = db.get(User, row.user_id)
    if user is None or user.status in {"SUSPENDED", "BLOCKED"}:
        return None
    return user


def require_user(request: Request, db: DbSession) -> User:
    user = current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="authentication_required")
    return user


def require_csrf(request: Request, db: DbSession) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    if request.url.path == "/api/payments/webhook":
        return
    row = current_session(request, db)
    if row is None:
        return
    provided = request.headers.get("x-csrf-token", "")
    if not provided or provided != row.csrf_token:
        raise HTTPException(status_code=403, detail="csrf_failed")


def require_permission(user: User, perm: str) -> None:
    if not has_permission(user, perm):
        raise HTTPException(status_code=403, detail="forbidden")


def public_user(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "account_type": user.account_type,
        "admin_role": user.admin_role,
        "status": user.status,
    }


def request_ip(request: Request) -> str:
    return client_ip(request)
