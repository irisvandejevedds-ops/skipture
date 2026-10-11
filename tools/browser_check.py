"""Loads the real editor page in headless Firefox, drives it with synthetic pointer and key events, and screenshots the result with a pass/fail report on top.

    python tools/browser_check.py OUT_DIR [WIDTH]

Needs firefox. Uses the app's own test client, so nothing touches the live database."""
import base64
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))
sys.path.insert(0, str(ROOT / "app" / "tests"))
from fastapi.testclient import TestClient  # noqa: E402
from skipture import libs, png  # noqa: E402
from skipture.config import Config, set_config  # noqa: E402
from skipture.db import DB  # noqa: E402
from skipture.main import create_app  # noqa: E402

TEST_JS = r"""
(function () {
  var out = [], root = document.getElementById('editor');
  function say(ok, msg) { out.push((ok ? 'PASS ' : 'FAIL ') + msg); show(); }
  function show() { var p = document.getElementById('report'); if (p) p.textContent = out.join('\n'); }
  window.__saves = [];
  window.fetch = function (url, opts) {
    var b = opts.body;
    window.__saves.push({ url: url, type: b && b.type, size: b && b.size, headers: opts.headers });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ state: 'touched', state_word: 'redrawn', humanized: 0, total: 3, pct: 0 }); } });
  };
  function at(el, x, y, W, H) { var r = el.getBoundingClientRect(); return { clientX: r.left + (x + .5) * r.width / W, clientY: r.top + (y + .5) * r.height / H }; }
  function ptr(el, type, x, y, W, H) { var c = at(el, x, y, W, H); el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: c.clientX, clientY: c.clientY })); }
  function waitReady(n) {
    if (root.dataset.ready === '1') return go();
    if (n > 100) { say(false, 'editor never became ready'); return show(); }
    setTimeout(function () { waitReady(n + 1); }, 50);
  }
  function go() {
    try {
      var S = window.__skipture, d = S.doc, C = window.SkipCore, cv = document.getElementById('cv'), W = +root.dataset.w, H = +root.dataset.h;
      say(d.w === W && d.h === H, 'loaded ' + W + 'x' + H);
      say(cv.getBoundingClientRect().width >= W * 2, 'canvas is zoomed up (' + Math.round(cv.getBoundingClientRect().width) + 'px wide)');
      var base = d.colors().length;
      S.setColor(C.hexToColor('#3A7BD5'));
      ptr(cv, 'pointerdown', 3, 3, W, H); ptr(cv, 'pointermove', 9, 3, W, H); ptr(cv, 'pointerup', 9, 3, W, H);
      var run = true; for (var x = 3; x <= 9; x++) if (d.get(x, 3) !== C.hexToColor('#3A7BD5')) run = false;
      say(run, 'pen drag painted an unbroken run of single pixels');
      say(d.get(3, 4) === 0 && d.get(12, 3) === 0, 'pen painted only the pixels dragged over');
      S.setTool('erase'); ptr(cv, 'pointerdown', 5, 3, W, H); ptr(cv, 'pointerup', 5, 3, W, H);
      say(d.get(5, 3) === 0 && d.get(4, 3) !== 0, 'eraser cleared one pixel to transparent');
      S.setTool('fill'); S.setColor(C.hexToColor('#C8402A')); ptr(cv, 'pointerdown', 0, 0, W, H);
      say(d.get(0, 0) === C.hexToColor('#C8402A') && d.get(W - 1, H - 1) === C.hexToColor('#C8402A'), 'fill flooded the open area');
      say(d.get(4, 3) === C.hexToColor('#3A7BD5'), 'fill stopped at other colours');
      document.getElementById('undo').click();
      say(d.get(0, 0) === 0, 'undo button reverted the fill');
      document.getElementById('redo').click();
      say(d.get(0, 0) === C.hexToColor('#C8402A'), 'redo button re-applied it');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      say(d.get(0, 0) === 0, 'Ctrl+Z undoes');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
      say(d.get(0, 0) === C.hexToColor('#C8402A'), 'Ctrl+Shift+Z redoes');
      var before = Array.prototype.slice.call(d.px);
      S.setBg('opaque');
      var anyClear = false; for (var i = 0; i < d.px.length; i++) if (C.alpha(d.px[i]) === 0) anyClear = true;
      say(!anyClear, 'switching to opaque filled every transparent pixel');
      document.getElementById('undo').click();
      say(Array.prototype.every.call(d.px, function (v, k) { return v === before[k]; }), 'undo took the opaque switch back, pixels and all');
      say(document.querySelector('input[name=bg][value=transparent]').checked, 'and the background control went back to transparent');
      // colour wheel: press on the ring at the angle for green (120 degrees)
      var wheel = document.getElementById('wheel'), wr = wheel.getBoundingClientRect(), k = wr.width / 208, R = 104 - 4, RI = R - 24, rm = (R + RI) / 2, a = 120 * Math.PI / 180;
      wheel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 2, clientX: wr.left + (104 + Math.cos(a) * rm) * k, clientY: wr.top + (104 + Math.sin(a) * rm) * k }));
      wheel.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
      var hex = document.getElementById('hex').value, cc = C.hexToColor(hex);
      say(C.green(cc) > C.red(cc) + 40 && C.green(cc) > C.blue(cc) + 40, 'colour wheel ring picked a green hue (' + hex + ')');
      document.getElementById('hex').value = '#112233'; document.getElementById('hex').dispatchEvent(new Event('change'));
      say(document.getElementById('cur').style.background !== '', 'hex field sets the colour');
      say(!document.getElementById('save').disabled, 'Save is enabled once there are edits');
      document.getElementById('save').click();
      setTimeout(function () {
        var sv = window.__saves[0];
        say(!!sv && sv.type === 'image/png' && sv.size > 50, 'Save posted a PNG (' + (sv && sv.size) + ' bytes)');
        say(!!sv && +sv.headers['X-Skipture-Changed'] > 0 && sv.headers['X-Skipture-Edited'] === '1' && sv.headers['X-Skipture-Blank'] === '0', 'Save reported changed pixels, edited, not blank');
        say(!window.__skipture.doc.isEdited(), 'after saving, nothing is unsaved');
        say(document.getElementById('statechip').textContent === 'redrawn', 'state chip updated to redrawn');
        show();
      }, 400);
    } catch (e) { say(false, 'exception: ' + e + ' ' + (e.stack || '').split('\n')[0]); show(); }
  }
  waitReady(0);
})();
"""


def main():
    out = pathlib.Path(sys.argv[1]).resolve()
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 1200
    out.mkdir(parents=True, exist_ok=True)
    tmp = pathlib.Path(tempfile.mkdtemp())
    set_config(Config({"SKIPTURE_DATA_DIR": str(tmp), "SKIPTURE_REQUIRE_TS_HEADER": "0", "SKIPTURE_COOKIE_SECURE": "0"}))
    cl = TestClient(create_app(), follow_redirects=False)
    cl.post("/setup", data={"passphrase": "correct horse battery", "confirm": "correct horse battery"})
    px = bytearray()
    for y in range(16):
        for x in range(16):
            ring = (x - 7.5) ** 2 + (y - 7.5) ** 2
            px += bytes((230, 120, 60, 255)) if ring < 30 else bytes((0, 0, 0, 0))
    art = png.encode_rgba(16, 16, bytes(px))
    db = DB(tmp / "skipture.db")
    lid = libs.create_library(db, "Check", "Test")
    libs.add_slot(db, lid, "a", "Round thing", 16, 16, art=art, origin="app", notes="a test sprite")
    sid = libs.add_slot(db, lid, "b", "Second", 16, 16, kind="texture", tile=True, art=art, origin="app")
    db.close()
    html = cl.get("/sprite/1").text
    uri = "data:image/png;base64," + base64.b64encode(art).decode()
    html = re.sub(r'data-png="[^"]*"', f'data-png="{uri}"', html)
    html = re.sub(r'data-original="[^"]*"', f'data-original="{uri}"', html)
    static = ROOT / "app/skipture/static"
    html = html.replace("</main>", '<pre id="report" style="position:fixed;top:0;left:0;right:0;z-index:99;margin:0;padding:10px;background:#000d;color:#fff;font:14px/1.35 monospace;white-space:pre-wrap"></pre></main>')
    html = html.replace("</head>", '</head>').replace("<body>", '<body><img src="/wait" width="1" height="1" alt="" style="position:absolute">')
    html = re.sub(r'<script src="/static/editor\.js[^"]*"></script>', lambda m: f"<script>{TEST_JS}</script>" + m.group(0), html)
    page = out / "editor_check.html"
    page.write_text(html)
    import http.server
    import threading
    import time

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/wait":
                time.sleep(2.5)
                body, ctype = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), "image/gif"
            elif path == "/editor_check.html":
                body, ctype = page.read_bytes(), "text/html"
            elif path.startswith("/static/") and ".." not in path:
                f = static / path[8:]
                body, ctype = (f.read_bytes(), {"js": "text/javascript", "css": "text/css", "woff2": "font/woff2", "png": "image/png"}.get(f.suffix[1:], "application/octet-stream")) if f.is_file() else (b"", "text/plain")
            else:
                body, ctype = b"", "text/plain"
            self.send_response(200 if body else 404)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}/editor_check.html"
    shot = out / f"editor_check_{width}.png"
    prof = tmp / "profile"
    prof.mkdir()
    r = subprocess.run(["firefox", "--no-remote", "--profile", str(prof), "--headless", f"--window-size={width},1700", "--screenshot", str(shot), url],
                       capture_output=True, text=True, timeout=120, env={"MOZ_HEADLESS": "1", "PATH": "/usr/bin:/bin", "HOME": str(tmp)})
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(shot if shot.exists() else r.stderr[-800:])


if __name__ == "__main__":
    main()
