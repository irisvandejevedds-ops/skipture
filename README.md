# Skipture
Sprite and texture library manager with a single-pixel pixel-art editor and humanization tracking.

- **The shared site** (`web/` + `worker/`, deployed to skipture.jessevriend.com by `site/`): people enter a *room* with a key. A key alone makes a **guest** (look around, bring art in, draw on slots nobody has taken over). The key plus a passphrase makes the **artist** (redraw anything, sign off as humanized, export, bulk edit and delete). A new key with a new passphrase makes a new room; the key `DEMO` opens a throwaway demo room in the browser. Each room is its own Durable Object with its own SQLite database. The passphrase is hashed in the browser (PBKDF2) and only a hash of that hash is stored. A push to `main` runs the tests and deploys.
- **Private server version** (`app/`): FastAPI + SQLite for the author's own tailnet. `deploy/` has its notes.

`web/lib.js` (rules, zip and PNG files) and `web/ops.js` (who may do what) run in the Worker against SQLite and in the demo against memory. Library zips (`schema.json` + `sprites/<slot>.png`) are the same format in both versions. `web/core.js` is the same file as `app/skipture/static/core.js`; a test checks that.

Tests (Node 22 for the SQLite ones):
- `cd app && python -m pytest && node --test tests/core.test.js`
- `cd web && node --test tests/*.test.js` and `cd worker && node --test tests/worker.test.js`
- With the Worker running (`wrangler dev --config site/wrangler.jsonc --port 8788`): `cd worker && SKIPTURE_URL=http://localhost:8788 node --test tests/e2e.test.js` and `python web/tests/browser_check.py OUT_DIR [WIDTH]` (drives the real pages in headless Firefox, demo room and a real room).
