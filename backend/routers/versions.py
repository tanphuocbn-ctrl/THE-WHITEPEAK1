import os
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query, Header
from pydantic import BaseModel
from bson import ObjectId

from db import db, clean
import auth as A
import rbac
import storage
from common import new_id, now_iso, get_project_or_404, audit

router = APIRouter(prefix="/projects/{project_id}", tags=["versions"])

UPLOAD_DIR = "/app/.uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


class InitIn(BaseModel):
    filename: str
    content_type: Optional[str] = "application/octet-stream"
    total_size: int
    note: Optional[str] = ""


@router.get("/shots/{shot_id}/versions")
async def list_versions(project_id: str, shot_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "version.view")
    docs = await db.versions.find({"shot_id": shot_id}).sort("version_number", -1).to_list(1000)
    return [clean(d) for d in docs]


@router.post("/shots/{shot_id}/versions/init")
async def init_upload(project_id: str, shot_id: str, body: InitIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "version.upload")
    shot = await db.shots.find_one({"id": shot_id, "project_id": project_id})
    if not shot:
        raise HTTPException(status_code=404, detail="Không tìm thấy shot")
    upload_id = new_id()
    temp_path = os.path.join(UPLOAD_DIR, upload_id)
    open(temp_path, "wb").close()
    session = {
        "id": upload_id, "shot_id": shot_id, "project_id": project_id,
        "filename": body.filename, "content_type": body.content_type or "application/octet-stream",
        "total_size": body.total_size, "received": 0, "temp_path": temp_path,
        "note": body.note or "", "created_by": user["id"],
        "created_by_name": user.get("name") or user["email"],
        "status": "uploading", "created_at": now_iso(),
    }
    await db.upload_sessions.insert_one(dict(session))
    return {"upload_id": upload_id, "received": 0, "total_size": body.total_size}


@router.get("/uploads/{upload_id}")
async def upload_status(project_id: str, upload_id: str, user: dict = Depends(A.get_current_user)):
    s = await db.upload_sessions.find_one({"id": upload_id, "project_id": project_id})
    if not s:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên upload")
    return {"upload_id": upload_id, "received": s["received"], "total_size": s["total_size"], "status": s["status"]}


@router.put("/uploads/{upload_id}/chunk")
async def upload_chunk(project_id: str, upload_id: str, request: Request,
                       offset: int = Query(...), user: dict = Depends(A.get_current_user)):
    s = await db.upload_sessions.find_one({"id": upload_id, "project_id": project_id})
    if not s:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên upload")
    if s["status"] != "uploading":
        raise HTTPException(status_code=409, detail="Phiên upload đã đóng")
    # Resume-safe: reject gaps. Duplicate chunk (offset < received) is idempotent no-op up to received.
    if offset > s["received"]:
        raise HTTPException(status_code=409, detail=f"Sai offset, mong đợi {s['received']}")
    data = await request.body()
    with open(s["temp_path"], "r+b") as f:
        f.seek(offset)
        f.write(data)
    new_received = max(s["received"], offset + len(data))
    await db.upload_sessions.update_one({"id": upload_id}, {"$set": {"received": new_received}})
    return {"received": new_received, "total_size": s["total_size"]}


@router.post("/shots/{shot_id}/versions/complete")
async def complete_upload(project_id: str, shot_id: str, upload_id: str = Query(...),
                          user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "version.upload")
    s = await db.upload_sessions.find_one({"id": upload_id, "project_id": project_id, "shot_id": shot_id})
    if not s:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên upload")
    if s["status"] == "done":
        raise HTTPException(status_code=409, detail="Phiên đã hoàn tất")
    if s["received"] < s["total_size"]:
        raise HTTPException(status_code=400, detail=f"Chưa nhận đủ dữ liệu ({s['received']}/{s['total_size']})")
    with open(s["temp_path"], "rb") as f:
        content = f.read()
    ext = s["filename"].rsplit(".", 1)[-1] if "." in s["filename"] else "bin"
    path = f"{storage.APP_NAME}/{project_id}/{shot_id}/{upload_id}.{ext}"
    result = storage.put_object(path, content, s["content_type"])
    # Immutable version: number is monotonically increasing, never overwritten
    count = await db.versions.count_documents({"shot_id": shot_id})
    version_number = count + 1
    vdoc = {
        "id": new_id(), "shot_id": shot_id, "project_id": project_id,
        "version_number": version_number, "storage_path": result["path"],
        "original_filename": s["filename"], "content_type": s["content_type"],
        "size": result.get("size", len(content)), "note": s.get("note", ""),
        "uploaded_by": user["id"], "uploaded_by_name": s.get("created_by_name"),
        "status": "submitted", "is_deleted": False, "created_at": now_iso(),
    }
    await db.versions.insert_one(dict(vdoc))
    # selection-generation guards against a slow older upload clobbering a newer "latest"
    shot = await db.shots.find_one({"id": shot_id})
    gen = shot.get("version_generation", 0) + 1
    await db.shots.update_one(
        {"id": shot_id},
        {"$set": {"latest_version_id": vdoc["id"], "current_version_id": vdoc["id"],
                  "version_generation": gen, "status": "review", "updated_at": now_iso()},
         "$inc": {"rev": 1}},
    )
    await db.upload_sessions.update_one({"id": upload_id}, {"$set": {"status": "done"}})
    try:
        os.remove(s["temp_path"])
    except OSError:
        pass
    await audit(project_id, "version", vdoc["id"], "upload", user, after={"version_number": version_number,
                "filename": s["filename"]}, label=f"Nộp v{version_number} cho shot {shot.get('code')}")
    return clean(vdoc)


@router.get("/versions/{version_id}/download")
async def download_version(project_id: str, version_id: str,
                           authorization: str = Header(None), auth: str = Query(None)):
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    elif auth:
        token = auth
    if not token:
        raise HTTPException(status_code=401, detail="Chưa xác thực")
    try:
        payload = A.jwt.decode(token, A.get_jwt_secret(), algorithms=[A.JWT_ALGORITHM])
        u = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not u:
            raise HTTPException(status_code=401, detail="Không hợp lệ")
        cur = A.public_user(u)
    except Exception:
        raise HTTPException(status_code=401, detail="Token không hợp lệ")
    p = await get_project_or_404(project_id)
    rbac.require_cap(cur, p, "version.view")
    v = await db.versions.find_one({"id": version_id, "project_id": project_id, "is_deleted": False})
    if not v:
        raise HTTPException(status_code=404, detail="Không tìm thấy version")
    data, ct = storage.get_object(v["storage_path"])
    return Response(content=data, media_type=v.get("content_type", ct),
                    headers={"Content-Disposition": f'inline; filename="{v["original_filename"]}"'})
