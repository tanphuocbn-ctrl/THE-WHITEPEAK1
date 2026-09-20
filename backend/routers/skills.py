from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db, clean
import auth as A
import rbac
from common import new_id, now_iso, get_project_or_404, audit

router = APIRouter(prefix="/projects/{project_id}/skills", tags=["skills"])

CATEGORIES = ["guide", "process", "prompt"]


class SkillIn(BaseModel):
    title: str
    category: str = "guide"
    content: str = ""
    description: Optional[str] = ""


class VersionIn(BaseModel):
    content: str
    note: Optional[str] = ""


@router.get("")
async def list_skills(project_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "skill.view")
    docs = await db.skills.find({"project_id": project_id}).sort("updated_at", -1).to_list(1000)
    return [clean(d) for d in docs]


@router.post("")
async def create_skill(project_id: str, body: SkillIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "skill.write")
    if body.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Loại không hợp lệ (guide/process/prompt)")
    sid = new_id()
    v = {"id": new_id(), "skill_id": sid, "project_id": project_id, "version_number": 1,
         "content": body.content, "note": "Bản đầu", "created_by": user["id"],
         "created_by_name": user.get("name") or user["email"], "created_at": now_iso()}
    await db.skill_versions.insert_one(dict(v))
    doc = {"id": sid, "project_id": project_id, "title": body.title, "category": body.category,
           "description": body.description or "", "content": body.content, "current_version": 1,
           "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso()}
    await db.skills.insert_one(dict(doc))
    await audit(project_id, "skill", sid, "create", user, after={"title": body.title}, label=f"Tạo skill: {body.title}")
    return clean(doc)


@router.get("/{sid}")
async def get_skill(project_id: str, sid: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "skill.view")
    doc = await db.skills.find_one({"id": sid, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy skill")
    versions = await db.skill_versions.find({"skill_id": sid}).sort("version_number", -1).to_list(500)
    doc = clean(doc)
    doc["versions"] = [clean(v) for v in versions]
    return doc


@router.post("/{sid}/versions")
async def add_version(project_id: str, sid: str, body: VersionIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "skill.write")
    doc = await db.skills.find_one({"id": sid, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy skill")
    vn = (doc.get("current_version", 0)) + 1
    v = {"id": new_id(), "skill_id": sid, "project_id": project_id, "version_number": vn,
         "content": body.content, "note": body.note or "", "created_by": user["id"],
         "created_by_name": user.get("name") or user["email"], "created_at": now_iso()}
    await db.skill_versions.insert_one(dict(v))
    await db.skills.update_one({"id": sid}, {"$set": {"content": body.content, "current_version": vn, "updated_at": now_iso()}})
    await audit(project_id, "skill", sid, "version", user, after={"version": vn}, label=f"Skill {doc.get('title')} v{vn}")
    return clean(v)


@router.delete("/{sid}")
async def delete_skill(project_id: str, sid: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "skill.write")
    doc = await db.skills.find_one({"id": sid, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy skill")
    await db.skills.delete_one({"id": sid})
    await db.skill_versions.delete_many({"skill_id": sid})
    await audit(project_id, "skill", sid, "delete", user, before={"title": doc.get("title")}, label=f"Xóa skill: {doc.get('title')}")
    return {"message": "Đã xóa"}
