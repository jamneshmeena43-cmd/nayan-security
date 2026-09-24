import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from backend.audit import audit
from backend.backup import create_backup
from backend.deps import db_session, require_csrf, require_permission, require_user, request_ip
from backend.models import AuditLog, SecurityEvent, Session as AuthSession, User
from backend.security import clean_text, hash_password, password_ok, valid_email

router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN_ROLES = {
    "SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN",
    "SERVICE_MANAGER", "PRODUCT_MANAGER", "CONTENT_MANAGER",
}


def _event(row: SecurityEvent) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "actor_id": row.actor_id,
        "ip": row.ip,
        "detail": row.detail,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _audit(row: AuditLog) -> dict:
    return {
        "id": row.id,
        "actor_id": row.actor_id,
        "action": row.action,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "old_value": row.old_value,
        "new_value": row.new_value,
        "ip": row.ip,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/security")
def security_overview(request: Request, db: Session = Depends(db_session)):
    user = require_user(request, db)
    require_permission(user, "security.read")
    failed = db.query(SecurityEvent).filter(SecurityEvent.kind == "failed_login").order_by(SecurityEvent.created_at.desc()).limit(30).all()
    suspicious = db.query(SecurityEvent).filter(SecurityEvent.kind.in_([
        "idor_denied", "webhook_rejected", "webhook_mismatch", "payment_signature_rejected", "rate_limit", "locked_login",
    ])).order_by(SecurityEvent.created_at.desc()).limit(30).all()
    logins = db.query(AuditLog).filter(AuditLog.action.in_(["login", "logout", "failed_login"])).order_by(AuditLog.created_at.desc()).limit(30).all()
    actions = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(40).all()
    sessions = db.query(AuthSession).filter(AuthSession.revoked_at.is_(None)).order_by(AuthSession.created_at.desc()).limit(30).all()
    return {
        "failed_logins": [_event(row) for row in failed],
        "suspicious": [_event(row) for row in suspicious],
        "login_activity": [_audit(row) for row in logins],
        "admin_actions": [_audit(row) for row in actions],
        "sessions": [
            {
                "id": row.id,
                "user_id": row.user_id,
                "ip": row.ip,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            }
            for row in sessions
        ],
    }


@router.post("/users")
def create_admin(payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    actor = require_user(request, db)
    require_permission(actor, "*")
    role = str(payload.get("admin_role") or "")
    if role not in ADMIN_ROLES:
        raise HTTPException(status_code=400, detail="invalid_role")
    email = clean_text(payload.get("email"), 254).lower()
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="invalid_email")
    problem = password_ok(payload.get("password") or "")
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if db.query(User).filter(User.email == email).one_or_none():
        raise HTTPException(status_code=409, detail="email_in_use")
    user = User(
        name=clean_text(payload.get("name") or "Admin", 120),
        email=email,
        password_hash=hash_password(payload["password"], request.app.state.settings.bcrypt_rounds),
        account_type="admin",
        admin_role=role,
        status="ACTIVE",
    )
    db.add(user)
    db.flush()
    audit(db, actor_id=actor.id, action="role_changed", resource_type="user", resource_id=user.id, new=role, ip=request_ip(request))
    db.commit()
    return {"id": user.id, "admin_role": user.admin_role}


@router.post("/users/{user_id}/role")
def change_role(user_id: str, payload: dict, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    actor = require_user(request, db)
    require_permission(actor, "*")
    role = str(payload.get("admin_role") or "")
    if role not in ADMIN_ROLES:
        raise HTTPException(status_code=400, detail="invalid_role")
    target = db.get(User, user_id)
    if target is None or target.account_type != "admin":
        raise HTTPException(status_code=404, detail="not_found")
    old = target.admin_role
    target.admin_role = role
    audit(db, actor_id=actor.id, action="permission_changed", resource_type="user", resource_id=target.id, old=old or "", new=role, ip=request_ip(request))
    db.commit()
    return {"id": target.id, "admin_role": target.admin_role}


@router.post("/backups")
def backup(request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    actor = require_user(request, db)
    require_permission(actor, "*")
    settings = request.app.state.settings
    path = create_backup(settings.database_url, settings.root_dir)
    audit(db, actor_id=actor.id, action="backup_created", resource_type="backup", resource_id=os.path.basename(path), ip=request_ip(request))
    db.commit()
    return {"file": os.path.basename(path)}
