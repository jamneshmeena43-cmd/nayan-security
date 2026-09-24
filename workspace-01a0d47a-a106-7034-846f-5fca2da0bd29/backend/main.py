import hashlib
import os

import bcrypt
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine

from backend.catalog import seed_catalog
from backend.config import load_settings
from backend.models import Base, User
from backend.routers import admin, auth, commerce, uploads
from backend.security import hash_password, valid_email

SPA_PATHS = {
    "/", "/services", "/shop", "/shops", "/professionals", "/cart", "/checkout",
    "/orders", "/profile", "/support", "/auth", "/about", "/contact", "/search",
    "/book", "/quote/request", "/quote/sample", "/terms", "/privacy", "/refund",
    "/warranty", "/amc", "/admin", "/admin/security",
}


def _csp(settings) -> str:
    ld = '{"@context":"https://schema.org","@type":"Organization","name":"NAYAN SECURITY","slogan":"Smart Security. Trusted Service.","description":"CCTV and security marketplace for products, installation, repair and local professionals.","areaServed":"IN"}'
    digest = hashlib.sha256(ld.encode("utf-8")).digest()
    import base64
    hashed = base64.b64encode(digest).decode("ascii")
    return (
        "default-src 'self'; "
        f"script-src 'self' 'sha256-{hashed}'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        f"frame-ancestors {settings.frame_ancestors}"
    )


def create_app() -> FastAPI:
    settings = load_settings()
    os.makedirs(os.path.join(settings.root_dir, "data", "uploads"), exist_ok=True)
    os.makedirs(os.path.join(settings.root_dir, "data", "backups"), exist_ok=True)
    connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
    engine = create_engine(settings.database_url, connect_args=connect_args, future=True)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_connection, _record):
        if settings.database_url.startswith("sqlite"):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    seed = factory()
    try:
        seed_catalog(seed)
        if settings.admin_email and settings.admin_password and valid_email(settings.admin_email):
            exists = seed.query(User).filter(User.admin_role == "SUPER_ADMIN").one_or_none()
            if exists is None and settings.admin_password:
                from backend.security import password_ok
                if password_ok(settings.admin_password) is None:
                    seed.add(User(
                        name="Super admin",
                        email=settings.admin_email,
                        password_hash=hash_password(settings.admin_password, settings.bcrypt_rounds),
                        account_type="admin",
                        admin_role="SUPER_ADMIN",
                        status="ACTIVE",
                    ))
                    seed.commit()
    finally:
        seed.close()

    app = FastAPI(title="NAYAN SECURITY", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.session_factory = factory
    app.state.engine = engine
    app.state.dummy_hash = bcrypt.hashpw(b"not-a-real-user-timing", bcrypt.gensalt(rounds=settings.bcrypt_rounds)).decode()
    app.include_router(auth.router)
    app.include_router(commerce.router)
    app.include_router(uploads.router)
    app.include_router(admin.router)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        try:
            response = await call_next(request)
        except Exception:
            return JSONResponse({"error": "internal_error"}, status_code=500)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = _csp(settings)
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
        response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
        if settings.enable_hsts and (request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"):
            response.headers["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else "request_rejected"
        return JSONResponse({"error": detail}, status_code=exc.status_code)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/sitemap.xml")
    def sitemap(request: Request):
        host = request.headers.get("host", "localhost")
        proto = "https" if request.headers.get("x-forwarded-proto") == "https" else request.url.scheme
        base = f"{proto}://{host}"
        urls = [
            "/", "/services", "/shop", "/shops", "/professionals", "/support",
            "/about", "/contact", "/terms", "/privacy", "/refund", "/warranty", "/amc",
            "/services/cctv-installation", "/services/cctv-repair",
        ]
        body = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"]
        body += [f"<url><loc>{base}{url}</loc></url>" for url in urls]
        body.append("</urlset>")
        from fastapi.responses import Response
        return Response("\n".join(body), media_type="application/xml")

    @app.get("/")
    def home_page():
        return FileResponse(os.path.join(static_dir, "index.html"))

    static_dir = settings.root_dir
    app.mount("/css", StaticFiles(directory=os.path.join(static_dir, "css")), name="css")
    app.mount("/js", StaticFiles(directory=os.path.join(static_dir, "js")), name="js")
    app.mount("/images", StaticFiles(directory=os.path.join(static_dir, "images")), name="images")
    app.mount("/fonts", StaticFiles(directory=os.path.join(static_dir, "fonts")), name="fonts")
    app.mount("/icons", StaticFiles(directory=os.path.join(static_dir, "icons")), name="icons")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        path = "/" + full_path
        blocked = (
            not full_path
            or ".." in full_path
            or full_path.startswith(("data", "backend", "tests", "."))
            or full_path.endswith((".py", ".db", ".env"))
        )
        direct = os.path.join(static_dir, full_path)
        if not blocked and os.path.isfile(direct):
            return FileResponse(direct)
        if path in SPA_PATHS or path.startswith("/services/") or path.startswith("/product/") or path.startswith("/packages/") or path.startswith("/shops/") or path.startswith("/professionals/") or path.startswith("/orders/") or path.startswith("/admin"):
            return FileResponse(os.path.join(static_dir, "index.html"))
        raise HTTPException(status_code=404, detail="not_found")

    return app


app = create_app()
