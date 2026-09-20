import os
from datetime import datetime, timezone, timedelta

from db import db
import auth as A
import storage
from common import new_id, now_iso

DEMO_PASSWORD = "Studio@2026"

DEMO_USERS = [
    {"email": "secretary@studio.vn", "name": "Thư ký Dự án", "role": "secretary", "prole": "guest"},
    {"email": "pm@studio.vn", "name": "Trần PM", "role": "member", "prole": "pm"},
    {"email": "lead@studio.vn", "name": "Lê Team Lead", "role": "member", "prole": "team_lead"},
    {"email": "member@studio.vn", "name": "Phạm Member", "role": "member", "prole": "member"},
    {"email": "reviewer@studio.vn", "name": "Nguyễn Reviewer", "role": "member", "prole": "reviewer"},
    {"email": "editor@studio.vn", "name": "Hoàng Editor", "role": "member", "prole": "editor"},
]


async def _ensure_user(email, name, role):
    u = await db.users.find_one({"email": email})
    if u:
        return str(u["_id"])
    res = await db.users.insert_one({
        "email": email, "password_hash": A.hash_password(DEMO_PASSWORD),
        "name": name, "role": role, "token_version": 0, "created_at": now_iso(),
    })
    return str(res.inserted_id)


async def seed_demo():
    if await db.projects.find_one({"code": "DEMO-01"}):
        return
    admin = await db.users.find_one({"email": os.environ.get("ADMIN_EMAIL", "").lower()})
    if not admin:
        return
    admin_id = str(admin["_id"])

    members = [{"user_id": admin_id, "name": admin.get("name"), "email": admin["email"], "role": "pm"}]
    ids = {}
    for du in DEMO_USERS:
        uid = await _ensure_user(du["email"], du["name"], du["role"])
        ids[du["prole"]] = {"id": uid, "name": du["name"], "email": du["email"]}
        members.append({"user_id": uid, "name": du["name"], "email": du["email"], "role": du["prole"]})

    pid = new_id()
    cover = "https://images.unsplash.com/photo-1632187981988-40f3cbaeef5e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTZ8MHwxfHNlYXJjaHwzfHxjaW5lbWF0aWMlMjBmaWxtJTIwc2V0JTIwcHJvZHVjdGlvbnxlbnwwfHx8fDE3ODk4ODQzNTl8MA&ixlib=rb-4.1.0&q=85"
    await db.projects.insert_one({
        "id": pid, "code": "DEMO-01", "title": "Phim ngắn: Ánh Sáng Cuối Ngày",
        "description": "Dự án demo minh hoạ xương sống sản xuất Phase 1.",
        "status": "active", "cover_url": cover, "rev": 0, "members": members,
        "created_by": admin_id, "created_at": now_iso(), "updated_at": now_iso(),
    })

    seq_id = new_id()
    await db.sequences.insert_one({"id": seq_id, "project_id": pid, "code": "SEQ-01",
                                   "title": "Hồi 1 — Mở đầu", "order": 0, "rev": 0,
                                   "created_at": now_iso(), "updated_at": now_iso()})

    scenes_data = [
        ("S1", "NỘI. QUÁN CÀ PHÊ - NGÀY", "Nhân vật chính ngồi chờ bên cửa sổ.", "Quán cà phê", "Ngày"),
        ("S2", "NGOẠI. ĐƯỜNG PHỐ - HOÀNG HÔN", "Cuộc rượt đuổi qua các con hẻm.", "Đường phố", "Hoàng hôn"),
    ]
    scene_ids = []
    for i, (code, title, desc, loc, tod) in enumerate(scenes_data):
        sid = new_id()
        scene_ids.append(sid)
        await db.scenes.insert_one({"id": sid, "project_id": pid, "sequence_id": seq_id,
                                    "code": code, "title": title, "description": desc,
                                    "location": loc, "time_of_day": tod, "script_content": title,
                                    "characters": [], "order": i, "rev": 0,
                                    "created_at": now_iso(), "updated_at": now_iso()})

    shots_data = [
        (scene_ids[0], "SH-010", "Cận cảnh tách cà phê", "close-up", "member", "in_progress"),
        (scene_ids[0], "SH-020", "Toàn cảnh quán", "wide", "editor", "review"),
        (scene_ids[1], "SH-030", "Rượt đuổi góc thấp", "low-angle", "member", "todo"),
    ]
    for scid, code, title, stype, prole, status in shots_data:
        assignee = ids.get(prole)
        deadline = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        await db.shots.insert_one({
            "id": new_id(), "project_id": pid, "scene_id": scid, "sequence_id": seq_id,
            "code": code, "title": title, "description": "", "shot_type": stype,
            "status": status, "assignee_id": assignee["id"] if assignee else None,
            "assignee_name": assignee["name"] if assignee else None, "deadline": deadline,
            "current_version_id": None, "approved_version_id": None, "latest_version_id": None,
            "version_generation": 0, "rev": 0, "created_at": now_iso(), "updated_at": now_iso(),
        })


ASSET_MP4 = os.path.join(os.path.dirname(__file__), "assets", "sample.mp4")


async def seed_sample_video():
    """Upload a bundled sample mp4 as a version on SH-020 of DEMO-01 so the review
    video player is demonstrable out of the box. Idempotent."""
    project = await db.projects.find_one({"code": "DEMO-01"})
    if not project:
        return
    pid = project["id"]
    shot = await db.shots.find_one({"project_id": pid, "code": "SH-020"})
    if not shot:
        return
    if await db.versions.count_documents({"shot_id": shot["id"]}) > 0:
        return
    if not os.path.exists(ASSET_MP4):
        return
    with open(ASSET_MP4, "rb") as f:
        content = f.read()
    vid = new_id()
    path = f"{storage.APP_NAME}/{pid}/{shot['id']}/{vid}.mp4"
    try:
        result = storage.put_object(path, content, "video/mp4")
    except Exception:
        return
    vdoc = {
        "id": vid, "shot_id": shot["id"], "project_id": pid, "version_number": 1,
        "storage_path": result["path"], "original_filename": "sample-review.mp4",
        "content_type": "video/mp4", "size": result.get("size", len(content)),
        "note": "Bản dựng mẫu để thử trình duyệt video + timecode.",
        "uploaded_by": shot.get("assignee_id") or project["created_by"],
        "uploaded_by_name": shot.get("assignee_name") or "Studio Owner",
        "status": "submitted", "is_deleted": False, "created_at": now_iso(),
    }
    await db.versions.insert_one(dict(vdoc))
    await db.shots.update_one(
        {"id": shot["id"]},
        {"$set": {"latest_version_id": vid, "current_version_id": vid,
                  "version_generation": 1, "status": "review", "updated_at": now_iso()},
         "$inc": {"rev": 1}},
    )
