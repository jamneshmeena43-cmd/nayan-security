import json

from backend.models import AuditLog, SecurityEvent, utcnow

REDACT = {"password", "password_hash", "token", "csrf", "secret", "otp", "signature"}


def redact(value) -> str:
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            if str(key).lower() in REDACT:
                cleaned[key] = "[redacted]"
            else:
                cleaned[key] = item
        text = json.dumps(cleaned, default=str)
    else:
        text = str(value or "")
    return text[:2000]


def audit(db, *, actor_id, action, resource_type="", resource_id="", old="", new="", ip=""):
    db.add(AuditLog(
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id or ""),
        old_value=redact(old),
        new_value=redact(new),
        ip=ip or "",
        created_at=utcnow(),
    ))


def security_event(db, *, kind, actor_id=None, ip="", detail=""):
    db.add(SecurityEvent(
        kind=kind,
        actor_id=actor_id,
        ip=ip or "",
        detail=str(detail or "")[:240],
        created_at=utcnow(),
    ))
