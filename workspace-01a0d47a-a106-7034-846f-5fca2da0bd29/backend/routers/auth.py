import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from backend.audit import audit, security_event
from backend.deps import current_session, current_user, db_session, hit_limit, public_user, request_ip
from backend.models import ProfessionalProfile, SellerProfile, User, new_id
from backend.security import (
    COOKIE, aware, clean_text, hash_password, hash_token, new_token,
    password_ok, valid_email, verify_password, PHONE_RE,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _cookie_secure(request: Request) -> bool:
    settings = request.app.state.settings
    if settings.secure_cookies:
        return True
    proto = request.headers.get("x-forwarded-proto", "")
    return request.url.scheme == "https" or proto == "https"


def _set_session(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(request),
        max_age=request.app.state.settings.session_hours * 3600,
        path="/",
    )


def _issue(db: Session, request: Request, user: User) -> tuple[str, str]:
    token = new_token()
    csrf = new_token()
    from backend.models import Session as AuthSession
    from backend.security import session_expiry
    db.add(AuthSession(
        user_id=user.id,
        token_hash=hash_token(token),
        csrf_token=csrf,
        expires_at=session_expiry(request.app.state.settings.session_hours),
        ip=request_ip(request),
        user_agent=request.headers.get("user-agent", "")[:200],
    ))
    return token, csrf


@router.post("/register")
def register(payload: dict, request: Request, response: Response, db: Session = Depends(db_session)):
    settings = request.app.state.settings
    if hit_limit(f"register:{request_ip(request)}", int(os.environ.get("REGISTER_IP_LIMIT", "8")), 3600):
        security_event(db, kind="rate_limit", ip=request_ip(request), detail="register")
        db.commit()
        raise HTTPException(status_code=429, detail="rate_limited")
    name = clean_text(payload.get("name"), 120)
    email = clean_text(payload.get("email"), 254).lower()
    phone = clean_text(payload.get("phone"), 16)
    password = payload.get("password") or ""
    account_type = payload.get("account_type") or "customer"
    if account_type not in {"customer", "professional", "seller"}:
        raise HTTPException(status_code=400, detail="invalid_account_type")
    if not name or not valid_email(email):
        raise HTTPException(status_code=400, detail="invalid_profile")
    if phone and not PHONE_RE.match(phone):
        raise HTTPException(status_code=400, detail="invalid_phone")
    problem = password_ok(password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if db.query(User).filter(User.email == email).one_or_none():
        raise HTTPException(status_code=409, detail="email_in_use")
    if phone and db.query(User).filter(User.phone == phone).one_or_none():
        raise HTTPException(status_code=409, detail="phone_in_use")
    user = User(
        name=name,
        email=email,
        phone=phone or None,
        password_hash=hash_password(password, settings.bcrypt_rounds),
        account_type=account_type,
        status="ACTIVE",
    )
    db.add(user)
    db.flush()
    if account_type == "seller":
        db.add(SellerProfile(
            user_id=user.id,
            shop_code="shop-" + new_id()[:8],
            shop_name=clean_text(payload.get("shop_name") or name, 120),
            city=clean_text(payload.get("city"), 80),
            verification_status="PENDING",
        ))
    if account_type == "professional":
        db.add(ProfessionalProfile(
            user_id=user.id,
            business_name=clean_text(payload.get("business_name") or name, 120),
            city=clean_text(payload.get("city"), 80),
            verification_status="PENDING",
        ))
    token, csrf = _issue(db, request, user)
    audit(db, actor_id=user.id, action="register", resource_type="user", resource_id=user.id, ip=request_ip(request))
    db.commit()
    _set_session(response, request, token)
    return {"user": public_user(user), "csrf": csrf}


@router.post("/login")
def login(payload: dict, request: Request, response: Response, db: Session = Depends(db_session)):
    settings = request.app.state.settings
    ip = request_ip(request)
    ip_limit = int(os.environ.get("LOGIN_IP_LIMIT", str(settings.login_max_attempts * 4)))
    if hit_limit(f"login:{ip}", ip_limit, settings.login_window_seconds):
        security_event(db, kind="rate_limit", ip=ip, detail="login")
        db.commit()
        raise HTTPException(status_code=429, detail="rate_limited")
    ident = clean_text(payload.get("email") or payload.get("phone") or "", 254).lower()
    password = payload.get("password") or ""
    user = None
    if "@" in ident:
        user = db.query(User).filter(User.email == ident).one_or_none()
    elif PHONE_RE.match(ident):
        user = db.query(User).filter(User.phone == ident).one_or_none()
    dummy = request.app.state.dummy_hash
    stored = user.password_hash if user else dummy
    matched = verify_password(password, stored) if user else verify_password(password, dummy) and False
    now = datetime.now(timezone.utc)
    if user and user.locked_until and aware(user.locked_until) and aware(user.locked_until) > now:
        security_event(db, kind="locked_login", actor_id=user.id, ip=ip, detail="locked")
        db.commit()
        raise HTTPException(status_code=401, detail="invalid_credentials")
    if not user or not matched or user.status in {"SUSPENDED", "BLOCKED"}:
        if user and user.status not in {"SUSPENDED", "BLOCKED"}:
            user.failed_login_count += 1
            if user.failed_login_count >= settings.login_max_attempts:
                user.locked_until = now + timedelta(seconds=settings.login_window_seconds)
                user.failed_login_count = 0
            security_event(db, kind="failed_login", actor_id=user.id, ip=ip, detail="invalid_credentials")
            audit(db, actor_id=user.id, action="failed_login", resource_type="user", resource_id=user.id, ip=ip)
        else:
            security_event(db, kind="failed_login", ip=ip, detail="invalid_credentials")
        db.commit()
        raise HTTPException(status_code=401, detail="invalid_credentials")
    user.failed_login_count = 0
    user.locked_until = None
    token, csrf = _issue(db, request, user)
    audit(db, actor_id=user.id, action="login", resource_type="user", resource_id=user.id, ip=ip)
    db.commit()
    _set_session(response, request, token)
    return {"user": public_user(user), "csrf": csrf}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(db_session)):
    row = current_session(request, db)
    user = current_user(request, db)
    if row:
        row.revoked_at = datetime.now(timezone.utc)
        audit(db, actor_id=user.id if user else None, action="logout", resource_type="session", resource_id=row.id, ip=request_ip(request))
        db.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request, db: Session = Depends(db_session)):
    user = current_user(request, db)
    row = current_session(request, db)
    if user is None or row is None:
        return {"user": None, "csrf": ""}
    return {"user": public_user(user), "csrf": row.csrf_token}


@router.post("/forgot")
def forgot(payload: dict, request: Request, db: Session = Depends(db_session)):
    # Same response whether or not the account exists. Reset mail is not sent
    # unless an email provider is configured, and the token is never returned.
    if hit_limit(f"forgot:{request_ip(request)}", 5, 3600):
        raise HTTPException(status_code=429, detail="rate_limited")
    security_event(db, kind="password_reset_requested", ip=request_ip(request), detail="generic")
    db.commit()
    return {"ok": True, "message": "If an account exists, a reset can be sent once email delivery is configured."}
