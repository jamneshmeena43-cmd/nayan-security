import os
import sqlite3
from datetime import datetime, timezone


def sqlite_path(database_url: str, root: str) -> str:
    if not database_url.startswith("sqlite:///"):
        raise RuntimeError("backup_supports_sqlite_only")
    raw = database_url.removeprefix("sqlite:///")
    if raw == ":memory:" or raw.startswith("file:"):
        raise RuntimeError("backup_requires_file_database")
    if not os.path.isabs(raw):
        raw = os.path.join(root, raw)
    return raw


def create_backup(database_url: str, root: str) -> str:
    source = sqlite_path(database_url, root)
    folder = os.path.join(root, "data", "backups")
    os.makedirs(folder, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    dest = os.path.join(folder, f"nayan-{stamp}.db")
    src = sqlite3.connect(source)
    dst = sqlite3.connect(dest)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return dest


def restore_backup(backup_file: str, database_url: str, root: str) -> None:
    target = sqlite_path(database_url, root)
    folder = os.path.realpath(os.path.join(root, "data", "backups"))
    candidate = os.path.realpath(backup_file)
    if not candidate.startswith(folder + os.sep):
        raise RuntimeError("backup_path_rejected")
    src = sqlite3.connect(candidate)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
