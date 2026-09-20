"""Tests for Resource Library + Auto-map + Build-scenes + Per-scene canvas."""
import os
import io
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://framework-set.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
PROJECT_ID = "154dbb84-f2e7-47c1-8daf-fab78d1b763b"
ADMIN = {"email": "tanphuoc.bn@gmail.com", "password": "Studio@2026"}


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return s


# ---- Resource CRUD ----
class TestResourceCRUD:
    def test_list_initial(self, sess):
        r = sess.get(f"{API}/projects/{PROJECT_ID}/resources", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_character_and_get(self, sess):
        name = f"TEST_{uuid.uuid4().hex[:6]}"
        r = sess.post(f"{API}/projects/{PROJECT_ID}/resources",
                      json={"kind": "character", "name": name}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == name and d["kind"] == "character" and "id" in d
        rid = d["id"]
        # verify via list
        lst = sess.get(f"{API}/projects/{PROJECT_ID}/resources?kind=character").json()
        assert any(x["id"] == rid for x in lst)
        # cleanup
        sess.delete(f"{API}/projects/{PROJECT_ID}/resources/{rid}")

    def test_create_background_upload_delete(self, sess):
        r = sess.post(f"{API}/projects/{PROJECT_ID}/resources",
                      json={"kind": "background", "name": f"TEST_BG_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200
        rid = r.json()["id"]

        # upload image
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
               b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff"
               b"?\x00\x05\xfe\x02\xfeA\x8a\xba@\x00\x00\x00\x00IEND\xaeB`\x82")
        up = sess.post(f"{API}/projects/{PROJECT_ID}/canvas/media",
                       files={"file": ("t.png", io.BytesIO(png), "image/png")}, timeout=30)
        assert up.status_code == 200, up.text
        mid = up.json()["media_id"]

        pr = sess.patch(f"{API}/projects/{PROJECT_ID}/resources/{rid}",
                        json={"media_id": mid, "media_name": "t.png"})
        assert pr.status_code == 200
        assert pr.json()["media_id"] == mid

        # delete
        dr = sess.delete(f"{API}/projects/{PROJECT_ID}/resources/{rid}")
        assert dr.status_code == 200

    def test_invalid_kind(self, sess):
        r = sess.post(f"{API}/projects/{PROJECT_ID}/resources",
                      json={"kind": "invalid", "name": "x"})
        assert r.status_code == 400


# ---- Auto-map ----
class TestAutoMap:
    def test_auto_map(self, sess):
        r = sess.post(f"{API}/projects/{PROJECT_ID}/resources/auto-map", timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "updated_scenes" in d and d["updated_scenes"] > 0
        assert "chars_assigned" in d
        assert "ai_used" in d

    def test_bg_assigned_to_cafe_scene(self, sess):
        scenes = sess.get(f"{API}/projects/{PROJECT_ID}/scenes").json()
        cafe = [s for s in scenes if "quán" in (s.get("title", "").lower() + s.get("location", "").lower())
                or "cà phê" in (s.get("title", "").lower() + s.get("location", "").lower())]
        assert cafe, "expected at least one cafe scene"
        assert any(s.get("background_id") for s in cafe), "cafe scene should have background_id after auto-map"


# ---- Scene PATCH persistence (characters, bg, design_note) ----
class TestScenePatch:
    def test_patch_characters_and_bg_persist(self, sess):
        scenes = sess.get(f"{API}/projects/{PROJECT_ID}/scenes").json()
        assert scenes
        sc = scenes[0]
        res = sess.get(f"{API}/projects/{PROJECT_ID}/resources").json()
        char = next((r for r in res if r["kind"] == "character"), None)
        bg = next((r for r in res if r["kind"] == "background"), None)
        assert char and bg
        note = f"TEST NOTE {uuid.uuid4().hex[:5]}"
        pr = sess.patch(f"{API}/projects/{PROJECT_ID}/scenes/{sc['id']}",
                        json={"characters": [char["id"]], "background_id": bg["id"],
                              "design_note": note, "rev": sc["rev"]})
        assert pr.status_code == 200, pr.text
        # reload
        got = sess.get(f"{API}/projects/{PROJECT_ID}/scenes/{sc['id']}").json()
        assert char["id"] in (got.get("characters") or [])
        assert got.get("background_id") == bg["id"]
        assert got.get("design_note") == note


# ---- Build-scenes + per-scene canvas independence ----
class TestBuildScenes:
    def test_build_creates_frames(self, sess):
        r = sess.post(f"{API}/projects/{PROJECT_ID}/canvas/build-scenes", timeout=60)
        assert r.status_code == 200, r.text
        canv = r.json()
        frames = [n for n in canv["nodes"] if n.get("type") == "frame" and n.get("ref_id")]
        assert len(frames) >= 1
        # each frame title contains code · title
        assert all(" · " in (f.get("title") or "") for f in frames)

    def test_scene_canvas_independent_from_project(self, sess):
        scenes = sess.get(f"{API}/projects/{PROJECT_ID}/scenes").json()
        sid = scenes[0]["id"]
        # get project canvas
        proj = sess.get(f"{API}/projects/{PROJECT_ID}/canvas").json()
        proj_rev = proj["rev"]
        proj_nodes = proj["nodes"]

        # get scene canvas
        sc_canv = sess.get(f"{API}/projects/{PROJECT_ID}/canvas?scene_id={sid}").json()
        # save modified scene canvas
        new_nodes = list(sc_canv["nodes"])
        marker = {"id": str(uuid.uuid4()), "type": "text", "x": 500, "y": 500, "w": 100, "h": 40,
                  "title": "TEST_MARKER", "text": "x"}
        new_nodes.append(marker)
        sv = sess.put(f"{API}/projects/{PROJECT_ID}/canvas?scene_id={sid}",
                      json={"nodes": new_nodes, "edges": sc_canv.get("edges", []), "rev": sc_canv["rev"]})
        assert sv.status_code == 200, sv.text

        # verify project canvas unchanged
        proj2 = sess.get(f"{API}/projects/{PROJECT_ID}/canvas").json()
        assert proj2["rev"] == proj_rev, "Project canvas rev should not change from scene save"
        assert len(proj2["nodes"]) == len(proj_nodes)

        # verify scene canvas has marker
        sc2 = sess.get(f"{API}/projects/{PROJECT_ID}/canvas?scene_id={sid}").json()
        assert any(n.get("title") == "TEST_MARKER" for n in sc2["nodes"])
