import pathlib
from urllib.parse import quote, urlparse

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware

from . import auth, clock, libs, png
from .config import get_config
from .db import DB, open_db

HERE = pathlib.Path(__file__).parent
templates = Jinja2Templates(directory=str(HERE / "templates"))
NAV = [("Libraries", "/"), ("Import", "/import")]
PUBLIC_PREFIXES = ("/static/", "/healthz", "/login", "/setup", "/manifest.webmanifest")
STATE_WORDS = {"empty": "waiting for art", "raw": "as received", "touched": "redrawn", "humanized": "humanized"}
TILE = 96


class NeedLogin(Exception):
    pass


class NeedSetup(Exception):
    pass


def safe_next(n):
    return n if n and n.startswith("/") and not n.startswith("//") else "/"


def thumb_scale(w, h, box=TILE):
    return max(1, box // max(w, h))


templates.env.globals["thumb_scale"] = thumb_scale
templates.env.globals["state_words"] = STATE_WORDS


def create_app():
    cfg = get_config()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.mount("/static", StaticFiles(directory=str(HERE / "static")), name="static")
    open_db(cfg.db_path).close()

    def get_db():
        d = DB(cfg.db_path)
        try:
            yield d
        finally:
            d.close()

    def session(request: Request, db: DB = Depends(get_db)):
        if not auth.has_passphrase(db):
            raise NeedSetup()
        s = auth.lookup_session(db, request.cookies.get(auth.COOKIE))
        if not s:
            raise NeedLogin()
        return s

    @app.exception_handler(NeedLogin)
    async def _need_login(request, exc):
        if request.url.path.endswith("/save"):
            return JSONResponse({"error": "login required"}, status_code=401)
        nxt = request.url.path + (("?" + request.url.query) if request.url.query else "")
        return RedirectResponse("/login?next=" + quote(nxt, safe="/?=&"), status_code=303)

    @app.exception_handler(NeedSetup)
    async def _need_setup(request, exc):
        return RedirectResponse("/setup", 303)

    @app.middleware("http")
    async def guard(request: Request, call_next):
        path = request.url.path
        if path != "/healthz" and cfg.require_ts_header:
            who = request.headers.get("tailscale-user-login", "").lower()
            if who not in cfg.ts_logins:
                return PlainTextResponse("This app is only available on your tailnet.", status_code=403)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            site = request.headers.get("sec-fetch-site")
            origin = request.headers.get("origin")
            if site and site not in ("same-origin", "none"):
                return PlainTextResponse("Cross-site request blocked.", status_code=403)
            if origin and site not in ("same-origin", "none") and urlparse(origin).netloc != request.headers.get("host", ""):
                return PlainTextResponse("Cross-site request blocked.", status_code=403)
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
                                "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if not path.startswith("/static/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    def render(request, name, **kw):
        return templates.TemplateResponse(request, name, {"request": request, "nav": NAV, "path": request.url.path, **kw})

    @app.exception_handler(StarletteHTTPException)
    async def _friendly_errors(request, exc):
        if request.url.path.endswith("/save") or request.url.path.startswith("/static/") or request.method == "HEAD":
            return JSONResponse({"error": exc.detail}, status_code=exc.status_code)
        msg = exc.detail if isinstance(exc.detail, str) else "Something went wrong."
        return templates.TemplateResponse(request, "error.html", {"request": request, "nav": NAV, "path": "", "title": {404: "Nothing here"}.get(exc.status_code, "Hold on"),
                                                                  "message": msg, "back": request.headers.get("referer") and urlparse(request.headers["referer"]).path or "/"},
                                          status_code=exc.status_code)

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    # ---------------- gate ----------------
    @app.get("/setup", response_class=HTMLResponse)
    def setup_page(request: Request, db: DB = Depends(get_db)):
        if auth.has_passphrase(db):
            return RedirectResponse("/login", 303)
        return render(request, "login.html", mode="setup", error=None, next="/", bare=True)

    @app.post("/setup")
    def setup_submit(request: Request, passphrase: str = Form(...), confirm: str = Form(...), db: DB = Depends(get_db)):
        if auth.has_passphrase(db):
            return RedirectResponse("/login", 303)
        if len(passphrase) < auth.MIN_PASSPHRASE or passphrase != confirm:
            return render(request, "login.html", mode="setup", next="/", bare=True, error=f"Use at least {auth.MIN_PASSPHRASE} characters, typed the same twice.")
        auth.set_passphrase(db, passphrase)
        resp = RedirectResponse("/", 303)
        resp.set_cookie(auth.COOKIE, auth.create_session(db, request.headers.get("user-agent", "")), max_age=auth.SESSION_DAYS * 86400,
                        httponly=True, secure=cfg.cookie_secure, samesite="strict")
        return resp

    @app.get("/login", response_class=HTMLResponse)
    def login_page(request: Request, next: str = "/", db: DB = Depends(get_db)):
        if not auth.has_passphrase(db):
            return RedirectResponse("/setup", 303)
        return render(request, "login.html", mode="login", error=None, next=safe_next(next), bare=True)

    @app.post("/login")
    def login_submit(request: Request, passphrase: str = Form(...), next: str = Form("/"), db: DB = Depends(get_db)):
        if auth.locked():
            return render(request, "login.html", mode="login", next=safe_next(next), bare=True, error="Too many attempts. Wait ten minutes and try again.")
        if not auth.check_passphrase(db, passphrase):
            auth.record_fail()
            return render(request, "login.html", mode="login", next=safe_next(next), bare=True, error="That passphrase is not right.")
        auth.reset_fails()
        resp = RedirectResponse(safe_next(next), 303)
        resp.set_cookie(auth.COOKIE, auth.create_session(db, request.headers.get("user-agent", "")), max_age=auth.SESSION_DAYS * 86400,
                        httponly=True, secure=cfg.cookie_secure, samesite="strict")
        return resp

    @app.post("/logout")
    def logout(request: Request, db: DB = Depends(get_db)):
        auth.destroy_session(db, request.cookies.get(auth.COOKIE))
        resp = RedirectResponse("/login", 303)
        resp.delete_cookie(auth.COOKIE)
        return resp

    # ---------------- libraries ----------------
    def get_lib(db, lib_id):
        lib = db.one("SELECT * FROM libraries WHERE id=?", (lib_id,))
        if not lib:
            raise HTTPException(404, "No such library.")
        return lib

    def get_sprite(db, sid):
        s = db.one("SELECT id,library_id,slot,name,kind,width,height,tile,bg_mode,bg_color,category,notes,state,changed_px,origin,humanized_at,sort,updated_at FROM sprites WHERE id=?", (sid,))
        if not s:
            raise HTTPException(404, "No such sprite.")
        return s

    def fail(msg, code=400):
        raise HTTPException(code, msg)

    @app.get("/", response_class=HTMLResponse)
    def dashboard(request: Request, db: DB = Depends(get_db), _=Depends(session)):
        rows = []
        for lib in db.q("SELECT * FROM libraries ORDER BY app COLLATE NOCASE, name COLLATE NOCASE"):
            rows.append({"lib": lib, "p": libs.progress(db, lib["id"])})
        return render(request, "dashboard.html", rows=rows, all=libs.overall(db))

    @app.post("/library")
    async def library_create(request: Request, db: DB = Depends(get_db), _=Depends(session)):
        f = await request.form()
        try:
            lid = libs.create_library(db, f.get("name"), f.get("app"), f.get("description"))
        except libs.LibError as e:
            fail(str(e))
        return RedirectResponse(f"/library/{lid}", 303)

    @app.get("/library/{lib_id}", response_class=HTMLResponse)
    def library_page(lib_id: int, request: Request, show: str = "", db: DB = Depends(get_db), _=Depends(session)):
        lib = get_lib(db, lib_id)
        sql = "SELECT id,slot,name,kind,width,height,tile,bg_mode,state,changed_px,category,updated_at FROM sprites WHERE library_id=?"
        args = [lib_id]
        if show in libs.STATES:
            sql += " AND state=?"
            args.append(show)
        sprites = db.q(sql + " ORDER BY sort, id", args)
        exports = db.q("SELECT * FROM exports WHERE library_id=? ORDER BY id DESC LIMIT 6", (lib_id,))
        return render(request, "library.html", lib=lib, p=libs.progress(db, lib_id), sprites=sprites, show=show, exports=exports)

    @app.post("/library/{lib_id}/edit")
    async def library_edit(lib_id: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        get_lib(db, lib_id)
        f = await request.form()
        name = (f.get("name") or "").strip()[:80]
        if not name:
            fail("Give the library a name.")
        db.ex("UPDATE libraries SET name=?, app=?, description=?, updated_at=? WHERE id=?", (name, (f.get("app") or "").strip()[:60], (f.get("description") or "").strip()[:500], clock.iso(clock.now()), lib_id))
        return RedirectResponse(f"/library/{lib_id}", 303)

    @app.post("/library/{lib_id}/delete")
    async def library_delete(lib_id: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        lib = get_lib(db, lib_id)
        f = await request.form()
        if (f.get("confirm") or "").strip() != lib["slug"]:
            fail(f"To delete this library, type its id ({lib['slug']}) exactly.")
        db.ex("DELETE FROM libraries WHERE id=?", (lib_id,))
        return RedirectResponse("/", 303)

    @app.post("/library/{lib_id}/slot")
    async def slot_add(lib_id: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        get_lib(db, lib_id)
        f = await request.form()
        try:
            sid = libs.add_slot(db, lib_id, f.get("slot"), f.get("name"), f.get("width") or 0, f.get("height") or 0, f.get("kind") or "sprite", f.get("tile") == "1",
                                f.get("bg_mode") or "transparent", f.get("bg_color") or "#FFFFFF", f.get("category") or "", f.get("notes") or "")
        except (libs.LibError, ValueError) as e:
            fail(str(e) if isinstance(e, libs.LibError) else "Width and height must be whole numbers.")
        return RedirectResponse(f"/sprite/{sid}", 303)

    @app.get("/library/{lib_id}/schema.zip")
    def schema_zip(lib_id: int, db: DB = Depends(get_db), _=Depends(session)):
        get_lib(db, lib_id)
        data, name, _c = libs.export_zip(db, lib_id, "schema")
        return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.get("/library/{lib_id}/export.zip")
    def library_zip(lib_id: int, db: DB = Depends(get_db), _=Depends(session)):
        get_lib(db, lib_id)
        data, name, _c = libs.export_zip(db, lib_id, "library")
        return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.get("/import", response_class=HTMLResponse)
    def import_page(request: Request, db: DB = Depends(get_db), _=Depends(session)):
        return render(request, "import.html", report=None, error=None)

    @app.post("/import", response_class=HTMLResponse)
    async def import_submit(request: Request, file: UploadFile = File(...), db: DB = Depends(get_db), _=Depends(session)):
        data = await file.read(libs.MAX_ZIP_BYTES + 1)
        try:
            report = libs.import_zip(db, data)
        except (libs.LibError, png.BadPng) as e:
            return render(request, "import.html", report=None, error=str(e))
        return render(request, "import.html", report=report, error=None)

    # ---------------- sprites ----------------
    @app.get("/sprite/{sid}", response_class=HTMLResponse)
    def editor(sid: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        s = get_sprite(db, sid)
        lib = get_lib(db, s["library_id"])
        prev = db.one("SELECT id FROM sprites WHERE library_id=? AND (sort<? OR (sort=? AND id<?)) ORDER BY sort DESC, id DESC LIMIT 1", (lib["id"], s["sort"], s["sort"], s["id"]))
        nxt = db.one("SELECT id FROM sprites WHERE library_id=? AND (sort>? OR (sort=? AND id>?)) ORDER BY sort, id LIMIT 1", (lib["id"], s["sort"], s["sort"], s["id"]))
        todo = db.one("SELECT id FROM sprites WHERE library_id=? AND state IN ('raw','touched') AND id<>? ORDER BY CASE WHEN sort>? THEN 0 ELSE 1 END, sort, id LIMIT 1", (lib["id"], s["id"], s["sort"]))
        return render(request, "editor.html", s=s, lib=lib, prev=prev, next=nxt, todo=todo, p=libs.progress(db, lib["id"]))

    @app.get("/sprite/{sid}/png")
    def sprite_png(sid: int, which: str = "current", v: str = "", db: DB = Depends(get_db), _=Depends(session)):
        col = "original_png" if which == "original" else "png"
        r = db.one(f"SELECT {col} AS d FROM sprites WHERE id=?", (sid,))
        if not r:
            raise HTTPException(404, "No such sprite.")
        return Response(r["d"], media_type="image/png", headers={"Cache-Control": "private, max-age=31536000, immutable" if v else "no-store"})

    @app.post("/sprite/{sid}/save")
    async def sprite_save(sid: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        get_sprite(db, sid)
        body = await request.body()
        h = request.headers
        try:
            state = libs.save_art(db, sid, body, int(h.get("x-skipture-changed", "0") or 0), h.get("x-skipture-blank") == "1", h.get("x-skipture-edited", "1") == "1",
                                  h.get("x-skipture-bg"), h.get("x-skipture-bg-color"))
        except (libs.LibError, png.BadPng, ValueError) as e:
            raise HTTPException(400, str(e))
        s = get_sprite(db, sid)
        p = libs.progress(db, s["library_id"])
        return {"ok": True, "state": state, "state_word": STATE_WORDS[state], "changed_px": s["changed_px"], "pct": p["pct"], "humanized": p["humanized"], "total": p["total"]}

    @app.post("/sprite/{sid}/state")
    async def sprite_state(sid: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        get_sprite(db, sid)
        f = await request.form()
        try:
            libs.set_state(db, sid, f.get("action") or "")
        except libs.LibError as e:
            fail(str(e))
        back = f.get("back") or f"/sprite/{sid}"
        return RedirectResponse(back if back.startswith("/") and not back.startswith("//") else f"/sprite/{sid}", 303)

    @app.post("/sprite/{sid}/meta")
    async def sprite_meta(sid: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        s = get_sprite(db, sid)
        f = await request.form()
        name = (f.get("name") or "").strip()[:80] or s["name"]
        kind = f.get("kind") if f.get("kind") in libs.KINDS else s["kind"]
        db.ex("UPDATE sprites SET name=?, kind=?, tile=?, category=?, notes=?, updated_at=? WHERE id=?",
              (name, kind, 1 if f.get("tile") == "1" else 0, (f.get("category") or "").strip()[:40], (f.get("notes") or "").strip()[:500], clock.iso(clock.now()), sid))
        return RedirectResponse(f"/sprite/{sid}", 303)

    @app.post("/sprite/{sid}/delete")
    async def sprite_delete(sid: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        s = get_sprite(db, sid)
        f = await request.form()
        if f.get("confirm") != "1":
            fail("Tick the box to confirm removing this slot.")
        db.ex("DELETE FROM sprites WHERE id=?", (sid,))
        libs.touch_library(db, s["library_id"])
        return RedirectResponse(f"/library/{s['library_id']}", 303)

    @app.get("/sprite/{sid}/history", response_class=HTMLResponse)
    def history(sid: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        s = get_sprite(db, sid)
        revs = db.q("SELECT id,state,note,created_at FROM revisions WHERE sprite_id=? ORDER BY id DESC", (sid,))
        return render(request, "history.html", s=s, lib=get_lib(db, s["library_id"]), revs=revs)

    @app.get("/revision/{rid}/png")
    def revision_png(rid: int, db: DB = Depends(get_db), _=Depends(session)):
        r = db.one("SELECT png FROM revisions WHERE id=?", (rid,))
        if not r:
            raise HTTPException(404, "No such version.")
        return Response(r["png"], media_type="image/png", headers={"Cache-Control": "private, max-age=31536000, immutable"})

    @app.post("/sprite/{sid}/restore")
    async def restore(sid: int, request: Request, db: DB = Depends(get_db), _=Depends(session)):
        get_sprite(db, sid)
        f = await request.form()
        try:
            libs.restore_revision(db, sid, int(f.get("revision") or 0))
        except (libs.LibError, ValueError) as e:
            fail(str(e))
        return RedirectResponse(f"/sprite/{sid}", 303)

    @app.get("/manifest.webmanifest")
    def manifest():
        icon = [{"src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                {"src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                {"src": "/static/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]
        return JSONResponse({"name": "Skipture", "short_name": "Skipture", "description": "Sprite and texture libraries, redrawn by hand.", "id": "/", "start_url": "/", "scope": "/",
                             "display": "standalone", "background_color": "#1B1814", "theme_color": "#B4452B", "icons": icon})

    return app


def get_app():
    return create_app()
