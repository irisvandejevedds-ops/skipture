"""Makes server-export.zip with the real Python code: a library exported by the server, with compressed (deflated) entries, for the browser tests to read.
    python gen_fixture.py        (run from this folder; needs only the standard library)"""
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app"))
from skipture import png            # noqa: E402

HERE = pathlib.Path(__file__).parent


def checker(w, h):
    px = bytearray()
    for y in range(h):
        for x in range(w):
            px += bytes((200, 60, 40, 255)) if (x + y) % 2 else bytes((0, 0, 0, 0))
    return png.encode_rgba(w, h, bytes(px))


schema = {"format": "skipture-library", "version": 1, "purpose": "schema", "library": {"slug": "fixture-lib", "name": "Fixture library", "app": "Test", "description": "from python"},
          "sprites": [{"slot": "frog", "name": "Frog", "kind": "sprite", "width": 8, "height": 6, "tile": False, "background": "transparent", "background_color": None, "category": "", "notes": "hop"},
                      {"slot": "grass", "name": "Grass", "kind": "texture", "width": 4, "height": 4, "tile": True, "background": "opaque", "background_color": "#336633", "category": "", "notes": ""}]}
import json
with zipfile.ZipFile(HERE / "server-export.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("schema.json", json.dumps(schema, indent=2))
    z.writestr("sprites/frog.png", checker(8, 6))
    z.writestr("sprites/grass.png", checker(4, 4))
print("wrote server-export.zip")
