"""Draws Skipture's icon: a pixel quill on dark ink. Full-bleed squares (Android and iOS add their own shape), the quill well inside the safe zone."""
import math
import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
INK, RUBRIC, RUBRIC_LT, RUBRIC_DK, CREAM, GOLD, DROP = "#1B1814", "#B4452B", "#E58A68", "#7C2D1B", "#F6EEDA", "#D8A93A", "#E9DFC4"
N = 16


def quill():
    grid = [[None] * N for _ in range(N)]
    ax, ay, bx, by = 3.0, 12.5, 14.0, 1.5
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    for y in range(N):
        for x in range(N):
            px, py = x + .5 - ax, y + .5 - ay
            t = (px * ux + py * uy) / length
            d = -px * uy + py * ux
            if t < -0.02 or t > 1.02:
                continue
            if t < 0.2:
                if abs(d) < 0.9:
                    grid[y][x] = GOLD if t > 0.05 else CREAM
                continue
            half = 3.6 * (math.sin(math.pi * min(1, (t - 0.15) / 0.85)) ** 0.7)
            if abs(d) < 0.55:
                grid[y][x] = CREAM
            elif abs(d) <= half:
                grid[y][x] = RUBRIC_LT if d < 0 else RUBRIC
                if abs(d) > half - 0.9 and d > 0:
                    grid[y][x] = RUBRIC_DK
    for x, y in ((1, 14), (2, 14), (1, 13)):
        grid[y][x] = DROP
    grid[14][0] = DROP
    return grid


def icon(size, fraction=0.66):
    g = quill()
    cell = max(1, int(size * fraction) // N)
    out = Image.new("RGBA", (size, size), INK)
    ox = oy = (size - N * cell) // 2
    for y in range(N):
        for x in range(N):
            if g[y][x]:
                out.paste(Image.new("RGBA", (cell, cell), g[y][x]), (ox + x * cell, oy + y * cell))
    return out


if __name__ == "__main__":
    d = ROOT / "app/skipture/static/icons"
    d.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("icon-maskable-512.png", 512)):
        icon(size).save(d / name)
    print("icons written")
