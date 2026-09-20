from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db, clean
import auth as A
import rbac
from common import new_id, now_iso, get_project_or_404, audit

router = APIRouter(prefix="/projects/{project_id}/budget", tags=["budget"])


class BudgetIn(BaseModel):
    amount: float
    currency: Optional[str] = "VND"


class ExpenseIn(BaseModel):
    title: str
    amount: float
    category: Optional[str] = "khác"
    sequence_id: Optional[str] = None


@router.get("")
async def get_budget(project_id: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "budget.view")
    b = await db.project_budgets.find_one({"project_id": project_id})
    amount = b["amount"] if b else 0
    currency = (b or {}).get("currency", "VND")
    expenses = await db.expenses.find({"project_id": project_id}).sort("created_at", -1).to_list(2000)
    expenses = [clean(e) for e in expenses]
    spent = sum(e["amount"] for e in expenses)
    seqs = await db.sequences.find({"project_id": project_id}).to_list(1000)
    seq_map = {s["id"]: s for s in seqs}
    by_seq = {}
    for e in expenses:
        key = e.get("sequence_id") or "_none"
        by_seq.setdefault(key, 0)
        by_seq[key] += e["amount"]
    by_sequence = [{"sequence_id": k, "code": seq_map.get(k, {}).get("code", "—"),
                    "title": seq_map.get(k, {}).get("title", "Chung (không theo sequence)"),
                    "spent": v} for k, v in by_seq.items()]
    return {"amount": amount, "currency": currency, "spent": spent,
            "remaining": amount - spent, "over": spent > amount and amount > 0,
            "pct": (spent / amount * 100) if amount > 0 else 0,
            "by_sequence": by_sequence, "expenses": expenses}


@router.put("")
async def set_budget(project_id: str, body: BudgetIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "budget.write")
    await db.project_budgets.update_one({"project_id": project_id},
                                        {"$set": {"amount": body.amount, "currency": body.currency or "VND", "updated_at": now_iso()}},
                                        upsert=True)
    await audit(project_id, "budget", project_id, "set_budget", user, after={"amount": body.amount}, label=f"Đặt ngân sách {body.amount:,.0f}")
    return {"amount": body.amount, "currency": body.currency or "VND"}


@router.post("/expenses")
async def add_expense(project_id: str, body: ExpenseIn, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "budget.write")
    if body.amount < 0:
        raise HTTPException(status_code=400, detail="Số tiền không hợp lệ")
    doc = {"id": new_id(), "project_id": project_id, "title": body.title, "amount": body.amount,
           "category": body.category or "khác", "sequence_id": body.sequence_id,
           "created_by": user["id"], "created_by_name": user.get("name") or user["email"], "created_at": now_iso()}
    await db.expenses.insert_one(dict(doc))
    await audit(project_id, "expense", doc["id"], "create", user, after={"title": body.title, "amount": body.amount},
                label=f"Thêm chi phí: {body.title} ({body.amount:,.0f})")
    return clean(doc)


@router.delete("/expenses/{eid}")
async def delete_expense(project_id: str, eid: str, user: dict = Depends(A.get_current_user)):
    p = await get_project_or_404(project_id)
    rbac.require_cap(user, p, "budget.write")
    doc = await db.expenses.find_one({"id": eid, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy chi phí")
    await db.expenses.delete_one({"id": eid})
    await audit(project_id, "expense", eid, "delete", user, before=clean(doc), restorable=True, label=f"Xóa chi phí: {doc.get('title')}")
    return {"message": "Đã xóa"}
