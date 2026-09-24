import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.audit import audit
from backend.deps import db_session, require_csrf, require_user, request_ip
from backend.models import Upload
from backend.security import has_permission

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"GIF87a", "image/gif", ".gif"),
    (b"GIF89a", "image/gif", ".gif"),
    (b"%PDF-", "application/pdf", ".pdf"),
)
REJECT_PREFIXES = (b"MZ", b"\x7fELF", b"#!", b"<", b"<?php", b"\x00asm")


def detect(data: bytes):
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    for sig, mime, ext in SIGNATURES:
        if data.startswith(sig):
            return mime, ext
    return None


@router.post("")
async def upload_file(
    request: Request,
    purpose: str = Form("site-photo"),
    file: UploadFile = File(...),
    db: Session = Depends(db_session),
):
    require_csrf(request, db)
    user = require_user(request, db)
    settings = request.app.state.settings
    data = await file.read(settings.upload_max_bytes + 1)
    if len(data) > settings.upload_max_bytes:
        raise HTTPException(status_code=413, detail="file_too_large")
    if not data or data.startswith(REJECT_PREFIXES) or b"<script" in data[:200].lower():
        raise HTTPException(status_code=400, detail="file_rejected")
    detected = detect(data)
    if detected is None:
        raise HTTPException(status_code=400, detail="file_type_rejected")
    mime, ext = detected
    claimed = (file.content_type or "").split(";")[0].strip().lower()
    if claimed and claimed not in {mime, "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="mime_mismatch")
    stored = uuid.uuid4().hex + ext
    folder = os.path.join(settings.root_dir, "data", "uploads")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, stored)
    with open(path, "wb") as handle:
        handle.write(data)
    row = Upload(owner_id=user.id, stored_name=stored, mime=mime, size=len(data), purpose=purpose[:40])
    db.add(row)
    audit(db, actor_id=user.id, action="file_uploaded", resource_type="upload", resource_id=row.id, new=mime, ip=request_ip(request))
    db.commit()
    return {"id": row.id, "mime": mime, "size": len(data)}


@router.get("/{upload_id}")
def download(upload_id: str, request: Request, db: Session = Depends(db_session)):
    user = require_user(request, db)
    row = db.get(Upload, upload_id)
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    if row.owner_id != user.id and not has_permission(user, "customers.read") and not has_permission(user, "*"):
        raise HTTPException(status_code=404, detail="not_found")
    path = os.path.join(request.app.state.settings.root_dir, "data", "uploads", row.stored_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="not_found")
    disposition = "inline" if row.mime.startswith("image/") else "attachment"
    return FileResponse(
        path,
        media_type=row.mime,
        headers={
            "Content-Disposition": f'{disposition}; filename="{row.stored_name}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/{upload_id}")
def remove(upload_id: str, request: Request, db: Session = Depends(db_session)):
    require_csrf(request, db)
    user = require_user(request, db)
    row = db.get(Upload, upload_id)
    if row is None or row.owner_id != user.id:
        raise HTTPException(status_code=404, detail="not_found")
    path = os.path.join(request.app.state.settings.root_dir, "data", "uploads", row.stored_name)
    if os.path.isfile(path):
        os.remove(path)
    db.delete(row)
    db.commit()
    return {"ok": True}
