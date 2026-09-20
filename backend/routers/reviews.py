from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db, clean
import auth as A
import rbac
from common import new_id, now_iso, get_project_or_404, audit, check_rev

router = APIRouter(prefix="/projects/{project_id}", tags=["reviews"])


class TimecodeComment(BaseModel):
    timecode: str
    text: str


class ReviewIn(BaseModel):
    decision: str  # "pass" | "fail"
    comments: List[TimecodeComment] = []
    note: Optional[str] = ""
    shot_rev: int
    force: bool = False  # acknowledge reviewing a non-latest version


@router.get("/shots/{shot_id}/reviews")
async def list_reviews(project_id: str, shot_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "review.view")
    docs = await db.reviews.find({"shot_id": shot_id}).sort("created_at", -1).to_list(1000)
    return [clean(d) for d in docs]


@router.post("/shots/{shot_id}/versions/{version_id}/review")
async def submit_review(project_id: str, shot_id: str, version_id: str, body: ReviewIn,
                        user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "review.decide")
    if body.decision not in ("pass", "fail"):
        raise HTTPException(status_code=400, detail="Quyết định phải là 'pass' hoặc 'fail'")
    shot = await db.shots.find_one({"id": shot_id, "project_id": project_id})
    if not shot:
        raise HTTPException(status_code=404, detail="Không tìm thấy shot")
    version = await db.versions.find_one({"id": version_id, "shot_id": shot_id})
    if not version:
        raise HTTPException(status_code=404, detail="Không tìm thấy version")
    check_rev(shot, body.shot_rev)
    # Edge case: source changed while reviewing (a newer version was uploaded)
    if shot.get("latest_version_id") != version_id and not body.force:
        raise HTTPException(
            status_code=409,
            detail="Đã có version mới hơn được nộp trong lúc duyệt. Xác nhận (force) nếu vẫn muốn duyệt version này.",
        )
    review = {
        "id": new_id(), "shot_id": shot_id, "version_id": version_id,
        "version_number": version.get("version_number"), "project_id": project_id,
        "reviewer_id": user["id"], "reviewer_name": user.get("name") or user["email"],
        "decision": body.decision, "comments": [c.model_dump() for c in body.comments],
        "note": body.note or "", "is_return": body.decision == "fail",
        "created_at": now_iso(),
    }
    await db.reviews.insert_one(dict(review))
    if body.decision == "pass":
        new_status = "approved"
        await db.versions.update_one({"id": version_id}, {"$set": {"status": "approved"}})
        shot_set = {"status": "approved", "approved_version_id": version_id, "updated_at": now_iso()}
    else:
        new_status = "rejected"
        await db.versions.update_one({"id": version_id}, {"$set": {"status": "rejected"}})
        shot_set = {"status": "rejected", "updated_at": now_iso()}
    await db.shots.update_one({"id": shot_id, "rev": body.shot_rev}, {"$set": shot_set, "$inc": {"rev": 1}})
    await audit(project_id, "review", review["id"], "review", user,
                after={"decision": body.decision, "version": version.get("version_number")},
                label=f"Duyệt shot {shot.get('code')} v{version.get('version_number')}: {'Đạt' if body.decision=='pass' else 'Không đạt (trả hàng)'}")
    return clean(review)


@router.get("/returns")
async def list_returns(project_id: str, user: dict = Depends(A.get_current_user)):
    """Return items = shots currently rejected, needing resubmission."""
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "review.view")
    shots = await db.shots.find({"project_id": project_id, "status": "rejected"}).to_list(2000)
    out = []
    for s in shots:
        s = clean(s)
        last = await db.reviews.find_one({"shot_id": s["id"], "decision": "fail"}, sort=[("created_at", -1)])
        s["last_review"] = clean(last) if last else None
        out.append(s)
    return out
