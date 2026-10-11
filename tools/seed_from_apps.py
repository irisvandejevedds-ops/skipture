"""Packages the art that Alberich and Tadpole draw in code as Skipture library zips, ready for `python -m skipture.importer`.

    python tools/seed_from_apps.py OUT_DIR

Each app draws its sprites from letter grids plus a palette; this renders every grid to a real PNG at its native size (one grid cell = one pixel),
so a hand-redrawn version can later replace the generated one. Moods and colour variants that the apps make by recolouring are seeded once, from the master."""
import io
import json
import pathlib
import re
import sys
import zipfile

HOME = pathlib.Path.home()
sys.path.insert(0, str(HOME / "finance-app/app"))
sys.path.insert(0, str(HOME / "tadpole-app/app"))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "app"))
from skipture import png  # noqa: E402
from finapp import pxicons, sprites as alb_sprites, warlock_art  # noqa: E402
from tadpole import sprites as tp_sprites  # noqa: E402


def rgba(hex_):
    h = hex_.lstrip("#")
    return bytes((int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255))


def render(w, h, cells, palette):
    """cells: {(x, y): letter}. -> PNG bytes."""
    px = bytearray(w * h * 4)
    for (x, y), ch in cells.items():
        if 0 <= x < w and 0 <= y < h:
            px[(y * w + x) * 4:(y * w + x) * 4 + 4] = rgba(palette[ch])
    return png.encode_rgba(w, h, bytes(px))


def rows_to_cells(rows):
    return {(x, y): ch for y, row in enumerate(rows) for x, ch in enumerate(row) if ch != "."}


def entry(slot, name, w, h, art, category="", notes="", kind="sprite"):
    return {"slot": slot, "name": name, "kind": kind, "width": w, "height": h, "tile": False, "background": "transparent", "background_color": None,
            "category": category, "notes": notes, "_art": art}


def package(out_dir, slug, name, app, description, entries):
    schema = {"format": "skipture-library", "version": 1, "purpose": "library", "library": {"slug": slug, "name": name, "app": app, "description": description},
              "sprites": [{k: v for k, v in e.items() if k != "_art"} for e in entries]}
    path = out_dir / f"seed-{slug}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("schema.json", json.dumps(schema, indent=2))
        for e in entries:
            z.writestr(f"sprites/{e['slot']}.png", e["_art"])
    return path, len(entries)


def alberich_characters():
    out = []
    for mood in alb_sprites.MOODS:
        cells = alb_sprites.grid(mood)
        out.append(entry(f"alberich-{mood}", f"Alberich, {mood}", alb_sprites.W, alb_sprites.H, render(alb_sprites.W, alb_sprites.H, cells, alb_sprites.PALETTES[mood]),
                         "bust", "The mood busts share one hand-drawn base with small overlays (eyes, brows, mouth) and palette tints; redraw each mood as a whole picture."))
    for mood in warlock_art.PAL:
        cells = warlock_art._cells(mood)
        out.append(entry(f"warlock-{mood}", f"The Warlock, {mood}", warlock_art.W, warlock_art.H, render(warlock_art.W, warlock_art.H, cells, warlock_art.PAL[mood]), "character"))
    return out


def alberich_icons():
    out = []
    for name, rows in pxicons.ICONS.items():
        rows = [r.ljust(16, ".")[:16] for r in rows][:16] + ["." * 16] * max(0, 16 - len(rows))
        out.append(entry(f"icon-{name}", name.replace("_", " ").title(), 16, 16, render(16, 16, rows_to_cells(rows), pxicons.PAL), "icon", "Drawn 16 by 16; the app shows these crisp at any size."))
    return out


def tadpole_frogs():
    names = ["Tadpole", "Back leg buds", "Back legs", "Four legs", "Froglet", "Frog"]
    pal = tp_sprites.PALETTES["green"]
    return [entry(f"frog-stage-{i}", names[i], tp_sprites.W, tp_sprites.H, render(tp_sprites.W, tp_sprites.H, rows_to_cells(tp_sprites.rows(i)), pal), "growth",
                  "The app recolours this picture yellow and red when entries are missed, so draw the green one." if i == 0 else "Green master; recoloured yellow and red by the app.")
            for i in range(6)]


def tadpole_icons():
    java = (HOME / "tadpole-app/android/src/app/tadpole/widget/Pixel.java").read_text()
    colors = {m.group(1): int(m.group(2), 16) for m in re.finditer(r"case '(.)': return 0xFF([0-9A-Fa-f]{6});", java)}
    foods = re.search(r"FOODS = \{(.*?)\};", java, re.S).group(1)
    food_rows = [re.findall(r'"([^"]*)"', block) for block in re.findall(r"\{([^{}]*)\}", foods)]
    food_names = ["wheat", "onion-garlic", "beans", "dairy", "apple-honey", "mushroom", "stone-fruit"]
    out = []
    for name, rows in zip(food_names, food_rows):
        pal = {ch: "#%06X" % colors[ch] for ch in colors}
        out.append(entry(f"food-{name}", f"{name.replace('-', ' ').title()} (FODMAP group)", 8, 8, render(8, 8, rows_to_cells(rows), pal), "food", "Icon for a FODMAP food group on the meal picker."))
    for name, label in (("STOOL", "Stool"), ("BRAIN", "Neuroinflammation"), ("MEAL", "Meal"), ("CHECK", "No symptoms"), ("X", "Close"), ("REFRESH", "Refresh")):
        m = re.search(rf"G_{name} = \{{(.*?)\}};", java, re.S) or re.search(rf"{name} = \{{\s*(.*?)\}};", java, re.S)
        rows = re.findall(r'"([^"]*)"', m.group(1))
        out.append(entry(f"glyph-{name.lower()}", f"{label} button", 8, 8, render(8, 8, {k: "k" for k in rows_to_cells(rows)}, {"k": "#16351F"}), "glyph", "One-colour glyph; the app colours it per button."))
    return out


def main():
    out = pathlib.Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for slug, name, app, desc, fn in (
        ("alberich-characters", "Alberich characters", "Alberich", "Alberich's mood busts and the Warlock.", alberich_characters),
        ("alberich-icons", "Alberich icons", "Alberich", "The 16 by 16 icons for pouches, activities and the ledger.", alberich_icons),
        ("tadpole-frogs", "Tadpole growth stages", "Tadpole", "The tadpole growing into a frog.", tadpole_frogs),
        ("tadpole-icons", "Tadpole icons", "Tadpole", "Food-group icons and widget button glyphs.", tadpole_icons),
    ):
        path, n = package(out, slug, name, app, desc, fn())
        print(f"{path.name}: {n} sprites")


if __name__ == "__main__":
    main()
