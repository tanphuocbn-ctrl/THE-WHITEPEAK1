import os
import re
import json
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db, clean
import auth as A
import rbac
from common import new_id, now_iso, get_project_or_404, audit

router = APIRouter(prefix="/projects/{project_id}", tags=["resources"])

VALID_KINDS = ("character", "background")


class ResourceIn(BaseModel):
    kind: str
    name: str
    description: Optional[str] = ""


class ResourceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    media_id: Optional[str] = None
    media_name: Optional[str] = None


@router.get("/resources")
async def list_resources(project_id: str, kind: Optional[str] = None, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.view")
    q = {"project_id": project_id}
    if kind:
        q["kind"] = kind
    docs = await db.resources.find(q).sort("created_at", 1).to_list(2000)
    return [clean(d) for d in docs]


@router.post("/resources")
async def create_resource(project_id: str, body: ResourceIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    if body.kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail="Loại tài nguyên không hợp lệ")
    doc = {"id": new_id(), "project_id": project_id, "kind": body.kind, "name": body.name,
           "description": body.description or "", "media_id": None, "media_name": None,
           "created_at": now_iso(), "updated_at": now_iso()}
    await db.resources.insert_one(dict(doc))
    await audit(project_id, "resource", doc["id"], "create", user, after=doc,
                label=f"Tạo {('nhân vật' if body.kind=='character' else 'bối cảnh')}: {body.name}")
    return clean(doc)


@router.patch("/resources/{rid}")
async def update_resource(project_id: str, rid: str, body: ResourceUpdate, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = await db.resources.find_one({"id": rid, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài nguyên")
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    changes["updated_at"] = now_iso()
    res = await db.resources.find_one_and_update({"id": rid}, {"$set": changes}, return_document=True)
    return clean(res)


@router.delete("/resources/{rid}")
async def delete_resource(project_id: str, rid: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    doc = await db.resources.find_one({"id": rid, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài nguyên")
    await db.resources.delete_one({"id": rid})
    # unlink from scenes
    await db.scenes.update_many({"project_id": project_id, "characters": rid}, {"$pull": {"characters": rid}})
    await db.scenes.update_many({"project_id": project_id, "background_id": rid}, {"$set": {"background_id": None}})
    await audit(project_id, "resource", rid, "delete", user, before=clean(doc), restorable=True,
                label=f"Xóa tài nguyên: {doc.get('name')}")
    return {"message": "Đã xóa"}


AUTO_SYSTEM = (
    "Bạn là trợ lý phân tích kịch bản phim. Với mỗi cảnh (scene) và danh sách nhân vật cho sẵn, "
    "hãy xác định những nhân vật NÀO trong danh sách xuất hiện trong cảnh đó và bối cảnh (địa điểm) của cảnh. "
    "CHỈ trả về JSON hợp lệ dạng mảng, không giải thích, không markdown. "
    'Mỗi phần tử: {"scene_code": "S1", "characters": ["Tên A","Tên B"], "location": "địa điểm"}. '
    "Chỉ dùng đúng tên nhân vật có trong danh sách được cung cấp."
)


def _extract_json(text: str):
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    s, e = text.find("["), text.rfind("]")
    if s != -1 and e != -1 and e > s:
        return json.loads(text[s:e + 1])
    return json.loads(text)


@router.post("/resources/auto-map")
async def auto_map(project_id: str, user: dict = Depends(A.get_current_user)):
    """Use AI to detect which characters appear + the location of each scene, then map to the
    project's resource library (characters by name, background by location) and save onto scenes."""
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "structure.write")
    scenes = await db.scenes.find({"project_id": project_id}).sort("order", 1).to_list(2000)
    if not scenes:
        raise HTTPException(status_code=400, detail="Chưa có scene nào để phân bổ")
    resources = await db.resources.find({"project_id": project_id}).to_list(2000)
    characters = [r for r in resources if r["kind"] == "character"]
    backgrounds = [r for r in resources if r["kind"] == "background"]
    if not characters and not backgrounds:
        raise HTTPException(status_code=400, detail="Chưa có nhân vật/bối cảnh nào trong thư viện")

    char_by_name = {c["name"].strip().lower(): c["id"] for c in characters}
    char_names = [c["name"] for c in characters]

    scene_payload = []
    for sc in scenes:
        txt = (sc.get("script_content") or sc.get("description") or sc.get("title") or "")[:1500]
        scene_payload.append({"scene_code": sc.get("code"), "title": sc.get("title"),
                              "heading": sc.get("script_content") or sc.get("title"), "text": txt})

    mapping = {}
    key = os.environ.get("EMERGENT_LLM_KEY")
    ai_used = False
    if char_names and key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            chat = LlmChat(api_key=key, session_id=f"automap-{project_id}-{new_id()}",
                           system_message=AUTO_SYSTEM).with_model("gemini", "gemini-3.1-pro-preview")
            prompt = ("DANH SÁCH NHÂN VẬT: " + ", ".join(char_names) + "\n\nCÁC CẢNH (JSON):\n"
                      + json.dumps(scene_payload, ensure_ascii=False)[:100000])
            reply = await chat.send_message(UserMessage(text=prompt))
            arr = _extract_json(reply if isinstance(reply, str) else str(reply))
            for item in arr:
                if isinstance(item, dict) and item.get("scene_code"):
                    mapping[item["scene_code"]] = item
            ai_used = True
        except Exception:
            ai_used = False

    def match_bg(location, scene_title):
        loc = (location or "").lower()
        blob = (loc + " " + (scene_title or "").lower())
        for b in backgrounds:
            n = b["name"].strip().lower()
            if n and (n in blob or (loc and loc in n)):
                return b["id"]
        return None

    updated = 0
    total_chars = 0
    for sc in scenes:
        code = sc.get("code")
        m = mapping.get(code, {})
        # characters: AI names → ids; fallback: name appears in scene text
        cids = []
        text_lc = ((sc.get("script_content") or "") + " " + (sc.get("description") or "") + " " + (sc.get("title") or "")).lower()
        ai_names = m.get("characters") if isinstance(m.get("characters"), list) else []
        for nm in ai_names:
            cid = char_by_name.get(str(nm).strip().lower())
            if cid and cid not in cids:
                cids.append(cid)
        if not ai_names:
            for c in characters:
                if c["name"].strip().lower() in text_lc and c["id"] not in cids:
                    cids.append(c["id"])
        location = m.get("location") or sc.get("location") or ""
        bg_id = match_bg(location, sc.get("title"))
        changes = {"characters": cids, "updated_at": now_iso()}
        if location:
            changes["location"] = location
        if bg_id:
            changes["background_id"] = bg_id
        await db.scenes.update_one({"id": sc["id"]}, {"$set": changes, "$inc": {"rev": 1}})
        updated += 1
        total_chars += len(cids)

    await audit(project_id, "resource", project_id, "auto_map", user,
                after={"scenes": updated, "chars_assigned": total_chars, "ai": ai_used},
                label=f"AI phân bổ tài nguyên: {updated} scene, {total_chars} lượt nhân vật")
    return {"updated_scenes": updated, "chars_assigned": total_chars, "ai_used": ai_used}
