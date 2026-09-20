import io
import os
import re
import json
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


class AIParseIn(BaseModel):
    raw_text: str
    provider: Optional[str] = "gemini"
    model: Optional[str] = None


AI_DEFAULT_MODELS = {
    "gemini": "gemini-3.1-pro-preview",
    "openai": "gpt-5.4",
    "anthropic": "claude-sonnet-4-6",
}

AI_SYSTEM = (
    "Bạn là trợ lý phân tích kịch bản phim. Nhiệm vụ: tách nội dung kịch bản thành danh sách cảnh (scene). "
    "CHỈ trả về JSON hợp lệ dạng mảng, không giải thích, không markdown. "
    'Mỗi phần tử: {"code": "S1", "heading": "tiêu đề cảnh gốc", "title": "tiêu đề ngắn", '
    '"location": "bối cảnh", "time_of_day": "ngày/đêm...", "description": "tóm tắt nội dung cảnh"}. '
    "Đánh số code S1, S2, ... theo thứ tự xuất hiện."
)


def _extract_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    # Prefer array; fall back to a single object or an object wrapping a list
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end != -1 and end > start:
        return json.loads(text[start:end + 1])
    ostart, oend = text.find("{"), text.rfind("}")
    if ostart != -1 and oend != -1:
        obj = json.loads(text[ostart:oend + 1])
        if isinstance(obj, dict):
            for v in obj.values():
                if isinstance(v, list):
                    return v
            return [obj]
        return obj
    return json.loads(text)


@router.post("/scripts/ai-parse")
async def ai_parse_script(project_id: str, body: AIParseIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "script.write")
    provider = (body.provider or "gemini").lower()
    if provider not in AI_DEFAULT_MODELS:
        raise HTTPException(status_code=400, detail="Provider không hỗ trợ (openai/gemini/anthropic)")
    model = body.model or AI_DEFAULT_MODELS[provider]
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Chưa cấu hình EMERGENT_LLM_KEY")
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=key, session_id=f"script-{project_id}-{new_id()}",
                       system_message=AI_SYSTEM).with_model(provider, model)
        reply = await chat.send_message(UserMessage(text=body.raw_text[:120000]))
        scenes_raw = _extract_json(reply if isinstance(reply, str) else str(reply))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI tách kịch bản lỗi: {e}. Hãy dùng nhập tay.")
    parsed = []
    for i, s in enumerate(scenes_raw, start=1):
        if not isinstance(s, dict):
            continue
        parsed.append({
            "code": s.get("code") or f"S{i}",
            "heading": s.get("heading") or s.get("title") or f"Cảnh {i}",
            "title": (s.get("title") or s.get("heading") or f"Cảnh {i}")[:120],
            "location": s.get("location", ""),
            "time_of_day": s.get("time_of_day", ""),
            "description": s.get("description", ""),
        })
    if not parsed:
        raise HTTPException(status_code=502, detail="AI không tách được cảnh nào. Hãy dùng nhập tay.")
    doc = {
        "id": new_id(), "project_id": project_id, "source_type": f"ai:{provider}",
        "filename": f"AI · {provider}", "raw_text": body.raw_text, "parsed_scenes": parsed,
        "ai_provider": provider, "ai_model": model,
        "cost_note": f"{provider}/{model} · input {len(body.raw_text)} ký tự → {len(parsed)} cảnh",
        "status": "staging", "created_by": user["id"], "created_at": now_iso(),
    }
    await db.script_stagings.insert_one(dict(doc))
    await audit(project_id, "script", doc["id"], "stage", user,
                after={"scenes": len(parsed), "source": f"ai:{provider}", "model": model},
                label=f"Nhập kịch bản bằng AI ({provider} · {len(parsed)} cảnh)")
    return clean(doc)


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
