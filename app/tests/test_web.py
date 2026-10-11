import io
import json
import subprocess
import pathlib
import shutil
import zipfile

import pytest
from fastapi.testclient import TestClient
from conftest import env
from skipture import auth, clock, libs, png
from skipture.config import Config, set_config
from skipture.db import DB
from skipture.main import create_app

PASS = "correct horse battery"
RED = bytes([255, 0, 0, 255])


def art(w, h, rgba=RED):
    return png.encode_rgba(w, h, rgba * (w * h))


@pytest.fixture
def c(tmp_path):
    auth.reset_fails()
    set_config(Config(env(tmp_path)))
    cl = TestClient(create_app(), follow_redirects=False)
    assert cl.post("/setup", data={"passphrase": PASS, "confirm": PASS}).status_code == 303
    cl.dbpath = tmp_path / "skipture.db"
    yield cl
    clock.set_now(None)


def seed(c, n=3, with_art=True):
    db = DB(c.dbpath)
    lid = libs.create_library(db, "Tadpole frogs", "Tadpole")
    ids = [libs.add_slot(db, lid, f"frog-{i}", f"Frog {i}", 8, 6, art=art(8, 6) if with_art else None, origin="app") for i in range(n)]
    db.close()
    return lid, ids


def test_everything_needs_the_passphrase_and_only_the_tailnet_gets_in(tmp_path):
    auth.reset_fails()
    set_config(Config(env(tmp_path, SKIPTURE_REQUIRE_TS_HEADER="1", SKIPTURE_TS_LOGINS="me@example.com")))
    cl = TestClient(create_app(), follow_redirects=False)
    assert cl.get("/").status_code == 403 and cl.get("/healthz").status_code == 200
    me = {"Tailscale-User-Login": "me@example.com"}
    assert cl.get("/", headers=me).headers["location"] == "/setup"
    cl.post("/setup", data={"passphrase": PASS, "confirm": PASS}, headers=me)
    cl.cookies.clear()
    assert cl.get("/", headers=me).status_code == 303
    assert cl.post("/sprite/1/save", content=art(8, 6), headers=me).status_code == 401
    assert cl.post("/login", data={"passphrase": "wrong wrong wrong"}, headers=me).status_code == 200
    assert cl.post("/login", data={"passphrase": PASS}, headers=me).status_code == 303


def test_cross_site_posts_are_blocked(c):
    assert c.post("/library", data={"name": "x"}, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403


def test_dashboard_and_library_pages_show_progress(c):
    assert "Nothing yet" in c.get("/").text
    lid, ids = seed(c)
    db = DB(c.dbpath); libs.set_state(db, ids[0], "humanize"); db.close()
    page = c.get("/").text
    assert "Tadpole frogs" in page and "33%" in page and "1 of 3 humanized" in page
    lib = c.get(f"/library/{lid}").text
    assert "33" in lib and "Export partial" in lib and "Frog 1" in lib and f"/sprite/{ids[1]}/png" in lib
    assert "Frog 0" not in c.get(f"/library/{lid}?show=raw").text and "Frog 0" in c.get(f"/library/{lid}?show=humanized").text
    assert c.get("/library/999").status_code == 404


def test_explainer_text_lives_only_in_callouts(c):
    lid, ids = seed(c)
    for url in ("/", f"/library/{lid}", f"/sprite/{ids[0]}", "/import"):
        html = c.get(url).text
        assert 'class="infobtn"' in html and 'class="callout"' in html


def test_editor_page_carries_what_the_script_needs(c):
    lid, ids = seed(c)
    page = c.get(f"/sprite/{ids[1]}").text
    for needle in ('id="cv"', 'id="wheel"', 'data-tool="pen"', 'data-tool="erase"', 'data-tool="fill"', 'id="undo"', 'id="redo"', 'name="bg" value="transparent"', 'name="bg" value="opaque"',
                   'data-w="8"', 'data-h="6"', f'data-save="/sprite/{ids[1]}/save"', "/static/editor.js", "/static/core.js"):
        assert needle in page, needle
    assert c.get("/sprite/9999").status_code == 404


def test_sprite_png_is_the_stored_art_and_original_is_separate(c):
    lid, ids = seed(c)
    assert c.get(f"/sprite/{ids[0]}/png").content == art(8, 6)
    blue = art(8, 6, bytes([0, 0, 255, 255]))
    c.post(f"/sprite/{ids[0]}/save", content=blue, headers={"X-Skipture-Changed": "48"})
    assert c.get(f"/sprite/{ids[0]}/png").content == blue
    assert c.get(f"/sprite/{ids[0]}/png?which=original").content == art(8, 6)
    assert "immutable" in c.get(f"/sprite/{ids[0]}/png?v=1").headers["cache-control"]


def test_saving_from_the_editor_updates_state_and_progress(c):
    lid, ids = seed(c)
    blue = art(8, 6, bytes([0, 0, 255, 255]))
    r = c.post(f"/sprite/{ids[0]}/save", content=blue, headers={"X-Skipture-Changed": "48", "X-Skipture-Edited": "1", "X-Skipture-Blank": "0", "X-Skipture-Bg": "opaque", "X-Skipture-Bg-Color": "#112233"})
    assert r.status_code == 200 and r.json()["state"] == "touched" and r.json()["changed_px"] == 48 and r.json()["pct"] == 0
    row = DB(c.dbpath).one("SELECT bg_mode,bg_color FROM sprites WHERE id=?", (ids[0],))
    assert (row["bg_mode"], row["bg_color"]) == ("opaque", "#112233")
    assert c.post(f"/sprite/{ids[0]}/save", content=art(9, 9)).status_code == 400
    assert c.post(f"/sprite/{ids[0]}/save", content=b"junk").status_code == 400
    r = c.post(f"/sprite/{ids[0]}/state", data={"action": "humanize"})
    assert r.status_code == 303
    assert c.get(f"/sprite/{ids[0]}").text.count("Undo sign-off") == 1
    c.post(f"/sprite/{ids[0]}/state", data={"action": "reset"})
    assert DB(c.dbpath).val("SELECT state FROM sprites WHERE id=?", (ids[0],)) == "raw"
    assert c.post(f"/sprite/{ids[0]}/state", data={"action": "bogus"}).status_code == 400


def test_signing_off_an_empty_slot_is_refused_politely(c):
    lid, ids = seed(c, 1, with_art=False)
    assert c.post(f"/sprite/{ids[0]}/state", data={"action": "humanize"}).status_code == 400
    assert "Draw something first" in c.get(f"/sprite/{ids[0]}").text


def test_history_and_restore(c):
    lid, ids = seed(c, 1)
    blue = art(8, 6, bytes([0, 0, 255, 255]))
    c.post(f"/sprite/{ids[0]}/save", content=blue, headers={"X-Skipture-Changed": "48"})
    page = c.get(f"/sprite/{ids[0]}/history").text
    assert "Restore" in page
    db = DB(c.dbpath); rid = db.val("SELECT id FROM revisions WHERE sprite_id=?", (ids[0],)); db.close()
    assert c.get(f"/revision/{rid}/png").content == art(8, 6)
    assert c.post(f"/sprite/{ids[0]}/restore", data={"revision": str(rid)}).status_code == 303
    assert c.get(f"/sprite/{ids[0]}/png").content == art(8, 6)


def test_schema_download_upload_and_library_export_through_the_web(c):
    lid, ids = seed(c, 2, with_art=False)
    r = c.get(f"/library/{lid}/schema.zip")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip" and "tadpole-frogs-schema.zip" in r.headers["content-disposition"]
    src = zipfile.ZipFile(io.BytesIO(r.content))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("schema.json", src.read("schema.json"))
        for n in src.namelist():
            if n.startswith("sprites/"):
                z.writestr(n, art(8, 6, bytes([9, 99, 199, 255])))
    up = c.post("/import", files={"file": ("filled.zip", out.getvalue(), "application/zip")})
    assert up.status_code == 200 and "Merged into" in up.text and "2" in up.text
    assert DB(c.dbpath).val("SELECT COUNT(*) FROM sprites WHERE state='raw'") == 2
    bad = c.post("/import", files={"file": ("x.zip", b"nope", "application/zip")})
    assert bad.status_code == 200 and "not a zip" in bad.text
    ex = c.get(f"/library/{lid}/export.zip")
    assert "partial" in ex.headers["content-disposition"]
    for i in ids:
        c.post(f"/sprite/{i}/state", data={"action": "humanize"})
    ex = c.get(f"/library/{lid}/export.zip")
    assert "tadpole-frogs-library.zip" in ex.headers["content-disposition"]
    assert "Export library" in c.get(f"/library/{lid}").text and "finished library" in c.get(f"/library/{lid}").text


def test_creating_editing_and_deleting_libraries_and_slots(c):
    r = c.post("/library", data={"name": "Gloom textures", "app": "Hexcrawl", "description": "stone"})
    assert r.status_code == 303
    lid = int(r.headers["location"].split("/")[-1])
    r = c.post(f"/library/{lid}/slot", data={"slot": "wall-stone", "name": "Stone wall", "width": "16", "height": "16", "kind": "texture", "tile": "1", "bg_mode": "opaque", "bg_color": "#222222"})
    assert r.status_code == 303
    sid = int(r.headers["location"].split("/")[-1])
    page = c.get(f"/sprite/{sid}").text
    assert 'data-bg-mode="opaque"' in page and 'id="pvt"' in page, "textures that tile get a tiled preview"
    assert c.post(f"/library/{lid}/slot", data={"slot": "Bad Id", "width": "4", "height": "4"}).status_code == 400
    assert c.post(f"/library/{lid}/slot", data={"slot": "x", "width": "abc", "height": "4"}).status_code == 400
    c.post(f"/library/{lid}/edit", data={"name": "Gloom", "app": "Hexcrawl 2", "description": ""})
    assert "Hexcrawl 2" in c.get("/").text
    c.post(f"/sprite/{sid}/meta", data={"name": "Wall", "kind": "sprite", "category": "walls", "notes": "mossy"})
    assert "mossy" in c.get(f"/sprite/{sid}").text
    assert c.post(f"/sprite/{sid}/delete", data={}).status_code == 400
    assert c.post(f"/sprite/{sid}/delete", data={"confirm": "1"}).status_code == 303
    assert c.post(f"/library/{lid}/delete", data={"confirm": "wrong"}).status_code == 400
    assert c.post(f"/library/{lid}/delete", data={"confirm": "gloom-textures"}).status_code == 303
    assert c.get(f"/library/{lid}").status_code == 404


def test_manifest_and_static_assets(c):
    m = c.get("/manifest.webmanifest").json()
    assert m["name"] == "Skipture" and {i["purpose"] for i in m["icons"]} == {"any", "maskable"}
    for u in ("/static/core.js", "/static/editor.js", "/static/app.css", "/static/icons/icon-512.png"):
        assert c.get(u).status_code == 200


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_editor_core_passes_its_node_tests():
    here = pathlib.Path(__file__).parent
    r = subprocess.run(["node", "--test", str(here / "core.test.js")], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-1000:]
