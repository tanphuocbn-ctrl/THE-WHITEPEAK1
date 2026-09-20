"""Phase 2 backend regression tests: AI script parse, script diff selected_codes,
canvas CRUD + optimistic concurrency + snapshots, download cookie auth.
"""
import os
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"

ADMIN = ("tanphuoc.bn@gmail.com", "Studio@2026")
MEMBER = ("member@studio.vn", "Studio@2026")
REVIEWER = ("reviewer@studio.vn", "Studio@2026")


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def member():
    return _login(*MEMBER)


@pytest.fixture(scope="module")
def reviewer():
    return _login(*REVIEWER)


@pytest.fixture(scope="module")
def pid(admin):
    r = admin.get(f"{BASE}/projects", timeout=30).json()
    p = next(x for x in r if x["code"] == "DEMO-01")
    return p["id"]


# ================= AI Script Import =================
class TestAIScriptImport:
    SAMPLE = (
        "NỘI. QUÁN CÀ PHÊ - NGÀY\n"
        "Nhân vật A ngồi uống cà phê một mình.\n\n"
        "NGOẠI. CÔNG VIÊN - CHIỀU\n"
        "A gặp B trên ghế đá.\n\n"
        "NỘI. XE HƠI - ĐÊM\n"
        "Hai người trò chuyện trong xe.\n"
    )

    def test_ai_parse_gemini(self, admin, pid):
        r = admin.post(f"{BASE}/projects/{pid}/scripts/ai-parse",
                       json={"raw_text": self.SAMPLE, "provider": "gemini"}, timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["source_type"] == "ai:gemini"
        assert d["ai_model"] == "gemini-3.1-pro-preview"
        assert d["ai_provider"] == "gemini"
        assert isinstance(d["parsed_scenes"], list) and len(d["parsed_scenes"]) >= 1
        for s in d["parsed_scenes"]:
            for k in ("code", "title", "location", "time_of_day", "description"):
                assert k in s, f"missing {k}"

    def test_ai_parse_default_provider(self, admin, pid):
        # provider omitted → gemini default
        r = admin.post(f"{BASE}/projects/{pid}/scripts/ai-parse",
                       json={"raw_text": self.SAMPLE}, timeout=120)
        assert r.status_code == 200
        assert r.json()["ai_provider"] == "gemini"

    def test_ai_parse_invalid_provider(self, admin, pid):
        r = admin.post(f"{BASE}/projects/{pid}/scripts/ai-parse",
                       json={"raw_text": self.SAMPLE, "provider": "cohere"}, timeout=30)
        assert r.status_code == 400

    def test_ai_parse_member_forbidden(self, member, pid):
        r = member.post(f"{BASE}/projects/{pid}/scripts/ai-parse",
                        json={"raw_text": self.SAMPLE, "provider": "gemini"}, timeout=30)
        assert r.status_code == 403


# ================= Script Diff selected_codes =================
class TestScriptSelectedCodes:
    def test_confirm_only_selected(self, admin, pid):
        # Use unique titles so all 3 are "added"
        u = uuid.uuid4().hex[:6]
        text = (
            f"NỘI. LOC-A-{u} - NGÀY\nMô tả A.\n\n"
            f"NGOẠI. LOC-B-{u} - CHIỀU\nMô tả B.\n\n"
            f"NỘI. LOC-C-{u} - ĐÊM\nMô tả C.\n"
        )
        r = admin.post(f"{BASE}/projects/{pid}/scripts/manual",
                       json={"raw_text": text}, timeout=30)
        assert r.status_code == 200
        st = r.json()
        assert len(st["parsed_scenes"]) == 3
        staging_id = st["id"]

        rd = admin.get(f"{BASE}/projects/{pid}/scripts/stagings/{staging_id}/diff", timeout=30).json()
        added = [d for d in rd["diff"] if d["status"] == "added"]
        assert len(added) == 3
        chosen = added[0]["code"]

        rc = admin.post(f"{BASE}/projects/{pid}/scripts/stagings/{staging_id}/confirm",
                        json={"selected_codes": [chosen]}, timeout=30)
        assert rc.status_code == 200, rc.text
        assert rc.json()["created_scenes"] == 1

        # Idempotency-safe: already-confirmed → 409
        rc2 = admin.post(f"{BASE}/projects/{pid}/scripts/stagings/{staging_id}/confirm",
                         json={"selected_codes": [chosen]}, timeout=30)
        assert rc2.status_code == 409

    def test_confirm_additive_skip_existing(self, admin, pid):
        # First import a scene, then a second staging that includes the same heading + one new.
        u = uuid.uuid4().hex[:6]
        dup_head = f"NỘI. DUP-LOC-{u} - NGÀY"
        text1 = f"{dup_head}\nFirst import.\n"
        st1 = admin.post(f"{BASE}/projects/{pid}/scripts/manual",
                        json={"raw_text": text1}, timeout=30).json()
        rc1 = admin.post(f"{BASE}/projects/{pid}/scripts/stagings/{st1['id']}/confirm",
                        json={}, timeout=30)
        assert rc1.status_code == 200
        assert rc1.json()["created_scenes"] == 1

        # Now second staging: same heading (=> same title) + 1 truly new
        text2 = f"{dup_head}\nAgain.\n\nNGOẠI. NEW-LOC-{u} - CHIỀU\nnew one.\n"
        st2 = admin.post(f"{BASE}/projects/{pid}/scripts/manual",
                         json={"raw_text": text2}, timeout=30).json()
        codes = [s["code"] for s in st2["parsed_scenes"]]
        rc2 = admin.post(f"{BASE}/projects/{pid}/scripts/stagings/{st2['id']}/confirm",
                         json={"selected_codes": codes}, timeout=30)
        assert rc2.status_code == 200
        # existing skipped → only 1 created
        assert rc2.json()["created_scenes"] == 1


# ================= Canvas CRUD + concurrency =================
class TestCanvas:
    def test_get_auto_create_empty(self, admin, pid):
        r = admin.get(f"{BASE}/projects/{pid}/canvas", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "nodes" in d and "edges" in d and "rev" in d
        # Save current rev for next test
        pytest.canvas_rev = d["rev"]

    def test_put_increments_rev(self, admin, pid):
        cur = admin.get(f"{BASE}/projects/{pid}/canvas", timeout=30).json()
        payload = {
            "nodes": [{"id": "n1", "type": "scene", "x": 10, "y": 20, "title": "N1", "text": ""}],
            "edges": [],
            "rev": cur["rev"],
        }
        r = admin.put(f"{BASE}/projects/{pid}/canvas", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["rev"] == cur["rev"] + 1
        assert len(r.json()["nodes"]) == 1

    def test_put_stale_rev_409(self, admin, pid):
        cur = admin.get(f"{BASE}/projects/{pid}/canvas", timeout=30).json()
        stale = cur["rev"] - 1 if cur["rev"] > 0 else 999
        r = admin.put(f"{BASE}/projects/{pid}/canvas",
                      json={"nodes": [], "edges": [], "rev": stale}, timeout=30)
        assert r.status_code == 409

    def test_reviewer_view_ok_write_forbidden(self, reviewer, pid):
        rg = reviewer.get(f"{BASE}/projects/{pid}/canvas", timeout=30)
        assert rg.status_code == 200
        cur = rg.json()
        rp = reviewer.put(f"{BASE}/projects/{pid}/canvas",
                          json={"nodes": [], "edges": [], "rev": cur["rev"]}, timeout=30)
        assert rp.status_code == 403

    def test_member_write_allowed(self, member, pid):
        cur = member.get(f"{BASE}/projects/{pid}/canvas", timeout=30).json()
        r = member.put(f"{BASE}/projects/{pid}/canvas",
                       json={"nodes": [{"id": "m1", "type": "shot", "x": 5, "y": 5}],
                             "edges": [], "rev": cur["rev"]}, timeout=30)
        assert r.status_code == 200


# ================= Canvas snapshots =================
class TestCanvasSnapshots:
    def test_create_list_restore(self, admin, pid):
        # ensure some nodes present
        cur = admin.get(f"{BASE}/projects/{pid}/canvas", timeout=30).json()
        save = admin.put(f"{BASE}/projects/{pid}/canvas",
                         json={"nodes": [{"id": "sA", "type": "scene", "x": 1, "y": 2, "title": "A"},
                                         {"id": "sB", "type": "shot", "x": 3, "y": 4, "title": "B"}],
                               "edges": [{"id": "e1", "source": "sA", "target": "sB"}],
                               "rev": cur["rev"]}, timeout=30).json()
        assert save["rev"] == cur["rev"] + 1

        name = f"TEST_snap_{uuid.uuid4().hex[:6]}"
        rc = admin.post(f"{BASE}/projects/{pid}/canvas/snapshots",
                        json={"name": name}, timeout=30)
        assert rc.status_code == 200
        snap = rc.json()
        assert snap["node_count"] == 2
        # response should not include nodes/edges payload
        assert "nodes" not in snap and "edges" not in snap
        snap_id = snap["id"]

        # list
        rl = admin.get(f"{BASE}/projects/{pid}/canvas/snapshots", timeout=30)
        assert rl.status_code == 200
        lst = rl.json()
        target = next(x for x in lst if x["id"] == snap_id)
        assert target["node_count"] == 2
        assert "nodes" not in target and "edges" not in target

        # Modify current board (clear it)
        cur2 = admin.get(f"{BASE}/projects/{pid}/canvas", timeout=30).json()
        admin.put(f"{BASE}/projects/{pid}/canvas",
                  json={"nodes": [], "edges": [], "rev": cur2["rev"]}, timeout=30)

        # Restore
        rr = admin.post(f"{BASE}/projects/{pid}/canvas/snapshots/{snap_id}/restore", timeout=30)
        assert rr.status_code == 200, rr.text
        restored = rr.json()
        assert len(restored["nodes"]) == 2
        assert len(restored["edges"]) == 1
        # rev bumped
        after = admin.get(f"{BASE}/projects/{pid}/canvas", timeout=30).json()
        assert after["rev"] == restored["rev"]


# ================= Download cookie auth =================
class TestDownloadCookie:
    def test_download_via_cookie(self, admin, pid):
        # Reuse an existing version if any; otherwise upload a tiny one
        shots = admin.get(f"{BASE}/projects/{pid}/shots", timeout=30).json()
        shot = shots[0]
        vers = admin.get(f"{BASE}/projects/{pid}/shots/{shot['id']}/versions", timeout=30).json()
        if not vers:
            payload = b"COOKIE_DL_TEST"
            init = admin.post(f"{BASE}/projects/{pid}/shots/{shot['id']}/versions/init",
                              json={"filename": "t.bin", "total_size": len(payload)}, timeout=30).json()
            admin.put(f"{BASE}/projects/{pid}/uploads/{init['upload_id']}/chunk?offset=0",
                      data=payload,
                      headers={"Content-Type": "application/octet-stream"}, timeout=30)
            v = admin.post(
                f"{BASE}/projects/{pid}/shots/{shot['id']}/versions/complete?upload_id={init['upload_id']}",
                timeout=30).json()
            vid = v["id"]
            content_type_expected = "application/octet-stream"
        else:
            vid = vers[0]["id"]
            content_type_expected = vers[0].get("content_type", "application/octet-stream")

        # Cookie-based (session with cookie)
        r = admin.get(f"{BASE}/projects/{pid}/versions/{vid}/download", timeout=30)
        assert r.status_code == 200, r.text
        # content-type header check
        assert content_type_expected.split(";")[0] in r.headers.get("content-type", "")
        assert len(r.content) > 0

    def test_download_unauthenticated(self, pid):
        # need a real vid
        s = _login(*ADMIN)
        shots = s.get(f"{BASE}/projects/{pid}/shots", timeout=30).json()
        vers = s.get(f"{BASE}/projects/{pid}/shots/{shots[0]['id']}/versions", timeout=30).json()
        if not vers:
            pytest.skip("no version present")
        r = requests.get(f"{BASE}/projects/{pid}/versions/{vers[0]['id']}/download", timeout=30)
        assert r.status_code == 401
