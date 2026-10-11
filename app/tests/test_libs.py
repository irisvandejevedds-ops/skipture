import io
import json
import zipfile

import pytest
from skipture import libs, png

RED = bytes([255, 0, 0, 255])


def art(w, h, rgba=RED):
    return png.encode_rgba(w, h, rgba * (w * h))


def make_lib(db, n=3, with_art=False):
    lid = libs.create_library(db, "Tadpole frogs", "Tadpole", "the frog stages")
    for i in range(n):
        libs.add_slot(db, lid, f"frog-{i}", f"Frog {i}", 8, 6, art=art(8, 6) if with_art else None, origin="app")
    return lid


def slot(db, lid, name):
    return db.one("SELECT * FROM sprites WHERE library_id=? AND slot=?", (lid, name))


def test_png_helpers_read_sizes_and_reject_junk():
    assert png.info(art(5, 7)) == (5, 7)
    assert png.info(png.blank(3, 3)) == (3, 3)
    for bad in (b"", b"hello", art(5, 7)[:-8], png.SIGNATURE + b"x" * 40):
        with pytest.raises(png.BadPng):
            png.info(bad)
    with pytest.raises(png.BadPng):
        png.info(png.blank(600, 4))


def test_new_slots_start_empty_and_seeded_ones_start_raw(db):
    lid = make_lib(db, 2)
    assert {r["state"] for r in db.q("SELECT state FROM sprites")} == {"empty"}
    lid2 = libs.create_library(db, "Other")
    libs.add_slot(db, lid2, "a", "A", 4, 4, art=art(4, 4), origin="app")
    assert db.val("SELECT state FROM sprites WHERE library_id=?", (lid2,)) == "raw"


def test_slot_ids_sizes_and_art_are_validated(db):
    lid = libs.create_library(db, "L")
    for bad in ("Has Space", "../x", "", "a" * 70, "UPPER!"):
        with pytest.raises(libs.LibError):
            libs.add_slot(db, lid, bad, "x", 4, 4)
    with pytest.raises(libs.LibError):
        libs.add_slot(db, lid, "big", "x", 9999, 4)
    with pytest.raises(libs.LibError):
        libs.add_slot(db, lid, "wrong", "x", 4, 4, art=art(5, 5))
    libs.add_slot(db, lid, "ok", "x", 4, 4)
    with pytest.raises(libs.LibError):
        libs.add_slot(db, lid, "ok", "x", 4, 4)


def test_progress_counts_only_signed_off_slots(db):
    lid = make_lib(db, 4, with_art=True)
    p = libs.progress(db, lid)
    assert (p["total"], p["humanized"], p["pct"], p["complete"]) == (4, 0, 0, False)
    libs.set_state(db, slot(db, lid, "frog-0")["id"], "humanize")
    libs.save_art(db, slot(db, lid, "frog-1")["id"], art(8, 6, bytes([0, 0, 255, 255])), 48, False, True)
    p = libs.progress(db, lid)
    assert p["counts"] == {"empty": 0, "raw": 2, "touched": 1, "humanized": 1} and p["pct"] == 25 and not p["complete"]
    for n in ("frog-1", "frog-2", "frog-3"):
        libs.set_state(db, slot(db, lid, n)["id"], "humanize")
    p = libs.progress(db, lid)
    assert p["pct"] == 100 and p["complete"]
    assert libs.overall(db)["pct"] == 100


def test_state_rules_on_save(db):
    lid = make_lib(db, 2, with_art=True)
    s = slot(db, lid, "frog-0")
    blue = art(8, 6, bytes([0, 0, 255, 255]))
    assert libs.save_art(db, s["id"], blue, 48, False, True) == "touched"
    assert slot(db, lid, "frog-0")["changed_px"] == 48
    libs.set_state(db, s["id"], "humanize")
    assert slot(db, lid, "frog-0")["humanized_at"]
    assert libs.save_art(db, s["id"], blue, 48, False, False) == "humanized", "saving without changing a pixel keeps the sign-off"
    assert libs.save_art(db, s["id"], art(8, 6, bytes([0, 255, 0, 255])), 48, False, True) == "touched", "editing humanized work needs a new sign-off"
    assert slot(db, lid, "frog-0")["humanized_at"] is None
    assert libs.save_art(db, s["id"], slot(db, lid, "frog-0")["original_png"], 0, False, True) == "raw", "drawing back to the original is raw again"
    assert libs.save_art(db, s["id"], png.blank(8, 6), 48, True, True) == "empty"


def test_drawing_into_an_empty_slot_counts_as_touched_and_can_be_signed_off(db):
    lid = make_lib(db, 1)
    s = slot(db, lid, "frog-0")
    with pytest.raises(libs.LibError):
        libs.set_state(db, s["id"], "humanize")
    assert libs.save_art(db, s["id"], art(8, 6), 48, False, True) == "touched"
    assert slot(db, lid, "frog-0")["origin"] == "drawn"
    libs.set_state(db, s["id"], "humanize")
    assert slot(db, lid, "frog-0")["state"] == "humanized"


def test_save_rejects_the_wrong_size(db):
    lid = make_lib(db, 1)
    with pytest.raises(libs.LibError):
        libs.save_art(db, slot(db, lid, "frog-0")["id"], art(9, 9), 1, False, True)


def test_reset_restores_the_original_and_history_keeps_the_hand_work(db):
    lid = make_lib(db, 1, with_art=True)
    s = slot(db, lid, "frog-0")
    blue = art(8, 6, bytes([0, 0, 255, 255]))
    libs.save_art(db, s["id"], blue, 48, False, True)
    libs.set_state(db, s["id"], "reset")
    now = slot(db, lid, "frog-0")
    assert now["png"] == now["original_png"] and now["state"] == "raw" and now["changed_px"] == 0
    revs = db.q("SELECT * FROM revisions WHERE sprite_id=? ORDER BY id", (s["id"],))
    assert any(r["png"] == blue for r in revs)
    libs.restore_revision(db, s["id"], [r for r in revs if r["png"] == blue][0]["id"])
    assert slot(db, lid, "frog-0")["png"] == blue and slot(db, lid, "frog-0")["state"] == "touched"


def test_revisions_are_capped(db):
    lid = make_lib(db, 1, with_art=True)
    sid = slot(db, lid, "frog-0")["id"]
    for i in range(libs.KEEP_REVISIONS + 10):
        libs.save_art(db, sid, art(8, 6, bytes([i, 0, 0, 255])), 1, False, True)
    assert db.val("SELECT COUNT(*) FROM revisions WHERE sprite_id=?", (sid,)) == libs.KEEP_REVISIONS


def unzip(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    return json.loads(z.read("schema.json")), z


def test_schema_export_has_blank_placeholders_and_no_state(db):
    lid = make_lib(db, 2, with_art=True)
    data, name, complete = libs.export_zip(db, lid, "schema")
    schema, z = unzip(data)
    assert name == "tadpole-frogs-schema.zip" and not complete
    assert schema["format"] == "skipture-library" and schema["purpose"] == "schema" and schema["library"]["slug"] == "tadpole-frogs"
    assert [s["slot"] for s in schema["sprites"]] == ["frog-0", "frog-1"] and all("state" not in s for s in schema["sprites"])
    assert "README.txt" in z.namelist() and png.info(z.read("sprites/frog-0.png")) == (8, 6)
    assert z.read("sprites/frog-0.png") == png.blank(8, 6), "schema carries placeholders, not the current art"


def developer_zip(schema_bytes, fill, skip=(), size_override=None):
    """What a developer does: open the schema zip, put their art in each placeholder, and zip it back up."""
    src = zipfile.ZipFile(io.BytesIO(schema_bytes))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("schema.json", src.read("schema.json"))
        for n in src.namelist():
            if n.startswith("sprites/"):
                slot_id = n[8:-4]
                if slot_id in skip:
                    continue
                w, h = png.info(src.read(n))
                if size_override and slot_id in size_override:
                    w, h = size_override[slot_id]
                z.writestr(n, art(w, h, bytes(fill[slot_id] if isinstance(fill, dict) else fill)))
    return out.getvalue()


def test_full_round_trip_to_a_developer_and_back(db):
    lid = make_lib(db, 3)
    schema_zip, _, _ = libs.export_zip(db, lid, "schema")
    filled = developer_zip(schema_zip, (200, 100, 50, 255), skip=("frog-2",))
    r = libs.import_zip(db, filled)
    assert not r["created"] and sorted(r["updated"]) == ["frog-0", "frog-1"] and any("frog-2" in x for x in r["skipped"]) and not r["problems"]
    assert slot(db, lid, "frog-0")["state"] == "raw" and slot(db, lid, "frog-0")["origin"] == "developer"
    assert slot(db, lid, "frog-2")["state"] == "empty"
    # the human works
    blue = art(8, 6, bytes([0, 0, 255, 255]))
    libs.save_art(db, slot(db, lid, "frog-0")["id"], blue, 48, False, True)
    libs.set_state(db, slot(db, lid, "frog-0")["id"], "humanize")
    libs.set_state(db, slot(db, lid, "frog-1")["id"], "humanize")
    # the developer sends everything again; humanized work must survive, and the late slot arrives
    again = developer_zip(schema_zip, (1, 2, 3, 255))
    r2 = libs.import_zip(db, again)
    assert sorted(r2["updated"]) == ["frog-2"] and len(r2["kept"]) == 2
    assert slot(db, lid, "frog-0")["png"] == blue and slot(db, lid, "frog-0")["state"] == "humanized"
    assert slot(db, lid, "frog-2")["state"] == "raw"
    # not finished: a partial export says so
    data, name, complete = libs.export_zip(db, lid, "library")
    schema, z = unzip(data)
    assert not complete and name.endswith("-partial.zip") and schema["complete"] is False and schema["humanized"] == {"done": 2, "of": 3}
    libs.set_state(db, slot(db, lid, "frog-2")["id"], "humanize")
    data, name, complete = libs.export_zip(db, lid, "library")
    schema, z = unzip(data)
    assert complete and name.endswith("-library.zip") and schema["complete"] is True
    assert z.read("sprites/frog-0.png") == blue
    assert {s["state"] for s in schema["sprites"]} == {"humanized"}
    assert db.val("SELECT COUNT(*) FROM exports WHERE library_id=?", (lid,)) == 3


def test_import_reports_wrong_sizes_and_unknown_slots_without_touching_anything(db):
    lid = make_lib(db, 2)
    schema_zip, _, _ = libs.export_zip(db, lid, "schema")
    bad = developer_zip(schema_zip, (9, 9, 9, 255), size_override={"frog-0": (3, 3)})
    r = libs.import_zip(db, bad)
    assert r["updated"] == ["frog-1"] and len(r["problems"]) == 1 and "frog-0" in r["problems"][0] and slot(db, lid, "frog-0")["state"] == "empty"
    # a slot the library does not have is ignored when merging
    src = zipfile.ZipFile(io.BytesIO(bad))
    schema = json.loads(src.read("schema.json"))
    schema["sprites"].append({"slot": "sneaky", "name": "x", "width": 2, "height": 2})
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("schema.json", json.dumps(schema)); z.writestr("sprites/sneaky.png", art(2, 2))
    r = libs.import_zip(db, out.getvalue())
    assert any("sneaky" in x for x in r["skipped"]) and not slot(db, lid, "sneaky")


def test_importing_an_unknown_library_creates_it_with_its_art(db):
    lid = make_lib(db, 2, with_art=True)
    data, _, _ = libs.export_zip(db, lid, "library")
    db.ex("DELETE FROM libraries WHERE id=?", (lid,))
    r = libs.import_zip(db, data)
    assert r["created"] and sorted(r["added"]) == ["frog-0", "frog-1"]
    new = db.one("SELECT * FROM libraries WHERE slug='tadpole-frogs'")
    assert new["app"] == "Tadpole" and slot(db, new["id"], "frog-0")["state"] == "raw"


@pytest.mark.parametrize("make", [
    lambda: b"not a zip",
    lambda: (lambda b: (zipfile.ZipFile(b, "w").writestr("x.txt", "hi"), b.getvalue())[1])(io.BytesIO()),
    lambda: (lambda b: (zipfile.ZipFile(b, "w").writestr("schema.json", "{nope"), b.getvalue())[1])(io.BytesIO()),
    lambda: (lambda b: (zipfile.ZipFile(b, "w").writestr("schema.json", json.dumps({"format": "other"})), b.getvalue())[1])(io.BytesIO()),
])
def test_bad_zips_are_refused(db, make):
    with pytest.raises(libs.LibError):
        libs.import_zip(db, make())


def test_path_tricks_in_slot_names_never_read_other_files(db):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("schema.json", json.dumps({"format": "skipture-library", "library": {"slug": "evil", "name": "Evil"},
                                              "sprites": [{"slot": "../../etc/passwd", "name": "x", "width": 2, "height": 2}, {"slot": "ok", "name": "ok", "width": 2, "height": 2}]}))
        z.writestr("sprites/ok.png", art(2, 2))
        z.writestr("../../escape.png", art(2, 2))
    r = libs.import_zip(db, out.getvalue())
    assert r["added"] == ["ok"] and len(r["problems"]) == 1 and "passwd" in r["problems"][0]
    assert db.val("SELECT COUNT(*) FROM sprites") == 1
    assert not db.one("SELECT 1 FROM sprites WHERE slot LIKE '%..%' OR slot LIKE '%/%'")


def test_a_zip_with_too_much_inside_is_refused(db):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("schema.json", json.dumps({"format": "skipture-library", "library": {"slug": "b", "name": "B"}, "sprites": []}))
        z.writestr("sprites/huge.bin", b"\0" * 130_000_000)
    with pytest.raises(libs.LibError):
        libs.import_zip(db, out.getvalue())
