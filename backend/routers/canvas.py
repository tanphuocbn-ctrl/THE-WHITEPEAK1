from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db, clean
import auth as A
import rbac
from common import new_id, now_iso, get_project_or_404, audit

router = APIRouter(prefix="/projects/{project_id}", tags=["canvas"])


class Node(BaseModel):
    id: str
    type: str
    x: float
    y: float
    w: Optional[float] = 180
    h: Optional[float] = 90
    title: Optional[str] = ""
    text: Optional[str] = ""
    color: Optional[str] = None
    ref_id: Optional[str] = None


class Edge(BaseModel):
    id: str
    source: str
    target: str


class CanvasSave(BaseModel):
    nodes: List[Node]
    edges: List[Edge]
    rev: int


class SnapshotIn(BaseModel):
    name: str


async def _get_or_create(project_id: str):
    doc = await db.canvases.find_one({"project_id": project_id})
    if not doc:
        doc = {"id": new_id(), "project_id": project_id, "nodes": [], "edges": [],
               "rev": 0, "updated_at": now_iso()}
        await db.canvases.insert_one(dict(doc))
    return clean(doc)


@router.get("/canvas")
async def get_canvas(project_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "canvas.view")
    return await _get_or_create(project_id)


@router.put("/canvas")
async def save_canvas(project_id: str, body: CanvasSave, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "canvas.write")
    await _get_or_create(project_id)
    res = await db.canvases.find_one_and_update(
        {"project_id": project_id, "rev": body.rev},
        {"$set": {"nodes": [n.model_dump() for n in body.nodes],
                  "edges": [e.model_dump() for e in body.edges],
                  "updated_at": now_iso()}, "$inc": {"rev": 1}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=409, detail="Xung đột phiên bản canvas: có bản lưu mới hơn, hãy tải lại.")
    return clean(res)


@router.get("/canvas/snapshots")
async def list_snapshots(project_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "canvas.view")
    docs = await db.canvas_snapshots.find({"project_id": project_id}).sort("created_at", -1).to_list(100)
    return [{k: v for k, v in clean(d).items() if k not in ("nodes", "edges")} for d in docs]


@router.post("/canvas/snapshots")
async def create_snapshot(project_id: str, body: SnapshotIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "canvas.write")
    cur = await _get_or_create(project_id)
    snap = {"id": new_id(), "project_id": project_id, "name": body.name,
            "nodes": cur["nodes"], "edges": cur["edges"],
            "node_count": len(cur["nodes"]), "created_by": user["id"],
            "created_by_name": user.get("name") or user["email"], "created_at": now_iso()}
    await db.canvas_snapshots.insert_one(dict(snap))
    await audit(project_id, "canvas", snap["id"], "snapshot", user,
                after={"name": body.name, "nodes": len(cur["nodes"])}, label=f"Lưu snapshot canvas: {body.name}")
    return {k: v for k, v in snap.items() if k not in ("nodes", "edges")}


@router.post("/canvas/snapshots/{snap_id}/restore")
async def restore_snapshot(project_id: str, snap_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "canvas.write")
    snap = await db.canvas_snapshots.find_one({"id": snap_id, "project_id": project_id})
    if not snap:
        raise HTTPException(status_code=404, detail="Không tìm thấy snapshot")
    res = await db.canvases.find_one_and_update(
        {"project_id": project_id},
        {"$set": {"nodes": snap["nodes"], "edges": snap["edges"], "updated_at": now_iso()},
         "$inc": {"rev": 1}}, return_document=True)
    await audit(project_id, "canvas", snap_id, "restore", user,
                after={"name": snap["name"]}, label=f"Khôi phục snapshot canvas: {snap['name']}")
    return clean(res)
