from fastapi import APIRouter, Depends, Query, Response
from typing import Optional
from datetime import datetime, timezone, timedelta

from db import db, clean
import auth as A
import rbac
from reports_pdf import build_weekly_pdf

router = APIRouter(tags=["misc"])


@router.get("/users")
async def search_users(q: Optional[str] = None, user: dict = Depends(A.get_current_user)):
    query = {}
    if q:
        query = {"$or": [{"email": {"$regex": q, "$options": "i"}},
                         {"name": {"$regex": q, "$options": "i"}}]}
    docs = await db.users.find(query).limit(20).to_list(20)
    return [{"id": str(d["_id"]), "email": d["email"], "name": d.get("name"), "role": d.get("role")} for d in docs]


async def _scoped_projects(user: dict):
    if rbac.is_super(user) or user.get("role") == rbac.ROLE_SECRETARY:
        return await db.projects.find().to_list(1000)
    return await db.projects.find({"members.user_id": user["id"]}).to_list(1000)


@router.get("/dashboard")
async def dashboard(user: dict = Depends(A.get_current_user)):
    projects = await _scoped_projects(user)
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


async def _weekly_data(user: dict):
    projects = await _scoped_projects(user)
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


@router.get("/reports/weekly")
async def weekly_report(user: dict = Depends(A.get_current_user)):
    return await _weekly_data(user)


@router.get("/reports/weekly/pdf")
async def weekly_report_pdf(user: dict = Depends(A.get_current_user)):
    data = await _weekly_data(user)
    pdf = build_weekly_pdf(data, user)
    fn = f"bao-cao-tuan-{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fn}"'})


DONE_STATES = {"approved", "done"}


@router.get("/staffing/calendar")
async def staffing_calendar(week_start: Optional[str] = None, user: dict = Depends(A.get_current_user)):
    """Studio-wide weekly staffing: who is busy with what, per day (by deadline)."""
    projects = await _scoped_projects(user)
    pids = [p["id"] for p in projects]
    projmap = {p["id"]: p for p in projects}

    if week_start:
        try:
            start = datetime.fromisoformat(week_start).date()
        except Exception:
            start = datetime.now(timezone.utc).date()
    else:
        today = datetime.now(timezone.utc).date()
        start = today - timedelta(days=today.weekday())  # Monday
    days = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    day_set = set(days)
    today_iso = datetime.now(timezone.utc).date().isoformat()

    shots = await db.shots.find({"project_id": {"$in": pids}, "assignee_id": {"$nin": [None, ""]},
                                 "deadline": {"$nin": [None, ""]}}).to_list(10000)
    tasks = await db.post_tasks.find({"project_id": {"$in": pids}, "assignee_id": {"$nin": [None, ""]},
                                      "deadline": {"$nin": [None, ""]}}).to_list(10000)

    people = {}

    def ensure(uid, name):
        if uid not in people:
            people[uid] = {"user_id": uid, "name": name or "—", "days": {d: [] for d in days}, "total": 0}
        return people[uid]

    def flag(deadline_day, status):
        if status in DONE_STATES or status == "done":
            return "done"
        if deadline_day < today_iso:
            return "overdue"
        return "normal"

    for s in shots:
        d = (s.get("deadline") or "")[:10]
        if d not in day_set:
            continue
        uid = s["assignee_id"]
        pr = projmap.get(s["project_id"], {})
        person = ensure(uid, s.get("assignee_name"))
        person["days"][d].append({
            "kind": "shot", "id": s["id"], "label": s.get("code") or s.get("title"),
            "title": s.get("title"), "project_id": s["project_id"], "project_code": pr.get("code"),
            "status": s.get("status"), "deadline": s.get("deadline"),
            "flag": flag(d, s.get("status")),
        })
        person["total"] += 1

    for t in tasks:
        d = (t.get("deadline") or "")[:10]
        if d not in day_set:
            continue
        uid = t["assignee_id"]
        pr = projmap.get(t["project_id"], {})
        person = ensure(uid, t.get("assignee_name"))
        person["days"][d].append({
            "kind": "post", "id": t["id"], "label": t.get("title"),
            "title": t.get("title"), "project_id": t["project_id"], "project_code": pr.get("code"),
            "status": t.get("status"), "deadline": t.get("deadline"),
            "flag": flag(d, t.get("status")),
        })
        person["total"] += 1

    rows = sorted(people.values(), key=lambda x: x["name"].lower())
    return {"week_start": start.isoformat(), "days": days, "people": rows}
