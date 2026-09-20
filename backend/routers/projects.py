from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db, clean
import auth as A
import rbac
from common import new_id, now_iso, get_project_or_404, audit, check_rev

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectIn(BaseModel):
    title: str
    code: str
    description: Optional[str] = ""
    cover_url: Optional[str] = None


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    cover_url: Optional[str] = None
    rev: int


class MemberIn(BaseModel):
    email: str
    role: str


@router.get("")
async def list_projects(user: dict = Depends(A.get_current_user)):
    if rbac.is_super(user) or user.get("role") == rbac.ROLE_SECRETARY:
        docs = await db.projects.find().sort("created_at", -1).to_list(1000)
    else:
        docs = await db.projects.find({"members.user_id": user["id"]}).sort("created_at", -1).to_list(1000)
    return [clean(d) for d in docs]


@router.post("")
async def create_project(body: ProjectIn, user: dict = Depends(A.get_current_user)):
    if not rbac.can_create_project(user):
        raise HTTPException(status_code=403, detail="Chỉ Super Admin/Thư ký được tạo dự án")
    if await db.projects.find_one({"code": body.code}):
        raise HTTPException(status_code=400, detail="Mã dự án đã tồn tại")
    doc = {
        "id": new_id(), "code": body.code, "title": body.title,
        "description": body.description or "", "status": "active",
        "cover_url": body.cover_url, "rev": 0,
        "members": [{"user_id": user["id"], "name": user.get("name"), "email": user["email"], "role": "pm"}],
        "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.projects.insert_one(dict(doc))
    await audit(doc["id"], "project", doc["id"], "create", user, after=doc, label=f"Tạo dự án {body.title}")
    return clean(doc)


@router.get("/{project_id}")
async def get_project(project_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "project.view")
    p["my_role"] = rbac.project_role_of(user, p)
    return p


@router.patch("/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "project.edit")
    check_rev(p, body.rev)
    changes = {k: v for k, v in body.model_dump(exclude={"rev"}).items() if v is not None}
    changes["updated_at"] = now_iso()
    res = await db.projects.find_one_and_update(
        {"id": project_id, "rev": body.rev},
        {"$set": changes, "$inc": {"rev": 1}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=409, detail="Xung đột phiên bản, vui lòng tải lại")
    await audit(project_id, "project", project_id, "update", user, before=p, after=clean(dict(res)),
                restorable=True, label="Cập nhật dự án")
    return clean(res)


@router.delete("/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "project.delete")
    await db.projects.update_one({"id": project_id}, {"$set": {"status": "archived", "updated_at": now_iso()}})
    await audit(project_id, "project", project_id, "archive", user, before=p, restorable=True, label="Lưu trữ dự án")
    return {"message": "Đã lưu trữ dự án"}


@router.get("/{project_id}/members")
async def list_members(project_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "project.view")
    return p.get("members", [])


@router.post("/{project_id}/members")
async def add_member(project_id: str, body: MemberIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "project.manage_members")
    if body.role not in rbac.PROJECT_ROLES:
        raise HTTPException(status_code=400, detail="Vai trò không hợp lệ")
    target = await db.users.find_one({"email": body.email.lower()})
    if not target:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng với email này")
    tid = str(target["_id"])
    members = [m for m in p.get("members", []) if m["user_id"] != tid]
    members.append({"user_id": tid, "name": target.get("name"), "email": target["email"], "role": body.role})
    await db.projects.update_one({"id": project_id}, {"$set": {"members": members}, "$inc": {"rev": 1}})
    await audit(project_id, "project", project_id, "grant", user,
                after={"email": body.email, "role": body.role}, restorable=True,
                label=f"Cấp quyền {body.role} cho {body.email}")
    return {"members": members}


@router.delete("/{project_id}/members/{user_id}")
async def remove_member(project_id: str, user_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "project.manage_members")
    removed = next((m for m in p.get("members", []) if m["user_id"] == user_id), None)
    members = [m for m in p.get("members", []) if m["user_id"] != user_id]
    await db.projects.update_one({"id": project_id}, {"$set": {"members": members}, "$inc": {"rev": 1}})
    await audit(project_id, "project", project_id, "revoke", user, before=removed, restorable=True,
                label=f"Thu hồi quyền {removed['email'] if removed else user_id}")
    return {"members": members}


@router.get("/{project_id}/team")
async def team_users(project_id: str, user: dict = Depends(A.get_current_user)):
    """Assignable users = project members."""
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "project.view")
    return p.get("members", [])
