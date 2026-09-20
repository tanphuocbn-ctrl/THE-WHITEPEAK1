from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, Response, Header, Query
from pydantic import BaseModel
from bson import ObjectId

from db import db, clean
import auth as A
import rbac
import storage
from common import new_id, now_iso, get_project_or_404, audit, check_rev

router = APIRouter(prefix="/projects/{project_id}/post", tags=["postproduction"])

TASK_STATUS = ["todo", "in_progress", "review", "done"]
ITEM_KINDS = ["edit", "export", "asset", "audio", "vfx"]


# ---------------- Post tasks ----------------
class TaskIn(BaseModel):
    sequence_id: str
    title: str
    note: Optional[str] = ""
    assignee_id: Optional[str] = None
    deadline: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    note: Optional[str] = None
    assignee_id: Optional[str] = None
    deadline: Optional[str] = None
    rev: int


async def _seq_or_404(project_id: str, sequence_id: str):
    s = await db.sequences.find_one({"id": sequence_id, "project_id": project_id})
    if not s:
        raise HTTPException(status_code=404, detail="Không tìm thấy sequence")
    return s


@router.get("/tasks")
async def list_tasks(project_id: str, sequence_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "post.view")
    docs = await db.post_tasks.find({"project_id": project_id, "sequence_id": sequence_id}).sort("created_at", 1).to_list(1000)
    return [clean(d) for d in docs]


@router.post("/tasks")
async def create_task(project_id: str, body: TaskIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "post.write")
    await _seq_or_404(project_id, body.sequence_id)
    assignee_name = None
    if body.assignee_id:
        m = next((m for m in p.get("members", []) if m["user_id"] == body.assignee_id), None)
        assignee_name = (m.get("name") or m.get("email")) if m else None
    doc = {"id": new_id(), "project_id": project_id, "sequence_id": body.sequence_id,
           "title": body.title, "note": body.note or "", "status": "todo",
           "assignee_id": body.assignee_id, "assignee_name": assignee_name,
           "deadline": body.deadline,
           "rev": 0, "created_at": now_iso(), "updated_at": now_iso()}
    await db.post_tasks.insert_one(dict(doc))
    await audit(project_id, "post_task", doc["id"], "create", user, after=doc, label=f"Tạo task hậu kỳ: {body.title}")
    return clean(doc)


@router.patch("/tasks/{tid}")
async def update_task(project_id: str, tid: str, body: TaskUpdate, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "post.write")
    doc = await db.post_tasks.find_one({"id": tid, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy task")
    check_rev(doc, body.rev)
    if body.status is not None and body.status not in TASK_STATUS:
        raise HTTPException(status_code=400, detail="Trạng thái không hợp lệ")
    changes = {k: v for k, v in body.model_dump(exclude={"rev"}).items() if v is not None}
    if "assignee_id" in changes:
        m = next((m for m in p.get("members", []) if m["user_id"] == changes["assignee_id"]), None)
        changes["assignee_name"] = (m.get("name") or m.get("email")) if m else None
    changes["updated_at"] = now_iso()
    res = await db.post_tasks.find_one_and_update({"id": tid, "rev": body.rev},
                                                  {"$set": changes, "$inc": {"rev": 1}}, return_document=True)
    if not res:
        raise HTTPException(status_code=409, detail="Xung đột phiên bản")
    await audit(project_id, "post_task", tid, "update", user, before=clean(doc), after=clean(dict(res)),
                restorable=True, label=f"Cập nhật task hậu kỳ: {res.get('title')}")
    return clean(res)


class BulkAssignTaskIn(BaseModel):
    task_ids: List[str]
    assignee_id: Optional[str] = None


@router.post("/tasks/bulk-assign")
async def bulk_assign_tasks(project_id: str, body: BulkAssignTaskIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "post.write")
    assignee_name = None
    if body.assignee_id:
        m = next((m for m in p.get("members", []) if m["user_id"] == body.assignee_id), None)
        assignee_name = (m.get("name") or m.get("email")) if m else None
    updated = 0
    for tid in body.task_ids:
        doc = await db.post_tasks.find_one({"id": tid, "project_id": project_id})
        if not doc:
            continue
        res = await db.post_tasks.find_one_and_update(
            {"id": tid, "rev": doc.get("rev", 0)},
            {"$set": {"assignee_id": body.assignee_id, "assignee_name": assignee_name, "updated_at": now_iso()},
             "$inc": {"rev": 1}}, return_document=True)
        if res:
            updated += 1
            await audit(project_id, "post_task", tid, "update", user, before=clean(doc), after=clean(dict(res)),
                        restorable=True, label=f"Giao hàng loạt task HK → {assignee_name or 'trống'}")
    return {"updated": updated, "assignee_name": assignee_name}


@router.delete("/tasks/{tid}")
async def delete_task(project_id: str, tid: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "post.write")
    doc = await db.post_tasks.find_one({"id": tid, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy task")
    await db.post_tasks.delete_one({"id": tid})
    await audit(project_id, "post_task", tid, "delete", user, before=clean(doc), restorable=True,
                label=f"Xóa task hậu kỳ: {doc.get('title')}")
    return {"message": "Đã xóa"}


# ---------------- Manifest (external ingest + export files) ----------------
class ExternalIn(BaseModel):
    sequence_id: str
    name: str
    url: str
    kind: Optional[str] = "edit"
    note: Optional[str] = ""
    is_final: Optional[bool] = False


@router.get("/manifest")
async def list_manifest(project_id: str, sequence_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "post.view")
    docs = await db.post_manifest.find({"project_id": project_id, "sequence_id": sequence_id}).sort("created_at", -1).to_list(1000)
    return [clean(d) for d in docs]


@router.post("/manifest/external")
async def add_external(project_id: str, body: ExternalIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "post.write")
    await _seq_or_404(project_id, body.sequence_id)
    if not (body.url.startswith("http://") or body.url.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL không hợp lệ")
    doc = {"id": new_id(), "project_id": project_id, "sequence_id": body.sequence_id,
           "name": body.name, "kind": body.kind if body.kind in ITEM_KINDS else "edit",
           "source_type": "external_url", "url": body.url, "storage_path": None,
           "size": None, "content_type": None, "note": body.note or "",
           "is_final": bool(body.is_final), "created_by": user["id"],
           "created_by_name": user.get("name") or user["email"], "created_at": now_iso()}
    await db.post_manifest.insert_one(dict(doc))
    await audit(project_id, "manifest", doc["id"], "ingest", user, after={"name": body.name, "url": body.url},
                label=f"Nhập ngoại file dựng: {body.name}")
    return clean(doc)


@router.post("/manifest/upload")
async def upload_manifest(project_id: str, sequence_id: str = Form(...), name: str = Form(...),
                          kind: str = Form("export"), is_final: bool = Form(False),
                          note: str = Form(""), file: UploadFile = File(...),
                          user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "post.write")
    await _seq_or_404(project_id, sequence_id)
    data = await file.read()
    mid = new_id()
    ext = (file.filename or "bin").rsplit(".", 1)[-1] if "." in (file.filename or "") else "bin"
    path = f"{storage.APP_NAME}/{project_id}/post/{sequence_id}/{mid}.{ext}"
    result = storage.put_object(path, data, file.content_type or "application/octet-stream")
    doc = {"id": mid, "project_id": project_id, "sequence_id": sequence_id,
           "name": name, "kind": kind if kind in ITEM_KINDS else "export",
           "source_type": "upload", "url": None, "storage_path": result["path"],
           "size": result.get("size", len(data)), "content_type": file.content_type,
           "original_filename": file.filename, "note": note or "",
           "is_final": bool(is_final), "created_by": user["id"],
           "created_by_name": user.get("name") or user["email"], "created_at": now_iso()}
    await db.post_manifest.insert_one(dict(doc))
    await audit(project_id, "manifest", mid, "upload", user, after={"name": name, "final": bool(is_final)},
                label=f"Tải lên bản xuất: {name}")
    return clean(doc)


@router.delete("/manifest/{mid}")
async def delete_manifest(project_id: str, mid: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "post.write")
    doc = await db.post_manifest.find_one({"id": mid, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy mục")
    await db.post_manifest.delete_one({"id": mid})
    await audit(project_id, "manifest", mid, "delete", user, before=clean(doc), restorable=True,
                label=f"Xóa mục manifest: {doc.get('name')}")
    return {"message": "Đã xóa"}


@router.get("/manifest/{mid}/download")
async def download_manifest(project_id: str, mid: str, request: Request,
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
    rbac.require_cap(cur, p, "post.view")
    m = await db.post_manifest.find_one({"id": mid, "project_id": project_id})
    if not m:
        raise HTTPException(status_code=404, detail="Không tìm thấy mục")
    if m["source_type"] != "upload":
        raise HTTPException(status_code=400, detail="Mục này là liên kết ngoài, mở bằng URL")
    content, ct = storage.get_object(m["storage_path"])
    fn = m.get("original_filename") or m["name"]
    return Response(content=content, media_type=m.get("content_type") or ct,
                    headers={"Content-Disposition": f'attachment; filename="{fn}"'})
