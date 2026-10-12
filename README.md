# Skipture
Sprite and texture library manager with a single-pixel pixel-art editor and humanization tracking.

- **Browser app** (`web/`): the whole thing runs in the visitor's browser and keeps libraries in IndexedDB on their device. Plain JavaScript, no build step. Deployed to skipture.jessevriend.com by `site/` (a push to `main` runs the tests and deploys).
- **Private server version** (`app/`): FastAPI + SQLite, for the author's own tailnet. `deploy/` has its notes.

Both read and write the same library zip format (`schema.json` + `sprites/<slot>.png`). `web/core.js` (the editor's pixel logic) is the same file as `app/skipture/static/core.js`; a test checks that.

Tests:
- `cd app && python -m pytest && node --test tests/core.test.js`
- `cd web && node --test tests/` (the zip and PNG files the browser writes are also checked by the server's own Python reader)
- `python web/tests/browser_check.py OUT_DIR [WIDTH]` drives the real app in headless Firefox.
