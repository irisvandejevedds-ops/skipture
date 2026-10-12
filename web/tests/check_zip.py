"""Reads a zip the browser made with the server's own reader and decodes its PNGs. Exit code 0 means the server would accept it.   python check_zip.py FILE"""
import pathlib
import struct
import sys
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "app"))
from skipture import libs, png      # noqa: E402

schema, z = libs.read_zip(pathlib.Path(sys.argv[1]).read_bytes())
assert z.testzip() is None
for d in schema["sprites"]:
    if f"sprites/{d['slot']}.png" not in z.namelist():
        assert d.get("state") == "empty", d["slot"]       # a finished-library export leaves empty slots out
        continue
    data = z.read(f"sprites/{d['slot']}.png")
    assert png.info(data) == (d["width"], d["height"]), d["slot"]
    pos, idat = 8, b""
    while pos < len(data):
        n, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        assert zlib.crc32(kind + body) & 0xFFFFFFFF == struct.unpack(">I", data[pos + 8 + n:pos + 12 + n])[0], "crc"
        if kind == b"IDAT":
            idat += body
        pos += 12 + n
    assert len(zlib.decompress(idat)) == d["height"] * (d["width"] * 4 + 1)
print(len(schema["sprites"]), "slots fine")
