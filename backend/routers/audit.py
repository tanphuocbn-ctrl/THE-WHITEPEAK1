from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from db import db, clean
import auth as A
import rbac
from common import now_iso, get_project_or_404, audit

router = APIRouter(prefix="/projects/{project_id}", tags=["audit"])

COLL = {"project": "projects", "sequence": "sequences", "scene": "scenes", "shot": "shots"}


@router.get("/audit")
async def list_audit(project_id: str, entity_type: Optional[str] = None, limit: int = 200,
                     user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "audit.view")
    q = {"project_id": project_id}
    if entity_type:
        q["entity_type"] = entity_type
    docs = await db.audit_logs.find(q).sort("created_at", -1).to_list(limit)
    return [clean(d) for d in docs]


@router.post("/audit/{log_id}/restore")
async def restore(project_id: str, log_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "audit.restore")
    log = await db.audit_logs.find_one({"id": log_id, "project_id": project_id})
    if not log:
        raise HTTPException(status_code=404, detail="Không tìm thấy log")
    if not log.get("restorable"):
        raise HTTPException(status_code=400, detail="Hành động này không thể khôi phục")
    et, action = log["entity_type"], log["action"]
    coll = COLL.get(et)

    if et == "project" and action in ("grant", "revoke"):
        proj = await db.projects.find_one({"id": project_id})
        members = proj.get("members", [])
        if action == "grant":
            email = log["after"]["email"]
            members = [m for m in members if m["email"] != email]
        else:  # revoke → re-add
            b = log.get("before")
            if b:
                members = [m for m in members if m["user_id"] != b["user_id"]] + [b]
        await db.projects.update_one({"id": project_id}, {"$set": {"members": members}, "$inc": {"rev": 1}})
    elif action == "update" and coll and log.get("before"):
        before = dict(log["before"])
        before.pop("_id", None)
        before["rev"] = before.get("rev", 0) + 1
        before["updated_at"] = now_iso()
        await db[coll].update_one({"id": log["entity_id"]}, {"$set": before})
    elif action in ("delete", "archive") and coll and log.get("before"):
        before = dict(log["before"])
        before.pop("_id", None)
        if action == "archive":
            await db[coll].update_one({"id": log["entity_id"]}, {"$set": {"status": "active"}})
        else:
            existing = await db[coll].find_one({"id": log["entity_id"]})
            if not existing:
                await db[coll].insert_one(before)
    elif action == "status" and log.get("before"):
        await db.shots.update_one({"id": log["entity_id"]},
                                  {"$set": {"status": log["before"]["status"]}, "$inc": {"rev": 1}})
    else:
        raise HTTPException(status_code=400, detail="Loại khôi phục chưa được hỗ trợ")

    await audit(project_id, et, log["entity_id"], "restore", user,
                after={"restored_from": log_id}, label=f"Khôi phục: {log.get('label')}")
    return {"message": "Đã khôi phục"}
