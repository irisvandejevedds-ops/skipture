"""Just enough PNG: read the size of one, check it is plausible, and write plain RGBA ones. No imaging library needed on the server."""
import struct
import zlib

SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_SIDE = 512
MAX_BYTES = 2_000_000


class BadPng(ValueError):
    pass


def info(data):
    """-> (width, height). Raises BadPng unless this looks like a real, reasonably sized PNG."""
    if not isinstance(data, (bytes, bytearray)) or len(data) < 33 or data[:8] != SIGNATURE:
        raise BadPng("not a PNG file")
    if len(data) > MAX_BYTES:
        raise BadPng("PNG is larger than 2 MB")
    length, kind = struct.unpack(">I4s", data[8:16])
    if kind != b"IHDR" or length != 13:
        raise BadPng("PNG header is damaged")
    w, h = struct.unpack(">II", data[16:24])
    if not (1 <= w <= MAX_SIDE and 1 <= h <= MAX_SIDE):
        raise BadPng(f"PNG is {w}x{h}; sprites must be between 1 and {MAX_SIDE} pixels a side")
    if b"IEND" not in data[-16:]:
        raise BadPng("PNG is cut off")
    return w, h


def _chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


def encode_rgba(w, h, pixels):
    """pixels: bytes of length w*h*4 (R,G,B,A per pixel, row by row) -> PNG bytes."""
    if len(pixels) != w * h * 4:
        raise ValueError("pixel data does not match the size")
    raw = b"".join(b"\x00" + bytes(pixels[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    return SIGNATURE + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + _chunk(b"IDAT", zlib.compress(raw, 9)) + _chunk(b"IEND", b"")


def blank(w, h, rgba=(0, 0, 0, 0)):
    return encode_rgba(w, h, bytes(rgba) * (w * h))
