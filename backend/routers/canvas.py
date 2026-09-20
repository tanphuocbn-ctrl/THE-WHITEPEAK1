import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, Response, Header, Query
from pydantic import BaseModel, ConfigDict
from bson import ObjectId

from db import db, clean
import auth as A
import rbac
import storage
from common import new_id, now_iso, get_project_or_404, audit

router = APIRouter(prefix="/projects/{project_id}", tags=["canvas"])


class MediaItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    media_id: Optional[str] = None
    media_name: Optional[str] = None


class Node(BaseModel):
    model_config = ConfigDict(extra="allow")
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
    media_id: Optional[str] = None
    media_name: Optional[str] = None
    items: Optional[List[MediaItem]] = None
    locked: Optional[bool] = False


class Edge(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    source: str
    target: str
    label: Optional[str] = ""


class CanvasSave(BaseModel):
    nodes: List[Node]
    edges: List[Edge]
    rev: int


class SnapshotIn(BaseModel):
    name: str


async def _get_or_create(project_id: str, scene_id=None):
    doc = await db.canvases.find_one({"project_id": project_id, "scene_id": scene_id})
    if not doc:
        doc = {"id": new_id(), "project_id": project_id, "scene_id": scene_id, "nodes": [], "edges": [],
               "rev": 0, "updated_at": now_iso()}
        await db.canvases.insert_one(dict(doc))
    return clean(doc)


@router.get("/canvas")
async def get_canvas(project_id: str, scene_id: str = Query(None), user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "canvas.view")
    return await _get_or_create(project_id, scene_id)


@router.put("/canvas")
async def save_canvas(project_id: str, body: CanvasSave, scene_id: str = Query(None), user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "canvas.write")
    await _get_or_create(project_id, scene_id)
    res = await db.canvases.find_one_and_update(
        {"project_id": project_id, "scene_id": scene_id, "rev": body.rev},
        {"$set": {"nodes": [n.model_dump() for n in body.nodes],
                  "edges": [e.model_dump() for e in body.edges],
                  "updated_at": now_iso()}, "$inc": {"rev": 1}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=409, detail="Xung đột phiên bản canvas: có bản lưu mới hơn, hãy tải lại.")
    return clean(res)


@router.post("/canvas/media")
async def upload_canvas_media(project_id: str, file: UploadFile = File(...), user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "canvas.write")
    ct = file.content_type or ""
    if not ct.startswith("image/"):
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ ảnh (PNG/JPG/WebP)")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ảnh tối đa 10MB")
    mid = new_id()
    ext = (file.filename or "img").rsplit(".", 1)[-1] if "." in (file.filename or "") else "png"
    path = f"{storage.APP_NAME}/{project_id}/canvas/{mid}.{ext}"
    result = storage.put_object(path, data, ct)
    await db.canvas_media.insert_one({
        "id": mid, "project_id": project_id, "storage_path": result["path"],
        "content_type": ct, "filename": file.filename, "size": result.get("size", len(data)),
        "created_by": user["id"], "created_at": now_iso(),
    })
    return {"media_id": mid, "filename": file.filename, "content_type": ct}


@router.get("/canvas/media/{media_id}")
async def get_canvas_media(project_id: str, media_id: str, request: Request,
                           authorization: str = Header(None), auth: str = Query(None)):
    token = request.cookies.get("access_token")
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token and auth:
        token = auth
    if not token:
        raise HTTPException(status_code=401, detail="Chưa xác thực")
    try:
        payload = A.jwt.decode(token, A.get_jwt_secret(), algorithms=[A.JWT_ALGORITHM])
        u = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not u:
            raise HTTPException(status_code=401, detail="Không hợp lệ")
        cur = A.public_user(u)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token không hợp lệ")
    p = await get_project_or_404(project_id)
    rbac.require_cap(cur, p, "canvas.view")
    m = await db.canvas_media.find_one({"id": media_id, "project_id": project_id})
    if not m:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh")
    content, ct = storage.get_object(m["storage_path"])
    return Response(content=content, media_type=m.get("content_type", ct),
                    headers={"Cache-Control": "private, max-age=3600"})


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
        {"project_id": project_id, "scene_id": None},
        {"$set": {"nodes": snap["nodes"], "edges": snap["edges"], "updated_at": now_iso()},
         "$inc": {"rev": 1}}, return_document=True)
    await audit(project_id, "canvas", snap_id, "restore", user,
                after={"name": snap["name"]}, label=f"Khôi phục snapshot canvas: {snap['name']}")
    return clean(res)


def _res_item(r):
    return {"media_id": r.get("media_id"), "media_name": r.get("name")} if r and r.get("media_id") else None


@router.post("/canvas/build-scenes")
async def build_scenes(project_id: str, user: dict = Depends(A.get_current_user)):
    """Auto-build one moodboard Frame per scene in the project canvas + a per-scene canvas,
    filled with the scene's background + assigned character images + design image."""
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "canvas.write")
    scenes = await db.scenes.find({"project_id": project_id}).sort("order", 1).to_list(2000)
    resources = await db.resources.find({"project_id": project_id}).to_list(2000)
    rmap = {r["id"]: r for r in resources}

    cur = await _get_or_create(project_id, None)
    nodes = cur["nodes"]
    frame_by_ref = {n.get("ref_id"): n for n in nodes if n.get("type") == "frame" and n.get("ref_id")}
    others = [n for n in nodes if not (n.get("type") == "frame" and n.get("ref_id"))]

    new_frames = []
    cols = 2
    for i, sc in enumerate(scenes):
        bg = rmap.get(sc.get("background_id"))
        chars = [rmap.get(cid) for cid in (sc.get("characters") or [])]
        items = []
        bi = _res_item(bg)
        if bi:
            items.append(bi)
        for c in chars:
            ci = _res_item(c)
            if ci:
                items.append(ci)
        di = {"media_id": sc.get("design_media_id"), "media_name": "Thiết kế"} if sc.get("design_media_id") else None
        if di:
            items.append(di)
        title = f"{sc.get('code')} · {sc.get('title')}"
        prev = frame_by_ref.get(sc["id"])
        if prev:
            prev = dict(prev)
            prev["title"] = title
            prev["items"] = items
            new_frames.append(prev)
        else:
            new_frames.append({
                "id": new_id(), "type": "frame", "ref_id": sc["id"],
                "x": 40 + (i % cols) * 540, "y": 40 + (i // cols) * 440,
                "w": 500, "h": 360, "title": title, "text": sc.get("design_note") or "",
                "color": "#3b82f6", "items": items, "locked": False,
            })

        # Build the per-scene dedicated canvas
        snodes = []
        if bi:
            snodes.append({"id": new_id(), "type": "media", "x": 40, "y": 40, "w": 560, "h": 320,
                           "title": f"Bối cảnh: {bg.get('name')}", "color": "#10b981",
                           "media_id": bi["media_id"], "media_name": bi["media_name"]})
        cx = 40
        for c in chars:
            ci = _res_item(c)
            snodes.append({"id": new_id(), "type": "character", "x": cx, "y": 400, "w": 190, "h": 230,
                           "title": c.get("name"), "text": c.get("description") or "", "color": "#f59e0b",
                           **({"media_id": ci["media_id"], "media_name": ci["media_name"]} if ci else {})})
            cx += 210
        if sc.get("design_media_id"):
            snodes.append({"id": new_id(), "type": "media", "x": 640, "y": 40, "w": 320, "h": 220,
                           "title": "Scene design", "color": "#ec4899",
                           "media_id": sc["design_media_id"], "media_name": "Thiết kế"})
        if sc.get("design_note"):
            snodes.append({"id": new_id(), "type": "comment", "x": 640, "y": 290, "w": 320, "h": 140,
                           "title": "Ghi chú thiết kế", "text": sc.get("design_note"), "color": "#eab308"})
        sdoc = await db.canvases.find_one({"project_id": project_id, "scene_id": sc["id"]})
        if not sdoc:
            # Only auto-populate a scene canvas the first time; never overwrite user edits on rebuild.
            await db.canvases.insert_one({"id": new_id(), "project_id": project_id, "scene_id": sc["id"],
                                          "nodes": snodes, "edges": [], "rev": 0, "updated_at": now_iso()})

    merged = others + new_frames
    res = await db.canvases.find_one_and_update(
        {"project_id": project_id, "scene_id": None},
        {"$set": {"nodes": merged, "updated_at": now_iso()}, "$inc": {"rev": 1}}, return_document=True)
    await audit(project_id, "canvas", project_id, "build", user,
                after={"frames": len(new_frames)}, label=f"Dựng canvas theo scene ({len(new_frames)} khung)")
    return clean(res)
