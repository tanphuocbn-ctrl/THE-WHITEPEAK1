from fastapi import APIRouter, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta

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


@router.get("/reports/weekly")
async def weekly_report(user: dict = Depends(A.get_current_user)):
    if rbac.is_super(user) or user.get("role") == rbac.ROLE_SECRETARY:
        projects = await db.projects.find().to_list(1000)
    else:
        projects = await db.projects.find({"members.user_id": user["id"]}).to_list(1000)
    pids = [p["id"] for p in projects]
    week_start = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    versions_week = await db.versions.count_documents({"project_id": {"$in": pids}, "created_at": {"$gte": week_start}})
    reviews = await db.reviews.find({"project_id": {"$in": pids}, "created_at": {"$gte": week_start}}).to_list(5000)
    approved_week = sum(1 for r in reviews if r.get("decision") == "pass")
    returned_week = sum(1 for r in reviews if r.get("decision") == "fail")
    post_done_week = await db.post_tasks.count_documents({"project_id": {"$in": pids}, "status": "done", "updated_at": {"$gte": week_start}})

    status_counts = {}
    for st in ["todo", "in_progress", "review", "rejected", "approved", "done"]:
        status_counts[st] = await db.shots.count_documents({"project_id": {"$in": pids}, "status": st})

    rows = []
    for p in projects:
        pid = p["id"]
        total = await db.shots.count_documents({"project_id": pid})
        approved = await db.shots.count_documents({"project_id": pid, "status": "approved"})
        review = await db.shots.count_documents({"project_id": pid, "status": "review"})
        post_open = await db.post_tasks.count_documents({"project_id": pid, "status": {"$in": ["todo", "in_progress", "review"]}})
        b = await db.project_budgets.find_one({"project_id": pid})
        budget = b["amount"] if b else 0
        exps = await db.expenses.find({"project_id": pid}).to_list(5000)
        spent = sum(e["amount"] for e in exps)
        rows.append({"id": pid, "code": p["code"], "title": p["title"], "total_shots": total,
                     "approved": approved, "review": review, "post_open": post_open,
                     "progress": round((approved / total * 100) if total else 0),
                     "budget": budget, "spent": spent, "over": spent > budget and budget > 0})
    return {
        "week_start": week_start,
        "totals": {"projects": len(projects), "shots": sum(status_counts.values()),
                   "versions_week": versions_week, "approved_week": approved_week,
                   "returned_week": returned_week, "post_done_week": post_done_week},
        "shot_status": status_counts,
        "projects": rows,
    }
