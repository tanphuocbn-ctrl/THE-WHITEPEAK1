from fastapi import APIRouter, Depends
from typing import Optional

from db import db, clean
import auth as A
import rbac

router = APIRouter(tags=["misc"])


@router.get("/users")
async def search_users(q: Optional[str] = None, user: dict = Depends(A.get_current_user)):
    query = {}
    if q:
        query = {"$or": [{"email": {"$regex": q, "$options": "i"}},
                         {"name": {"$regex": q, "$options": "i"}}]}
    docs = await db.users.find(query).limit(20).to_list(20)
    return [{"id": str(d["_id"]), "email": d["email"], "name": d.get("name"), "role": d.get("role")} for d in docs]


@router.get("/dashboard")
async def dashboard(user: dict = Depends(A.get_current_user)):
    if rbac.is_super(user) or user.get("role") == rbac.ROLE_SECRETARY:
        projects = await db.projects.find().to_list(1000)
    else:
        projects = await db.projects.find({"members.user_id": user["id"]}).to_list(1000)
    pids = [p["id"] for p in projects]
    status_counts = {}
    for st in ["todo", "in_progress", "review", "rejected", "approved", "done"]:
        status_counts[st] = await db.shots.count_documents({"project_id": {"$in": pids}, "status": st})
    my_tasks = await db.shots.count_documents({"project_id": {"$in": pids}, "assignee_id": user["id"],
                                               "status": {"$in": ["todo", "in_progress", "rejected"]}})
    pending_review = await db.shots.count_documents({"project_id": {"$in": pids}, "status": "review"})
    return {
        "projects": [clean(p) for p in projects[:8]],
        "project_count": len(projects),
        "shot_status": status_counts,
        "my_tasks": my_tasks,
        "pending_review": pending_review,
        "total_shots": sum(status_counts.values()),
    }
