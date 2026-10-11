"""Libraries, slots, humanization, and the zip format that carries a library to a developer and back.

A library zip holds `schema.json` and `sprites/<slot>.png`. The same layout is the blank schema sent to a developer, the filled-in
zip they send back, and the finished library sent to them again."""
import io
import json
import re
import zipfile

from . import clock, png

SLOT = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
KINDS = ("sprite", "texture")
STATES = ("empty", "raw", "touched", "humanized")
FORMAT = "skipture-library"
MAX_ZIP_BYTES = 40_000_000
MAX_SPRITES = 1500
KEEP_REVISIONS = 25
README = """Skipture library
================

schema.json describes the slots in this library. Each slot is one sprite or texture.

To fill it in:
  1. Put a PNG for each slot at sprites/<slot>.png. The size must match the width and height in schema.json exactly.
  2. Transparent backgrounds: use a PNG with an alpha channel. Slots that say "opaque" must be fully filled.
  3. Zip the folder back up (keep schema.json and the sprites folder at the top level) and send it back.

Anything you draw here will be redrawn by hand before it ships. Do not change schema.json.
"""


class LibError(ValueError):
    pass


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:48]
    return s or "library"


def unique_slug(db, base):
    slug, n = base, 2
    while db.one("SELECT 1 FROM libraries WHERE slug=?", (slug,)):
        slug = f"{base[:44]}-{n}"
        n += 1
    return slug


def create_library(db, name, app="", description="", slug=None):
    name = (name or "").strip()[:80]
    if not name:
        raise LibError("Give the library a name.")
    now = clock.iso(clock.now())
    slug = unique_slug(db, slugify(slug or name))
    return db.ex("INSERT INTO libraries(slug,name,app,description,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                 (slug, name, (app or "").strip()[:60], (description or "").strip()[:500], now, now)).lastrowid


def touch_library(db, lib_id):
    db.ex("UPDATE libraries SET updated_at=? WHERE id=?", (clock.iso(clock.now()), lib_id))


def add_slot(db, lib_id, slot, name, width, height, kind="sprite", tile=False, bg_mode="transparent", bg_color="#FFFFFF", category="", notes="",
             art=None, origin=None, state=None):
    """Add a slot. art is PNG bytes when the slot arrives with art, otherwise it starts empty (a transparent placeholder)."""
    slot = (slot or "").strip().lower()
    if not SLOT.match(slot):
        raise LibError(f"'{slot}' is not a usable slot id: use lowercase letters, digits, dashes, underscores and dots (up to 64).")
    if db.one("SELECT 1 FROM sprites WHERE library_id=? AND slot=?", (lib_id, slot)):
        raise LibError(f"The slot '{slot}' already exists.")
    width, height = int(width), int(height)
    if not (1 <= width <= png.MAX_SIDE and 1 <= height <= png.MAX_SIDE):
        raise LibError(f"Size must be between 1 and {png.MAX_SIDE} pixels a side.")
    if kind not in KINDS:
        kind = "sprite"
    if bg_mode not in ("transparent", "opaque"):
        bg_mode = "transparent"
    if not HEX.match(bg_color or ""):
        bg_color = "#FFFFFF"
    if art is not None:
        if png.info(art) != (width, height):
            raise LibError(f"The art for '{slot}' is {png.info(art)[0]}x{png.info(art)[1]}, but the slot is {width}x{height}.")
        state, origin, data = state or "raw", origin or "app", art
    else:
        state, origin, data = "empty", "blank", png.blank(width, height)
    now = clock.iso(clock.now())
    order = db.val("SELECT COALESCE(MAX(sort),0)+1 FROM sprites WHERE library_id=?", (lib_id,))
    sid = db.ex("INSERT INTO sprites(library_id,slot,name,kind,width,height,tile,bg_mode,bg_color,category,notes,png,original_png,state,origin,sort,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (lib_id, slot, (name or slot).strip()[:80], kind, width, height, 1 if tile else 0, bg_mode, bg_color.upper(), (category or "").strip()[:40],
                 (notes or "").strip()[:500], data, data, state, origin, order, now, now)).lastrowid
    touch_library(db, lib_id)
    return sid


# ---------------- how humanized is it ----------------
def progress(db, lib_id):
    rows = db.q("SELECT state, width*height AS area, changed_px FROM sprites WHERE library_id=?", (lib_id,))
    counts = {s: 0 for s in STATES}
    area = done_area = 0
    for r in rows:
        counts[r["state"]] += 1
        area += r["area"]
        if r["state"] == "humanized":
            done_area += r["area"]
    total = len(rows)
    pct = 0 if total == 0 else int(100 * counts["humanized"] / total)
    return {"total": total, "counts": counts, "humanized": counts["humanized"], "pct": pct, "complete": total > 0 and counts["humanized"] == total,
            "area_pct": 0 if area == 0 else int(100 * done_area / area), "waiting": counts["empty"]}


def overall(db):
    rows = db.q("SELECT state FROM sprites")
    total = len(rows)
    done = sum(1 for r in rows if r["state"] == "humanized")
    return {"total": total, "humanized": done, "pct": 0 if total == 0 else int(100 * done / total)}


# ---------------- saving hand work ----------------
def _revision(db, sprite, note):
    db.ex("INSERT INTO revisions(sprite_id,png,state,note,created_at) VALUES(?,?,?,?,?)", (sprite["id"], sprite["png"], sprite["state"], note, clock.iso(clock.now())))
    db.ex("DELETE FROM revisions WHERE sprite_id=? AND id NOT IN (SELECT id FROM revisions WHERE sprite_id=? ORDER BY id DESC LIMIT ?)", (sprite["id"], sprite["id"], KEEP_REVISIONS))


def save_art(db, sprite_id, data, changed_px, blank, edited=True, bg_mode=None, bg_color=None):
    """Store hand-drawn art. changed_px is how many pixels now differ from the original, edited says the pixels differ from what was loaded,
    blank says nothing is drawn (the editor counts all three). Returns the new state. Changing humanized work drops it back to touched,
    so sign-off is always deliberate."""
    s = db.one("SELECT * FROM sprites WHERE id=?", (sprite_id,))
    if not s:
        raise LibError("No such sprite.")
    if png.info(data) != (s["width"], s["height"]):
        raise LibError(f"This sprite is {s['width']}x{s['height']}; the saved image is a different size.")
    changed_px = max(0, min(int(changed_px), s["width"] * s["height"]))
    if blank:
        state = "empty"
    elif s["state"] == "empty":
        state = "touched"
    elif edited:
        state = "touched" if changed_px else "raw"
    else:
        state = s["state"]
    if edited:
        _revision(db, s, "before a save")
    mode = bg_mode if bg_mode in ("transparent", "opaque") else s["bg_mode"]
    color = bg_color.upper() if bg_color and HEX.match(bg_color) else s["bg_color"]
    origin = "drawn" if s["state"] == "empty" and not blank else s["origin"]
    now = clock.iso(clock.now())
    db.ex("UPDATE sprites SET png=?, state=?, changed_px=?, bg_mode=?, bg_color=?, origin=?, humanized_at=?, updated_at=? WHERE id=?",
          (data, state, changed_px, mode, color, origin, s["humanized_at"] if state == "humanized" else None, now, sprite_id))
    touch_library(db, s["library_id"])
    return state


def set_state(db, sprite_id, action):
    """action: humanize | unhumanize | reset. Humanize is the human sign-off; reset puts the original art back."""
    s = db.one("SELECT * FROM sprites WHERE id=?", (sprite_id,))
    if not s:
        raise LibError("No such sprite.")
    now = clock.iso(clock.now())
    if action == "humanize":
        if s["state"] == "empty":
            raise LibError("There is no art in this slot yet. Draw something or wait for the developer's art first.")
        db.ex("UPDATE sprites SET state='humanized', humanized_at=?, updated_at=? WHERE id=?", (now, now, sprite_id))
    elif action == "unhumanize":
        db.ex("UPDATE sprites SET state=?, humanized_at=NULL, updated_at=? WHERE id=?", ("touched" if s["changed_px"] else "raw", now, sprite_id))
    elif action == "reset":
        if s["png"] != s["original_png"]:
            _revision(db, s, "before reset to original")
        db.ex("UPDATE sprites SET png=original_png, state=?, changed_px=0, humanized_at=NULL, updated_at=? WHERE id=?",
              ("empty" if s["origin"] == "blank" else "raw", now, sprite_id))
    else:
        raise LibError("Unknown action.")
    touch_library(db, s["library_id"])


def restore_revision(db, sprite_id, revision_id, changed_px=0):
    s = db.one("SELECT * FROM sprites WHERE id=?", (sprite_id,))
    r = db.one("SELECT * FROM revisions WHERE id=? AND sprite_id=?", (revision_id, sprite_id))
    if not s or not r:
        raise LibError("No such version.")
    _revision(db, s, "before restoring an earlier version")
    now = clock.iso(clock.now())
    state = "raw" if r["png"] == s["original_png"] else "touched"
    db.ex("UPDATE sprites SET png=?, state=?, humanized_at=NULL, updated_at=? WHERE id=?", (r["png"], state, now, sprite_id))
    touch_library(db, s["library_id"])


# ---------------- the zip ----------------
def _slot_json(s, with_state):
    d = {"slot": s["slot"], "name": s["name"], "kind": s["kind"], "width": s["width"], "height": s["height"], "tile": bool(s["tile"]),
         "background": s["bg_mode"], "background_color": s["bg_color"] if s["bg_mode"] == "opaque" else None, "category": s["category"], "notes": s["notes"]}
    if with_state:
        d["state"] = s["state"]
        d["humanized_at"] = s["humanized_at"]
    return d


def export_zip(db, lib_id, purpose):
    """purpose: 'schema' (blank slots for a developer) or 'library' (the art as it stands). -> (bytes, filename, complete)."""
    lib = db.one("SELECT * FROM libraries WHERE id=?", (lib_id,))
    if not lib:
        raise LibError("No such library.")
    sprites = db.q("SELECT * FROM sprites WHERE library_id=? ORDER BY sort, id", (lib_id,))
    prog = progress(db, lib_id)
    schema = {"format": FORMAT, "version": 1, "purpose": purpose, "generated_at": clock.iso(clock.now()),
              "library": {"slug": lib["slug"], "name": lib["name"], "app": lib["app"], "description": lib["description"]},
              "sprites": [_slot_json(s, purpose == "library") for s in sprites]}
    if purpose == "library":
        schema["complete"] = prog["complete"]
        schema["humanized"] = {"done": prog["humanized"], "of": prog["total"]}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("schema.json", json.dumps(schema, indent=2, ensure_ascii=False))
        z.writestr("README.txt", README if purpose == "schema" else
                   f"{lib['name']}: {prog['humanized']} of {prog['total']} sprites humanized" + ("" if prog["complete"] else " (partial export: slots marked in schema.json are not finished)") + ".\n"
                   "Drop sprites/<slot>.png into your project. schema.json lists every slot.\n")
        for s in sprites:
            if purpose == "schema":
                z.writestr(f"sprites/{s['slot']}.png", png.blank(s["width"], s["height"], (255, 255, 255, 255) if s["bg_mode"] == "opaque" else (0, 0, 0, 0)))
            elif s["state"] != "empty":
                z.writestr(f"sprites/{s['slot']}.png", s["png"])
    db.ex("INSERT INTO exports(library_id,kind,complete,humanized,total,created_at) VALUES(?,?,?,?,?,?)",
          (lib_id, purpose, 1 if prog["complete"] else 0, prog["humanized"], prog["total"], clock.iso(clock.now())))
    return buf.getvalue(), f"{lib['slug']}-{'schema' if purpose == 'schema' else 'library' if prog['complete'] else 'partial'}.zip", prog["complete"]


def read_zip(data):
    """Open an uploaded library zip safely. -> (schema dict, ZipFile). Never extracts anything to disk."""
    if len(data) > MAX_ZIP_BYTES:
        raise LibError("That zip is bigger than 40 MB.")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise LibError("That is not a zip file.")
    infos = z.infolist()
    if len(infos) > MAX_SPRITES * 2 + 10 or sum(i.file_size for i in infos) > 120_000_000:
        raise LibError("That zip is too large or has too many files.")
    if "schema.json" not in z.namelist():
        raise LibError("There is no schema.json at the top of that zip.")
    try:
        schema = json.loads(z.read("schema.json"))
    except ValueError:
        raise LibError("schema.json is not valid JSON.")
    if not isinstance(schema, dict) or schema.get("format") != FORMAT or not isinstance(schema.get("sprites"), list) or not isinstance(schema.get("library"), dict):
        raise LibError("schema.json is not a Skipture library schema.")
    if len(schema["sprites"]) > MAX_SPRITES:
        raise LibError("That library has too many sprites.")
    return schema, z


def import_zip(db, data, origin="developer"):
    """Merge a library zip into Skipture. A zip for a library we know adds art only where it is safe: slots that are empty or still raw take the new art,
    slots that have been touched or humanized are left alone. A zip for an unknown library creates it. -> report dict."""
    schema, z = read_zip(data)
    lib_meta = schema["library"]
    slug = slugify(lib_meta.get("slug") or lib_meta.get("name") or "library")
    lib = db.one("SELECT * FROM libraries WHERE slug=?", (slug,))
    report = {"library": None, "created": False, "added": [], "updated": [], "kept": [], "skipped": [], "problems": []}
    names = set(z.namelist())
    with db.tx():
        if lib is None:
            lib_id = create_library(db, lib_meta.get("name") or slug, lib_meta.get("app", ""), lib_meta.get("description", ""), slug=slug)
            report["created"] = True
            lib = db.one("SELECT * FROM libraries WHERE id=?", (lib_id,))
        report["library"] = {"id": lib["id"], "name": lib["name"]}
        for d in schema["sprites"]:
            try:
                if not isinstance(d, dict):
                    raise LibError("a slot entry is not an object")
                slot = str(d.get("slot", "")).lower()
                path = f"sprites/{slot}.png"
                art = z.read(path) if (SLOT.match(slot) and path in names) else None
                existing = db.one("SELECT * FROM sprites WHERE library_id=? AND slot=?", (lib["id"], slot))
                if art is not None:
                    png.info(art)
                if existing is None:
                    if not report["created"]:
                        report["skipped"].append(f"{slot}: not a slot in this library, ignored")
                        continue
                    add_slot(db, lib["id"], slot, d.get("name") or slot, d["width"], d["height"], d.get("kind", "sprite"), bool(d.get("tile")),
                             d.get("background", "transparent"), d.get("background_color") or "#FFFFFF", d.get("category", ""), d.get("notes", ""), art=art,
                             origin=origin, state="raw" if art else None)
                    report["added"].append(slot)
                    continue
                if art is None:
                    report["skipped"].append(f"{slot}: no sprites/{slot}.png in the zip")
                    continue
                if png.info(art) != (existing["width"], existing["height"]):
                    w, h = png.info(art)
                    raise LibError(f"is {w}x{h} but the slot is {existing['width']}x{existing['height']}")
                if existing["state"] in ("touched", "humanized"):
                    report["kept"].append(f"{slot}: already {existing['state']}, your version was kept")
                    continue
                if art == existing["png"]:
                    report["skipped"].append(f"{slot}: same art as before")
                    continue
                now = clock.iso(clock.now())
                if existing["state"] != "empty":
                    _revision(db, existing, "before developer art replaced it")
                db.ex("UPDATE sprites SET png=?, original_png=?, state='raw', changed_px=0, origin=?, humanized_at=NULL, updated_at=? WHERE id=?",
                      (art, art, origin, now, existing["id"]))
                report["updated"].append(slot)
            except (LibError, png.BadPng, KeyError, TypeError, ValueError) as e:
                report["problems"].append(f"{d.get('slot', '?') if isinstance(d, dict) else '?'}: {e}")
        touch_library(db, lib["id"])
    return report
