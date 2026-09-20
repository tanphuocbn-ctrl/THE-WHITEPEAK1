import uuid
from datetime import datetime, timezone
from fastapi import HTTPException

from db import db, clean


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_project_or_404(project_id: str) -> dict:
    p = await db.projects.find_one({"id": project_id})
    if not p:
        raise HTTPException(status_code=404, detail="Không tìm thấy dự án")
    return clean(p)


async def audit(project_id: str, entity_type: str, entity_id: str, action: str,
                actor: dict, before=None, after=None, restorable: bool = False, label: str = ""):
    await db.audit_logs.insert_one({
        "id": new_id(),
        "project_id": project_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "label": label,
        "actor_id": actor["id"],
        "actor_name": actor.get("name") or actor.get("email"),
        "before": before,
        "after": after,
        "restorable": restorable,
        "created_at": now_iso(),
    })


def check_rev(doc: dict, expected_rev):
    """Optimistic concurrency: reject stale writes (lost-update protection)."""
    if expected_rev is None:
        raise HTTPException(status_code=428, detail="Thiếu revision (rev) cho cập nhật")
    if doc.get("rev", 0) != expected_rev:
        raise HTTPException(
            status_code=409,
            detail=f"Xung đột phiên bản: dữ liệu đã bị thay đổi (rev hiện tại={doc.get('rev', 0)}). Vui lòng tải lại.",
        )
