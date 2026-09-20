from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db, clean
import auth as A
import rbac
from common import new_id, now_iso, get_project_or_404, audit, check_rev, sync_ref_nodes

router = APIRouter(prefix="/projects/{project_id}", tags=["structure"])

VALID_SHOT_STATUS = ["todo", "in_progress", "review", "rejected", "approved", "done"]


# ---------------- Sequences ----------------
class SequenceIn(BaseModel):
    code: str
    title: str
    order: Optional[int] = 0


class SequenceUpdate(BaseModel):
    code: Optional[str] = None
    title: Optional[str] = None
    order: Optional[int] = None
    rev: int


@router.get("/sequences")
async def list_sequences(project_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.view")
    docs = await db.sequences.find({"project_id": project_id}).sort("order", 1).to_list(1000)
    return [clean(d) for d in docs]


@router.post("/sequences")
async def create_sequence(project_id: str, body: SequenceIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = {"id": new_id(), "project_id": project_id, "code": body.code, "title": body.title,
           "order": body.order or 0, "rev": 0, "created_at": now_iso(), "updated_at": now_iso()}
    await db.sequences.insert_one(dict(doc))
    await audit(project_id, "sequence", doc["id"], "create", user, after=doc, label=f"Tạo sequence {body.code}")
    return clean(doc)


@router.patch("/sequences/{seq_id}")
async def update_sequence(project_id: str, seq_id: str, body: SequenceUpdate, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = await db.sequences.find_one({"id": seq_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy sequence")
    check_rev(doc, body.rev)
    changes = {k: v for k, v in body.model_dump(exclude={"rev"}).items() if v is not None}
    changes["updated_at"] = now_iso()
    res = await db.sequences.find_one_and_update({"id": seq_id, "rev": body.rev},
                                                 {"$set": changes, "$inc": {"rev": 1}}, return_document=True)
    if not res:
        raise HTTPException(status_code=409, detail="Xung đột phiên bản")
    await audit(project_id, "sequence", seq_id, "update", user, before=clean(doc), after=clean(dict(res)),
                restorable=True, label=f"Sửa sequence {res.get('code')}")
    return clean(res)


@router.delete("/sequences/{seq_id}")
async def delete_sequence(project_id: str, seq_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = await db.sequences.find_one({"id": seq_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy sequence")
    scene_count = await db.scenes.count_documents({"sequence_id": seq_id})
    if scene_count > 0:
        raise HTTPException(status_code=400, detail="Không thể xóa: sequence còn scene bên trong")
    await db.sequences.delete_one({"id": seq_id})
    await audit(project_id, "sequence", seq_id, "delete", user, before=clean(doc), restorable=True,
                label=f"Xóa sequence {doc.get('code')}")
    return {"message": "Đã xóa"}


# ---------------- Scenes ----------------
class SceneIn(BaseModel):
    sequence_id: str
    code: str
    title: str
    description: Optional[str] = ""
    location: Optional[str] = ""
    time_of_day: Optional[str] = ""
    order: Optional[int] = 0


class SceneUpdate(BaseModel):
    code: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    time_of_day: Optional[str] = None
    script_content: Optional[str] = None
    order: Optional[int] = None
    rev: int


@router.get("/scenes")
async def list_scenes(project_id: str, sequence_id: Optional[str] = None, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.view")
    q = {"project_id": project_id}
    if sequence_id:
        q["sequence_id"] = sequence_id
    docs = await db.scenes.find(q).sort("order", 1).to_list(2000)
    return [clean(d) for d in docs]


@router.post("/scenes")
async def create_scene(project_id: str, body: SceneIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = {"id": new_id(), "project_id": project_id, "sequence_id": body.sequence_id,
           "code": body.code, "title": body.title, "description": body.description or "",
           "location": body.location or "", "time_of_day": body.time_of_day or "",
           "script_content": "", "characters": [], "order": body.order or 0,
           "rev": 0, "created_at": now_iso(), "updated_at": now_iso()}
    await db.scenes.insert_one(dict(doc))
    await audit(project_id, "scene", doc["id"], "create", user, after=doc, label=f"Tạo scene {body.code}")
    return clean(doc)


@router.get("/scenes/{scene_id}")
async def get_scene(project_id: str, scene_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.view")
    doc = await db.scenes.find_one({"id": scene_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy scene")
    return clean(doc)


@router.patch("/scenes/{scene_id}")
async def update_scene(project_id: str, scene_id: str, body: SceneUpdate, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = await db.scenes.find_one({"id": scene_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy scene")
    check_rev(doc, body.rev)
    changes = {k: v for k, v in body.model_dump(exclude={"rev"}).items() if v is not None}
    changes["updated_at"] = now_iso()
    res = await db.scenes.find_one_and_update({"id": scene_id, "rev": body.rev},
                                              {"$set": changes, "$inc": {"rev": 1}}, return_document=True)
    if not res:
        raise HTTPException(status_code=409, detail="Xung đột phiên bản")
    await audit(project_id, "scene", scene_id, "update", user, before=clean(doc), after=clean(dict(res)),
                restorable=True, label=f"Sửa scene {res.get('code')}")
    if "code" in changes or "title" in changes:
        await sync_ref_nodes(project_id, scene_id, "scene", f"{res.get('code')} · {res.get('title')}")
    return clean(res)


@router.delete("/scenes/{scene_id}")
async def delete_scene(project_id: str, scene_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = await db.scenes.find_one({"id": scene_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy scene")
    if await db.shots.count_documents({"scene_id": scene_id}) > 0:
        raise HTTPException(status_code=400, detail="Không thể xóa: scene còn shot bên trong")
    await db.scenes.delete_one({"id": scene_id})
    await audit(project_id, "scene", scene_id, "delete", user, before=clean(doc), restorable=True,
                label=f"Xóa scene {doc.get('code')}")
    return {"message": "Đã xóa"}


# ---------------- Shots ----------------
class ShotIn(BaseModel):
    scene_id: str
    code: str
    title: str
    description: Optional[str] = ""
    shot_type: Optional[str] = ""


class ShotUpdate(BaseModel):
    code: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    shot_type: Optional[str] = None
    rev: int


@router.get("/shots")
async def list_shots(project_id: str, scene_id: Optional[str] = None, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.view")
    q = {"project_id": project_id}
    if scene_id:
        q["scene_id"] = scene_id
    docs = await db.shots.find(q).sort("created_at", 1).to_list(5000)
    return [clean(d) for d in docs]


@router.post("/shots")
async def create_shot(project_id: str, body: ShotIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    scene = await db.scenes.find_one({"id": body.scene_id, "project_id": project_id})
    if not scene:
        raise HTTPException(status_code=404, detail="Không tìm thấy scene")
    doc = {"id": new_id(), "project_id": project_id, "scene_id": body.scene_id,
           "sequence_id": scene.get("sequence_id"),
           "code": body.code, "title": body.title, "description": body.description or "",
           "shot_type": body.shot_type or "", "status": "todo",
           "assignee_id": None, "assignee_name": None, "deadline": None,
           "current_version_id": None, "approved_version_id": None, "latest_version_id": None,
           "version_generation": 0, "rev": 0, "created_at": now_iso(), "updated_at": now_iso()}
    await db.shots.insert_one(dict(doc))
    await audit(project_id, "shot", doc["id"], "create", user, after=doc, label=f"Tạo shot {body.code}")
    return clean(doc)


@router.get("/shots/{shot_id}")
async def get_shot(project_id: str, shot_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.view")
    doc = await db.shots.find_one({"id": shot_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy shot")
    return clean(doc)


@router.patch("/shots/{shot_id}")
async def update_shot(project_id: str, shot_id: str, body: ShotUpdate, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = await db.shots.find_one({"id": shot_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy shot")
    check_rev(doc, body.rev)
    changes = {k: v for k, v in body.model_dump(exclude={"rev"}).items() if v is not None}
    changes["updated_at"] = now_iso()
    res = await db.shots.find_one_and_update({"id": shot_id, "rev": body.rev},
                                             {"$set": changes, "$inc": {"rev": 1}}, return_document=True)
    if not res:
        raise HTTPException(status_code=409, detail="Xung đột phiên bản")
    await audit(project_id, "shot", shot_id, "update", user, before=clean(doc), after=clean(dict(res)),
                restorable=True, label=f"Sửa shot {res.get('code')}")
    if "code" in changes or "title" in changes:
        await sync_ref_nodes(project_id, shot_id, "shot", f"{res.get('code')} · {res.get('title')}")
    return clean(res)


@router.delete("/shots/{shot_id}")
async def delete_shot(project_id: str, shot_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = await db.shots.find_one({"id": shot_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy shot")
    await db.shots.delete_one({"id": shot_id})
    await audit(project_id, "shot", shot_id, "delete", user, before=clean(doc), restorable=True,
                label=f"Xóa shot {doc.get('code')}")
    return {"message": "Đã xóa"}
