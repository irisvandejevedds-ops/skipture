"""Builds the static part of the site into site/dist: the app from web/, plus the headers Cloudflare serves it with. (The rooms behind /api are the Worker in worker/.)
    python site/build.py"""
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST, WEB = ROOT / "site/dist", ROOT / "web"
FILES = ["index.html", "app.css", "core.js", "lib.js", "store.js", "ops.js", "api.js", "demo.js", "editor.js", "app.js", "manifest.webmanifest", "library-format.md", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]
CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / "fonts").mkdir(parents=True)
    for f in FILES:
        shutil.copyfile(WEB / f, DIST / f)
    shutil.copyfile(WEB / "fonts/pixel-console.woff2", DIST / "fonts/pixel-console.woff2")
    (DIST / "_headers").write_text(f"/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: {CSP}\n")
    print("site built:", DIST)
    for p in sorted(DIST.rglob("*")):
        if p.is_file():
            print(f"  {str(p.relative_to(DIST)):32s}{p.stat().st_size / 1024:6.0f} KB")


if __name__ == "__main__":
    main()
