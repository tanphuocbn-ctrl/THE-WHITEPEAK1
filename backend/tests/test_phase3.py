"""Phase 3 backend regression: staffing calendar, bulk-assign (post tasks + shots),
weekly PDF report, deadline highlighting via flag field.
"""
import os
from datetime import datetime, timezone, timedelta
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"

ADMIN = ("tanphuoc.bn@gmail.com", "Studio@2026")
MEMBER = ("member@studio.vn", "Studio@2026")


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def project(admin):
    r = admin.get(f"{BASE}/projects", timeout=30).json()
    return next(x for x in r if x["code"] == "DEMO-01")


@pytest.fixture(scope="module")
def pid(project):
    return project["id"]


# ---------- Staffing calendar ----------
class TestStaffing:
    def test_calendar_default_week(self, admin):
        r = admin.get(f"{BASE}/staffing/calendar", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "week_start" in data and "days" in data and "people" in data
        assert len(data["days"]) == 7
        # Monday
        d0 = datetime.fromisoformat(data["days"][0]).date()
        assert d0.weekday() == 0
        assert isinstance(data["people"], list)

    def test_calendar_specific_week(self, admin):
        ws = "2026-01-05"  # Monday
        r = admin.get(f"{BASE}/staffing/calendar?week_start={ws}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["week_start"] == ws
        assert data["days"][0] == ws
        assert data["days"][6] == "2026-01-11"

    def test_calendar_populated_after_deadline_set(self, admin, pid):
        """After we set a shot deadline for today, staffing calendar should show that person."""
        # Assign a shot to member and set today's deadline
        board = admin.get(f"{BASE}/projects/{pid}/board", timeout=30).json()
        assert len(board) > 0
        shot = board[0]
        # find member user
        me = admin.get(f"{BASE}/auth/me", timeout=30).json()
        # use admin as assignee (super_admin is pm of DEMO-01)
        today = datetime.now(timezone.utc).date().isoformat() + "T09:00:00+00:00"
        r = admin.post(f"{BASE}/projects/{pid}/shots/{shot['id']}/assign", json={
            "assignee_id": me["id"], "deadline": today, "rev": shot["rev"]
        }, timeout=30)
        assert r.status_code == 200, r.text
        # Fetch this week's staffing
        # Compute Monday of this week
        d = datetime.now(timezone.utc).date()
        monday = d - timedelta(days=d.weekday())
        r = admin.get(f"{BASE}/staffing/calendar?week_start={monday.isoformat()}", timeout=30)
        assert r.status_code == 200
        cal = r.json()
        found = False
        for person in cal["people"]:
            for day, items in person["days"].items():
                for it in items:
                    if it["id"] == shot["id"]:
                        found = True
                        assert it["kind"] == "shot"
                        assert it["project_code"] == "DEMO-01"
                        assert it["flag"] in ("normal", "overdue", "done")
        assert found, "Assigned shot with today's deadline not found in staffing calendar"


# ---------- Bulk assign shots ----------
class TestBulkAssignShots:
    def test_bulk_assign_shots(self, admin, project, pid):
        board = admin.get(f"{BASE}/projects/{pid}/board", timeout=30).json()
        shot_ids = [s["id"] for s in board[:2]]
        assert len(shot_ids) >= 1
        me = admin.get(f"{BASE}/auth/me", timeout=30).json()
        r = admin.post(f"{BASE}/projects/{pid}/shots/bulk-assign", json={
            "shot_ids": shot_ids,
            "assignee_id": me["id"],
            "deadline": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        }, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["updated"] == len(shot_ids)
        assert data["assignee_name"]
        # Verify persistence via GET
        board2 = admin.get(f"{BASE}/projects/{pid}/board", timeout=30).json()
        for s in board2:
            if s["id"] in shot_ids:
                assert s["assignee_id"] == me["id"]
                assert s["deadline"]

    def test_bulk_assign_shots_invalid_member(self, admin, pid):
        board = admin.get(f"{BASE}/projects/{pid}/board", timeout=30).json()
        r = admin.post(f"{BASE}/projects/{pid}/shots/bulk-assign", json={
            "shot_ids": [board[0]["id"]],
            "assignee_id": "not-a-member-id",
        }, timeout=30)
        assert r.status_code == 400


# ---------- Bulk assign post tasks ----------
class TestBulkAssignPostTasks:
    def test_bulk_assign_post_tasks(self, admin, pid):
        seq = admin.get(f"{BASE}/projects/{pid}/sequences", timeout=30).json()
        assert seq, "DEMO-01 must have a sequence"
        sid = seq[0]["id"]
        # Create 2 tasks
        tids = []
        for title in ["TEST_bulk_1", "TEST_bulk_2"]:
            r = admin.post(f"{BASE}/projects/{pid}/post/tasks", json={
                "sequence_id": sid, "title": title,
            }, timeout=30)
            assert r.status_code == 200, r.text
            tids.append(r.json()["id"])
        me = admin.get(f"{BASE}/auth/me", timeout=30).json()
        r = admin.post(f"{BASE}/projects/{pid}/post/tasks/bulk-assign", json={
            "task_ids": tids, "assignee_id": me["id"],
        }, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["updated"] == 2
        assert data["assignee_name"]
        # GET → verify persistence
        tasks = admin.get(f"{BASE}/projects/{pid}/post/tasks?sequence_id={sid}", timeout=30).json()
        for t in tasks:
            if t["id"] in tids:
                assert t["assignee_id"] == me["id"]
        # cleanup
        for tid in tids:
            admin.delete(f"{BASE}/projects/{pid}/post/tasks/{tid}", timeout=30)


# ---------- Deadline highlight (backend flag in staffing) + task creation with past deadline ----------
class TestDeadlineFlag:
    def test_past_deadline_flags_overdue_in_staffing(self, admin, pid):
        seq = admin.get(f"{BASE}/projects/{pid}/sequences", timeout=30).json()
        sid = seq[0]["id"]
        me = admin.get(f"{BASE}/auth/me", timeout=30).json()
        # Create task in current week with a past deadline (yesterday-ish this week if possible)
        # Use Monday of this week as deadline (>= yesterday for most weekdays)
        today = datetime.now(timezone.utc).date()
        monday = today - timedelta(days=today.weekday())
        past_day = monday if monday < today else today - timedelta(days=1)
        deadline = past_day.isoformat() + "T09:00:00+00:00"
        r = admin.post(f"{BASE}/projects/{pid}/post/tasks", json={
            "sequence_id": sid, "title": "TEST_overdue", "assignee_id": me["id"], "deadline": deadline,
        }, timeout=30)
        assert r.status_code == 200
        tid = r.json()["id"]

        # Query staffing for this week
        r = admin.get(f"{BASE}/staffing/calendar?week_start={monday.isoformat()}", timeout=30)
        cal = r.json()
        flag = None
        for person in cal["people"]:
            for day, items in person["days"].items():
                for it in items:
                    if it["id"] == tid:
                        flag = it["flag"]
        # If deadline was today, flag may be "normal"; if strictly past → overdue.
        if past_day < today:
            assert flag == "overdue", f"expected overdue, got {flag}"
        else:
            assert flag in ("normal", "overdue")
        # cleanup
        admin.delete(f"{BASE}/projects/{pid}/post/tasks/{tid}", timeout=30)


# ---------- Weekly report PDF ----------
class TestWeeklyReport:
    def test_weekly_json(self, admin):
        r = admin.get(f"{BASE}/reports/weekly", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "totals" in data and "shot_status" in data and "projects" in data

    def test_weekly_pdf(self, admin):
        r = admin.get(f"{BASE}/reports/weekly/pdf", timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 500
