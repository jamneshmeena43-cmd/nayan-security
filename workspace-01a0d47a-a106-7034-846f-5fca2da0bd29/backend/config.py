import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return int(raw)


@dataclass(frozen=True)
class Settings:
    secret_key: str
    database_url: str
    admin_email: str
    admin_password: str
    razorpay_key_id: str
    razorpay_key_secret: str
    cashfree_app_id: str
    cashfree_secret: str
    payment_webhook_secret: str
    enable_hsts: bool
    secure_cookies: bool
    tax_bps: int | None
    frame_ancestors: str
    bcrypt_rounds: int
    session_hours: int
    login_max_attempts: int
    login_window_seconds: int
    upload_max_bytes: int
    root_dir: str


def load_settings() -> Settings:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    secret = os.environ.get("SECRET_KEY") or ""
    return Settings(
        secret_key=secret,
        database_url=os.environ.get("DATABASE_URL", f"sqlite:///{os.path.join(root, 'data', 'nayan.db')}"),
        admin_email=os.environ.get("ADMIN_EMAIL", "").strip().lower(),
        admin_password=os.environ.get("ADMIN_PASSWORD", ""),
        razorpay_key_id=os.environ.get("RAZORPAY_KEY_ID", ""),
        razorpay_key_secret=os.environ.get("RAZORPAY_KEY_SECRET", ""),
        cashfree_app_id=os.environ.get("CASHFREE_APP_ID", ""),
        cashfree_secret=os.environ.get("CASHFREE_SECRET", ""),
        payment_webhook_secret=os.environ.get("PAYMENT_WEBHOOK_SECRET", ""),
        enable_hsts=os.environ.get("ENABLE_HSTS", "0") == "1",
        secure_cookies=os.environ.get("SECURE_COOKIES", "0") == "1",
        tax_bps=_int("TAX_BPS", -1) if os.environ.get("TAX_BPS") else None,
        frame_ancestors=os.environ.get("FRAME_ANCESTORS", "'self' https://arena.ai https://*.arena.ai https://*.e2b.app"),
        bcrypt_rounds=max(12, _int("BCRYPT_ROUNDS", 12)) if os.environ.get("PYTEST_CURRENT_TEST") is None else max(4, _int("BCRYPT_ROUNDS", 4)),
        session_hours=_int("SESSION_HOURS", 8),
        login_max_attempts=_int("LOGIN_MAX_ATTEMPTS", 5),
        login_window_seconds=_int("LOGIN_WINDOW_SECONDS", 900),
        upload_max_bytes=_int("UPLOAD_MAX_BYTES", 5 * 1024 * 1024),
        root_dir=root,
    )
