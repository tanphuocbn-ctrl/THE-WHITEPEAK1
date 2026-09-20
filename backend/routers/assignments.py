from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db, clean
import auth as A
import rbac
from common import now_iso, get_project_or_404, audit, check_rev

router = APIRouter(prefix="/projects/{project_id}", tags=["assignments"])

VALID_STATUS = ["todo", "in_progress", "review", "rejected", "approved", "done"]


class AssignIn(BaseModel):
    assignee_id: Optional[str] = None
    deadline: Optional[str] = None
    rev: int


class StatusIn(BaseModel):
    status: str
    rev: int


@router.post("/shots/{shot_id}/assign")
async def assign_shot(project_id: str, shot_id: str, body: AssignIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "assignment.write")
    shot = await db.shots.find_one({"id": shot_id, "project_id": project_id})
    if not shot:
        raise HTTPException(status_code=404, detail="Không tìm thấy shot")
    check_rev(shot, body.rev)
    assignee_name = None
    if body.assignee_id:
        member = next((m for m in p.get("members", []) if m["user_id"] == body.assignee_id), None)
        if not member:
            raise HTTPException(status_code=400, detail="Người được giao phải là thành viên dự án")
        assignee_name = member.get("name") or member.get("email")
    changes = {"assignee_id": body.assignee_id, "assignee_name": assignee_name,
               "deadline": body.deadline, "updated_at": now_iso()}
    if body.assignee_id and shot.get("status") == "todo":
        changes["status"] = "in_progress"
    res = await db.shots.find_one_and_update({"id": shot_id, "rev": body.rev},
                                             {"$set": changes, "$inc": {"rev": 1}}, return_document=True)
    if not res:
        raise HTTPException(status_code=409, detail="Xung đột phiên bản")
    await audit(project_id, "shot", shot_id, "assign", user, before=clean(shot), after=clean(dict(res)),
                restorable=True, label=f"Phân công shot {res.get('code')} cho {assignee_name or 'trống'}")
    return clean(res)


@router.post("/shots/{shot_id}/status")
async def set_status(project_id: str, shot_id: str, body: StatusIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "assignment.write")
    if body.status not in VALID_STATUS:
        raise HTTPException(status_code=400, detail="Trạng thái không hợp lệ")
    shot = await db.shots.find_one({"id": shot_id, "project_id": project_id})
    if not shot:
        raise HTTPException(status_code=404, detail="Không tìm thấy shot")
    check_rev(shot, body.rev)
    res = await db.shots.find_one_and_update({"id": shot_id, "rev": body.rev},
                                             {"$set": {"status": body.status, "updated_at": now_iso()}, "$inc": {"rev": 1}},
                                             return_document=True)
    if not res:
        raise HTTPException(status_code=409, detail="Xung đột phiên bản")
    await audit(project_id, "shot", shot_id, "status", user, before={"status": shot.get("status")},
                after={"status": body.status}, restorable=True, label=f"Đổi trạng thái shot {res.get('code')} → {body.status}")
    return clean(res)


@router.get("/board")
async def board(project_id: str, mine: bool = False, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "assignment.view")
    q = {"project_id": project_id}
    if mine:
        q["assignee_id"] = user["id"]
    shots = await db.shots.find(q).sort("deadline", 1).to_list(5000)
    scenes = {s["id"]: s for s in await db.scenes.find({"project_id": project_id}).to_list(5000)}
    out = []
    for s in shots:
        s = clean(s)
        sc = scenes.get(s.get("scene_id"), {})
        s["scene_code"] = sc.get("code")
        s["scene_title"] = sc.get("title")
        out.append(s)
    return out
