import io
import re
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from db import db, clean
import auth as A
import rbac
from common import new_id, now_iso, get_project_or_404, audit

router = APIRouter(prefix="/projects/{project_id}", tags=["scripts"])

HEADING_RE = re.compile(
    r"^\s*(?:(?:INT|EXT|NỘI|NGOẠI|I/E)[\.\s]|CẢNH\s|SCENE\s|\d+[\.\)]\s)",
    re.IGNORECASE,
)


def extract_text_from_docx(data: bytes) -> str:
    import docx
    doc = docx.Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs)


def extract_text_from_pdf(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def parse_script(text: str) -> List[dict]:
    lines = [l.rstrip() for l in text.splitlines()]
    scenes = []
    current = None
    idx = 0
    for line in lines:
        if not line.strip():
            if current:
                current["body"].append("")
            continue
        if HEADING_RE.match(line):
            if current:
                current["description"] = "\n".join(current.pop("body")).strip()
                scenes.append(current)
            idx += 1
            current = {"code": f"S{idx}", "heading": line.strip(), "title": line.strip()[:120], "body": []}
        else:
            if current is None:
                idx += 1
                current = {"code": f"S{idx}", "heading": "(Mở đầu)", "title": "(Mở đầu)", "body": [line]}
            else:
                current["body"].append(line)
    if current:
        current["description"] = "\n".join(current.pop("body")).strip()
        scenes.append(current)
    return scenes


class ManualIn(BaseModel):
    raw_text: str


class ConfirmIn(BaseModel):
    sequence_title: Optional[str] = "Kịch bản nhập"
    selected_codes: Optional[List[str]] = None  # None = all new


async def _create_staging(project_id: str, source_type: str, filename: str, text: str, user: dict):
    parsed = parse_script(text)
    if not parsed:
        raise HTTPException(status_code=400, detail="Không tách được scene nào từ nội dung")
    doc = {
        "id": new_id(), "project_id": project_id, "source_type": source_type,
        "filename": filename, "raw_text": text, "parsed_scenes": parsed,
        "status": "staging", "created_by": user["id"], "created_at": now_iso(),
    }
    await db.script_stagings.insert_one(dict(doc))
    await audit(project_id, "script", doc["id"], "stage", user,
                after={"scenes": len(parsed), "source": source_type}, label=f"Nhập kịch bản ({len(parsed)} scene)")
    return doc


@router.post("/scripts/upload")
async def upload_script(project_id: str, file: UploadFile = File(...), user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "script.write")
    data = await file.read()
    name = (file.filename or "").lower()
    if name.endswith(".docx"):
        text = extract_text_from_docx(data)
    elif name.endswith(".pdf"):
        text = extract_text_from_pdf(data)
    elif name.endswith(".txt"):
        text = data.decode("utf-8", errors="ignore")
    else:
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ DOCX, PDF, TXT")
    doc = await _create_staging(project_id, name.rsplit(".", 1)[-1], file.filename, text, user)
    return clean(doc)


@router.post("/scripts/manual")
async def manual_script(project_id: str, body: ManualIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "script.write")
    doc = await _create_staging(project_id, "manual", "Nhập tay", body.raw_text, user)
    return clean(doc)


@router.get("/scripts/stagings")
async def list_stagings(project_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "script.view")
    docs = await db.script_stagings.find({"project_id": project_id}).sort("created_at", -1).to_list(200)
    return [{k: v for k, v in clean(d).items() if k != "raw_text"} for d in docs]


@router.get("/scripts/stagings/{staging_id}/diff")
async def staging_diff(project_id: str, staging_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "script.view")
    st = await db.script_stagings.find_one({"id": staging_id, "project_id": project_id})
    if not st:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản nhập")
    existing = await db.scenes.find({"project_id": project_id}).to_list(5000)
    existing_titles = {e.get("title", "").strip() for e in existing}
    diff = []
    for s in st["parsed_scenes"]:
        is_new = s["title"].strip() not in existing_titles
        diff.append({"code": s["code"], "title": s["title"], "heading": s.get("heading"),
                     "description": s.get("description", ""), "status": "added" if is_new else "exists"})
    return {"staging": clean(st), "diff": diff,
            "summary": {"added": sum(1 for d in diff if d["status"] == "added"),
                        "exists": sum(1 for d in diff if d["status"] == "exists")}}


@router.post("/scripts/stagings/{staging_id}/confirm")
async def confirm_staging(project_id: str, staging_id: str, body: ConfirmIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "script.write")
    st = await db.script_stagings.find_one({"id": staging_id, "project_id": project_id})
    if not st:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản nhập")
    if st["status"] == "confirmed":
        raise HTTPException(status_code=409, detail="Bản nhập đã được xác nhận")
    # Additive only: never overwrite existing scenes/shots/assignments/reviews
    existing = await db.scenes.find({"project_id": project_id}).to_list(5000)
    existing_titles = {e.get("title", "").strip() for e in existing}
    # Only new (non-duplicate) scenes get imported — never overwrite existing
    to_create = [s for s in st["parsed_scenes"]
                 if (body.selected_codes is None or s["code"] in body.selected_codes)
                 and s["title"].strip() not in existing_titles]
    if not to_create:
        await db.script_stagings.update_one({"id": staging_id}, {"$set": {"status": "confirmed"}})
        return {"created_scenes": 0, "sequence_id": None}
    seq = {"id": new_id(), "project_id": project_id, "code": "SEQ-IMP",
           "title": body.sequence_title or "Kịch bản nhập",
           "order": await db.sequences.count_documents({"project_id": project_id}),
           "rev": 0, "created_at": now_iso(), "updated_at": now_iso()}
    await db.sequences.insert_one(dict(seq))
    created = 0
    order = 0
    for s in to_create:
        order += 1
        scene = {"id": new_id(), "project_id": project_id, "sequence_id": seq["id"],
                 "code": s["code"], "title": s["title"], "description": s.get("description", ""),
                 "location": "", "time_of_day": "", "script_content": s.get("heading", ""),
                 "characters": [], "order": order, "rev": 0,
                 "created_at": now_iso(), "updated_at": now_iso()}
        await db.scenes.insert_one(dict(scene))
        created += 1
    await db.script_stagings.update_one({"id": staging_id}, {"$set": {"status": "confirmed"}})
    await audit(project_id, "script", staging_id, "confirm", user,
                after={"created_scenes": created}, restorable=True,
                label=f"Xác nhận kịch bản: tạo {created} scene mới")
    return {"created_scenes": created, "sequence_id": seq["id"]}
