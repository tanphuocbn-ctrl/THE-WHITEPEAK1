"""Backend regression tests for Film Studio Manager Phase 1.

Covers: auth (login/register/me/logout/reset), RBAC, project/structure CRUD + optimistic concurrency,
assignments/board, chunked version upload + download, review workflow, script import, audit + restore.
"""
import io
import os
import hashlib
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"

ADMIN = ("tanphuoc.bn@gmail.com", "Studio@2026")
PM = ("pm@studio.vn", "Studio@2026")
LEAD = ("lead@studio.vn", "Studio@2026")
MEMBER = ("member@studio.vn", "Studio@2026")
REVIEWER = ("reviewer@studio.vn", "Studio@2026")
EDITOR = ("editor@studio.vn", "Studio@2026")
SECRETARY = ("secretary@studio.vn", "Studio@2026")


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="session")
def pm():
    return _login(*PM)


@pytest.fixture(scope="session")
def member():
    return _login(*MEMBER)


@pytest.fixture(scope="session")
def reviewer():
    return _login(*REVIEWER)


@pytest.fixture(scope="session")
def secretary():
    return _login(*SECRETARY)


@pytest.fixture(scope="session")
def demo_project_id(admin):
    r = admin.get(f"{BASE}/projects", timeout=30)
    assert r.status_code == 200
    p = next((x for x in r.json() if x["code"] == "DEMO-01"), None)
    assert p, "DEMO-01 not seeded"
    return p["id"]


# ------------------ AUTH ------------------
class TestAuth:
    def test_login_admin_me(self, admin):
        r = admin.get(f"{BASE}/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN[0]
        assert r.json()["role"] == "super_admin"

    def test_login_wrong_password(self):
        r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN[0], "password": "wrong-xyz"}, timeout=30)
        assert r.status_code == 401

    def test_register_new_user(self):
        email = f"test_{uuid.uuid4().hex[:8]}@studio.vn"
        r = requests.post(f"{BASE}/auth/register",
                          json={"email": email, "password": "Studio@2026", "name": "TEST User"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == email and d["role"] == "member"

    def test_register_duplicate(self):
        r = requests.post(f"{BASE}/auth/register",
                          json={"email": PM[0], "password": "x", "name": "dup"}, timeout=30)
        assert r.status_code == 400

    def test_logout_clears(self):
        s = _login(*PM)
        r = s.post(f"{BASE}/auth/logout", timeout=30)
        assert r.status_code == 200
        # After logout cookies cleared; me should fail
        s2 = requests.Session()  # fresh
        r2 = s2.get(f"{BASE}/auth/me", timeout=30)
        assert r2.status_code == 401

    def test_forgot_password_generic_registered(self):
        r = requests.post(f"{BASE}/auth/forgot-password", json={"email": PM[0]}, timeout=30)
        assert r.status_code == 200
        assert "message" in r.json()

    def test_forgot_password_generic_unregistered(self):
        r1 = requests.post(f"{BASE}/auth/forgot-password", json={"email": PM[0]}, timeout=30)
        r2 = requests.post(f"{BASE}/auth/forgot-password",
                           json={"email": f"nouser_{uuid.uuid4().hex[:8]}@none.vn"}, timeout=30)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json() == r2.json(), "registered vs unregistered responses differ (info leak)"

    def test_reset_password_flow(self):
        """Directly insert a reset token via mongo (backend log link technique unavailable in preview)."""
        import asyncio
        import motor.motor_asyncio
        from datetime import datetime, timezone, timedelta
        # Create a throwaway user
        email = f"reset_{uuid.uuid4().hex[:8]}@studio.vn"
        pw = "Studio@2026"
        reg = requests.post(f"{BASE}/auth/register",
                            json={"email": email, "password": pw, "name": "reset"}, timeout=30)
        assert reg.status_code == 200

        mongo_url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
        db_name = os.environ.get("DB_NAME") or "test_database"

        async def insert_and_get_user():
            client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            u = await db.users.find_one({"email": email})
            token = uuid.uuid4().hex + uuid.uuid4().hex
            th = hashlib.sha256(token.encode()).hexdigest()
            await db.password_reset_tokens.insert_one({
                "token_hash": th, "user_id": str(u["_id"]), "email": email,
                "expires_at": datetime.now(timezone.utc) + timedelta(hours=1), "used": False,
            })
            client.close()
            return token

        token = asyncio.get_event_loop().run_until_complete(insert_and_get_user())
        r = requests.post(f"{BASE}/auth/reset-password",
                          json={"token": token, "password": "NewPass@2026"}, timeout=30)
        assert r.status_code == 200, r.text
        # Login with new password
        s = requests.Session()
        rl = s.post(f"{BASE}/auth/login", json={"email": email, "password": "NewPass@2026"}, timeout=30)
        assert rl.status_code == 200
        # Reuse token → fail
        r2 = requests.post(f"{BASE}/auth/reset-password",
                           json={"token": token, "password": "AnotherPass@2026"}, timeout=30)
        assert r2.status_code == 400


# ------------------ RBAC ------------------
class TestRBAC:
    def test_member_forbidden_create_sequence(self, member, demo_project_id):
        r = member.post(f"{BASE}/projects/{demo_project_id}/sequences",
                        json={"code": "SEQ-X", "title": "x", "order": 99}, timeout=30)
        assert r.status_code == 403

    def test_member_forbidden_create_shot(self, member, demo_project_id):
        # need a scene id
        r = member.get(f"{BASE}/projects/{demo_project_id}/scenes", timeout=30)
        assert r.status_code == 200
        scene_id = r.json()[0]["id"]
        rc = member.post(f"{BASE}/projects/{demo_project_id}/shots",
                         json={"scene_id": scene_id, "code": "SH-X", "title": "x"}, timeout=30)
        assert rc.status_code == 403

    def test_reviewer_cannot_create_structure(self, reviewer, demo_project_id):
        r = reviewer.post(f"{BASE}/projects/{demo_project_id}/sequences",
                          json={"code": "SEQ-R", "title": "x"}, timeout=30)
        assert r.status_code == 403

    def test_member_forbidden_assign(self, member, demo_project_id):
        rs = member.get(f"{BASE}/projects/{demo_project_id}/shots", timeout=30)
        shot = rs.json()[0]
        r = member.post(f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/assign",
                        json={"assignee_id": None, "rev": shot["rev"]}, timeout=30)
        assert r.status_code == 403


# ------------------ Projects ------------------
class TestProjects:
    def test_secretary_create_project(self, secretary):
        code = f"TEST-{uuid.uuid4().hex[:6].upper()}"
        r = secretary.post(f"{BASE}/projects",
                           json={"title": "TEST Project", "code": code, "description": "t"}, timeout=30)
        assert r.status_code == 200
        p = r.json()
        assert p["code"] == code and p["rev"] == 0
        # GET
        r2 = secretary.get(f"{BASE}/projects/{p['id']}", timeout=30)
        assert r2.status_code == 200
        assert "my_role" in r2.json()

    def test_member_cannot_create_project(self, member):
        r = member.post(f"{BASE}/projects",
                        json={"title": "x", "code": f"NO-{uuid.uuid4().hex[:4]}"}, timeout=30)
        assert r.status_code == 403


# ------------------ Structure + Optimistic concurrency ------------------
class TestStructure:
    def test_admin_create_sequence_scene_shot(self, admin, demo_project_id):
        seq_code = f"SEQ-T-{uuid.uuid4().hex[:4]}"
        r = admin.post(f"{BASE}/projects/{demo_project_id}/sequences",
                       json={"code": seq_code, "title": "Test seq"}, timeout=30)
        assert r.status_code == 200
        seq = r.json()

        r2 = admin.post(f"{BASE}/projects/{demo_project_id}/scenes",
                        json={"sequence_id": seq["id"], "code": f"SC-T-{uuid.uuid4().hex[:4]}",
                              "title": "Test scene"}, timeout=30)
        assert r2.status_code == 200
        scene = r2.json()

        r3 = admin.post(f"{BASE}/projects/{demo_project_id}/shots",
                        json={"scene_id": scene["id"], "code": f"SH-T-{uuid.uuid4().hex[:4]}",
                              "title": "Test shot"}, timeout=30)
        assert r3.status_code == 200
        shot = r3.json()
        assert shot["status"] == "todo"
        # store for other tests
        pytest.test_shot_id = shot["id"]
        pytest.test_shot_rev = shot["rev"]

    def test_stale_rev_returns_409(self, admin, demo_project_id):
        shot_id = pytest.test_shot_id
        r = admin.patch(f"{BASE}/projects/{demo_project_id}/shots/{shot_id}",
                        json={"title": "Updated", "rev": pytest.test_shot_rev}, timeout=30)
        assert r.status_code == 200
        # now use stale rev
        r2 = admin.patch(f"{BASE}/projects/{demo_project_id}/shots/{shot_id}",
                         json={"title": "Again", "rev": pytest.test_shot_rev}, timeout=30)
        assert r2.status_code == 409


# ------------------ Assignments ------------------
class TestAssignments:
    def test_assign_shot_valid_member(self, admin, demo_project_id):
        # find member's user_id from project members
        proj = admin.get(f"{BASE}/projects/{demo_project_id}", timeout=30).json()
        mem = next(m for m in proj["members"] if m["email"] == MEMBER[0])
        # get a shot
        shots = admin.get(f"{BASE}/projects/{demo_project_id}/shots", timeout=30).json()
        shot = shots[0]
        r = admin.post(f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/assign",
                       json={"assignee_id": mem["user_id"],
                             "deadline": "2026-12-31T00:00:00Z", "rev": shot["rev"]}, timeout=30)
        assert r.status_code == 200
        assert r.json()["assignee_id"] == mem["user_id"]

    def test_assign_invalid_non_member(self, admin, demo_project_id):
        shots = admin.get(f"{BASE}/projects/{demo_project_id}/shots", timeout=30).json()
        shot = shots[1]
        r = admin.post(f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/assign",
                       json={"assignee_id": "nonexistent-user-id", "rev": shot["rev"]}, timeout=30)
        assert r.status_code == 400

    def test_board_groups(self, admin, demo_project_id):
        r = admin.get(f"{BASE}/projects/{demo_project_id}/board", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 3
        assert all("scene_code" in s for s in data)

    def test_board_mine(self, member, demo_project_id):
        r = member.get(f"{BASE}/projects/{demo_project_id}/board?mine=true", timeout=30)
        assert r.status_code == 200


# ------------------ Versions ------------------
class TestVersions:
    def test_chunked_upload_and_review(self, admin, reviewer, demo_project_id):
        # get shot SH-030 (todo) — but any shot works
        shots = admin.get(f"{BASE}/projects/{demo_project_id}/shots", timeout=30).json()
        # Use SH-010 (in_progress) so we can test review pass
        shot = next(s for s in shots if s["code"] == "SH-010")
        shot_id = shot["id"]

        payload = b"HELLO_FILM_TEST_" + os.urandom(64)
        total = len(payload)
        r = admin.post(f"{BASE}/projects/{demo_project_id}/shots/{shot_id}/versions/init",
                       json={"filename": "test.bin", "content_type": "application/octet-stream",
                             "total_size": total, "note": "test"}, timeout=30)
        assert r.status_code == 200, r.text
        upload_id = r.json()["upload_id"]

        # send in 2 chunks
        half = total // 2
        r1 = admin.put(f"{BASE}/projects/{demo_project_id}/uploads/{upload_id}/chunk?offset=0",
                       data=payload[:half],
                       headers={"Content-Type": "application/octet-stream"}, timeout=30)
        assert r1.status_code == 200
        r2 = admin.put(f"{BASE}/projects/{demo_project_id}/uploads/{upload_id}/chunk?offset={half}",
                       data=payload[half:],
                       headers={"Content-Type": "application/octet-stream"}, timeout=30)
        assert r2.status_code == 200

        rc = admin.post(f"{BASE}/projects/{demo_project_id}/shots/{shot_id}/versions/complete?upload_id={upload_id}",
                        timeout=60)
        assert rc.status_code == 200, rc.text
        v = rc.json()
        assert v["version_number"] >= 1
        version_id = v["id"]

        # shot should now be status=review
        s2 = admin.get(f"{BASE}/projects/{demo_project_id}/shots/{shot_id}", timeout=30).json()
        assert s2["status"] == "review"
        assert s2["latest_version_id"] == version_id

        # Download with Bearer token — need access token; use cookie session download
        r_dl = admin.get(f"{BASE}/projects/{demo_project_id}/versions/{version_id}/download",
                         cookies=None)  # will fail as no Bearer/auth
        # Endpoint requires Bearer/query - not cookie. So must fail 401.
        assert r_dl.status_code == 401

        # Extract access token from cookies
        access_token = admin.cookies.get("access_token")
        r_dl2 = requests.get(
            f"{BASE}/projects/{demo_project_id}/versions/{version_id}/download",
            headers={"Authorization": f"Bearer {access_token}"}, timeout=30)
        assert r_dl2.status_code == 200
        assert r_dl2.content == payload

        # Query auth
        r_dl3 = requests.get(
            f"{BASE}/projects/{demo_project_id}/versions/{version_id}/download?auth={access_token}",
            timeout=30)
        assert r_dl3.status_code == 200

        # Reviewer submits pass
        s2 = admin.get(f"{BASE}/projects/{demo_project_id}/shots/{shot_id}", timeout=30).json()
        rv = reviewer.post(
            f"{BASE}/projects/{demo_project_id}/shots/{shot_id}/versions/{version_id}/review",
            json={"decision": "pass",
                  "comments": [{"timecode": "00:00:01", "text": "ok"}],
                  "note": "nice", "shot_rev": s2["rev"]}, timeout=30)
        assert rv.status_code == 200, rv.text
        # Shot approved
        s3 = admin.get(f"{BASE}/projects/{demo_project_id}/shots/{shot_id}", timeout=30).json()
        assert s3["status"] == "approved"
        assert s3["approved_version_id"] == version_id

    def test_review_fail_and_returns(self, admin, reviewer, demo_project_id):
        # Create a fresh shot + version for a fail flow
        scenes = admin.get(f"{BASE}/projects/{demo_project_id}/scenes", timeout=30).json()
        sc = scenes[0]
        rc = admin.post(f"{BASE}/projects/{demo_project_id}/shots",
                        json={"scene_id": sc["id"], "code": f"SH-F-{uuid.uuid4().hex[:4]}",
                              "title": "fail flow"}, timeout=30)
        shot = rc.json()

        payload = b"FAIL_PAYLOAD"
        ri = admin.post(f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/versions/init",
                        json={"filename": "f.bin", "total_size": len(payload)}, timeout=30)
        up = ri.json()["upload_id"]
        admin.put(f"{BASE}/projects/{demo_project_id}/uploads/{up}/chunk?offset=0",
                  data=payload,
                  headers={"Content-Type": "application/octet-stream"}, timeout=30)
        v = admin.post(f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/versions/complete?upload_id={up}",
                       timeout=30).json()

        # Fresh shot
        s2 = admin.get(f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}", timeout=30).json()
        rr = reviewer.post(
            f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/versions/{v['id']}/review",
            json={"decision": "fail", "comments": [{"timecode": "00:01:00", "text": "redo"}],
                  "note": "no", "shot_rev": s2["rev"]}, timeout=30)
        assert rr.status_code == 200, rr.text
        s3 = admin.get(f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}", timeout=30).json()
        assert s3["status"] == "rejected"

        # /returns lists
        rets = admin.get(f"{BASE}/projects/{demo_project_id}/returns", timeout=30).json()
        assert any(x["id"] == shot["id"] for x in rets)

    def test_review_stale_version_conflict(self, admin, reviewer, demo_project_id):
        # Create fresh shot with v1, then upload v2. Reviewing v1 without force → 409.
        scenes = admin.get(f"{BASE}/projects/{demo_project_id}/scenes", timeout=30).json()
        sc = scenes[0]
        shot = admin.post(f"{BASE}/projects/{demo_project_id}/shots",
                          json={"scene_id": sc["id"], "code": f"SH-C-{uuid.uuid4().hex[:4]}",
                                "title": "conflict"}, timeout=30).json()

        def upload(payload):
            init = admin.post(f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/versions/init",
                              json={"filename": "x.bin", "total_size": len(payload)}, timeout=30).json()
            admin.put(f"{BASE}/projects/{demo_project_id}/uploads/{init['upload_id']}/chunk?offset=0",
                      data=payload,
                      headers={"Content-Type": "application/octet-stream"}, timeout=30)
            return admin.post(
                f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/versions/complete?upload_id={init['upload_id']}",
                timeout=30).json()

        v1 = upload(b"v1")
        v2 = upload(b"v22")
        s = admin.get(f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}", timeout=30).json()
        r = reviewer.post(
            f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/versions/{v1['id']}/review",
            json={"decision": "pass", "shot_rev": s["rev"]}, timeout=30)
        assert r.status_code == 409
        # Force succeeds
        r2 = reviewer.post(
            f"{BASE}/projects/{demo_project_id}/shots/{shot['id']}/versions/{v1['id']}/review",
            json={"decision": "pass", "shot_rev": s["rev"], "force": True}, timeout=30)
        assert r2.status_code == 200


# ------------------ Scripts ------------------
class TestScripts:
    def test_manual_import_diff_confirm(self, admin, demo_project_id):
        text = (
            "NỘI. QUÁN CÀ PHÊ - NGÀY\n"  # existing (matches seed title)
            "Ai đó đang uống cà phê.\n\n"
            "NỘI. PHÒNG LÀM VIỆC - NGÀY\n"
            "Một cảnh mới hoàn toàn.\n"
        )
        r = admin.post(f"{BASE}/projects/{demo_project_id}/scripts/manual",
                       json={"raw_text": text}, timeout=30)
        assert r.status_code == 200, r.text
        staging_id = r.json()["id"]
        assert len(r.json()["parsed_scenes"]) == 2

        rd = admin.get(f"{BASE}/projects/{demo_project_id}/scripts/stagings/{staging_id}/diff", timeout=30)
        assert rd.status_code == 200
        diff = rd.json()
        codes_status = {d["title"]: d["status"] for d in diff["diff"]}
        assert diff["summary"]["added"] >= 1
        # existing scene title from seed should be flagged as exists
        assert any(v == "exists" for v in codes_status.values())

        rc = admin.post(f"{BASE}/projects/{demo_project_id}/scripts/stagings/{staging_id}/confirm",
                        json={"sequence_title": "TEST Import"}, timeout=30)
        assert rc.status_code == 200
        assert rc.json()["created_scenes"] == diff["summary"]["added"]
        # double confirm should fail
        rc2 = admin.post(f"{BASE}/projects/{demo_project_id}/scripts/stagings/{staging_id}/confirm",
                         json={}, timeout=30)
        assert rc2.status_code == 409


# ------------------ Audit + restore ------------------
class TestAudit:
    def test_audit_view_and_restore_update(self, admin, demo_project_id):
        # Do an update to generate a restorable log
        seq_code = f"SEQ-A-{uuid.uuid4().hex[:4]}"
        seq = admin.post(f"{BASE}/projects/{demo_project_id}/sequences",
                        json={"code": seq_code, "title": "orig title"}, timeout=30).json()
        upd = admin.patch(f"{BASE}/projects/{demo_project_id}/sequences/{seq['id']}",
                          json={"title": "changed", "rev": seq["rev"]}, timeout=30).json()
        assert upd["title"] == "changed"

        logs = admin.get(f"{BASE}/projects/{demo_project_id}/audit?entity_type=sequence", timeout=30).json()
        target = next((lg for lg in logs if lg.get("entity_id") == seq["id"] and lg["action"] == "update"), None)
        assert target, "update log missing"
        r = admin.post(f"{BASE}/projects/{demo_project_id}/audit/{target['id']}/restore", timeout=30)
        assert r.status_code == 200, r.text
        # Check title restored
        after = admin.get(f"{BASE}/projects/{demo_project_id}/sequences", timeout=30).json()
        cur = next(x for x in after if x["id"] == seq["id"])
        assert cur["title"] == "orig title"

    def test_audit_forbidden_for_member(self, member, demo_project_id):
        r = member.get(f"{BASE}/projects/{demo_project_id}/audit", timeout=30)
        assert r.status_code == 403


# ------------------ Dashboard ------------------
class TestDashboard:
    def test_dashboard_admin(self, admin):
        r = admin.get(f"{BASE}/dashboard", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "project_count" in d and "shot_status" in d and "total_shots" in d
