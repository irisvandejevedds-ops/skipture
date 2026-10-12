"""Drives the real app in headless Firefox and screenshots it with a pass/fail report on top.

    python browser_check.py OUT_DIR [WIDTH] [shot]

With no third argument it runs the whole test: the demo room first, then (if a local Worker answers at $SKIPTURE_API, default http://127.0.0.1:8788, e.g. `wrangler dev`)
a real room with an artist, a guest and the rules between them. With a third argument ("demo", "gate", "dash", "libraries", "import", "editor") it just takes a picture of that page.
Serves ../ over local http and passes /api/* through to the Worker; nothing leaves the machine."""
import http.client
import http.server
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

WEB = pathlib.Path(__file__).resolve().parents[1]
API = urllib.parse.urlparse(os.environ.get("SKIPTURE_API", "http://127.0.0.1:8788"))
TYPES = {".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".html": "text/html", ".webmanifest": "application/manifest+json"}

COMMON = r"""
  var out = [];
  function say(ok, msg) { out.push((ok ? 'PASS ' : 'FAIL ') + msg); var p = document.getElementById('report'); if (p) p.textContent = out.join('\n'); }
  function $(s, r) { return (r || document).querySelector(s); } function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function until(fn, what, n) { for (var i = 0; i < (n || 160); i++) { var v = await fn(); if (v) return v; await sleep(50); } say(false, 'timed out waiting for ' + what); throw new Error(what); }
  function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
  function submit(f) { f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
  function setv(sel, v) { var e = $(sel); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }
  function ptr(el, type, x, y, W, H) { var r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: r.left + (x + .5) * r.width / W, clientY: r.top + (y + .5) * r.height / H })); }
  window.confirm = function () { return true; };
  var L = window.SkipLib, C = window.SkipCore, made = [];
  var mk = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) { if (b && (b.type === 'application/zip' || b.type === 'application/json')) made.push(b); return mk(b); };
  async function waitText(re, what) { return until(function () { return re.test($('#main').textContent); }, what); }
  async function pill() { return ($('#who .pill') || {}).textContent; }
  async function enterRoom(key, pass) { await until(function () { return $('form[data-act=enter]'); }, 'the gate'); $('#flash').innerHTML = ''; setv('form[data-act=enter] [name=key]', key); setv('form[data-act=enter] [name=pass]', pass || ''); submit($('form[data-act=enter]')); }
  async function drawDot(x, y, W, H) { var cv = $('#cv'); ptr(cv, 'pointerdown', x, y, W, H); ptr(cv, 'pointerup', x, y, W, H); }
  async function editorReady() { await until(function () { return $('#editor') && $('#editor').dataset.ready === '1' && window.__skipture && window.__skipture.test; }, 'the editor'); return window.__skipture; }
"""

DEMO = r"""
  async function demo() {
    await enterRoom('DEMO');
    await until(function () { return $('.stats'); }, 'the dashboard');
    say(await pill() === 'Demo', 'DEMO opens the demo room, marked as such');
    var nums = $$('.bignum').map(function (b) { return b.textContent.replace(/\s+/g, ' '); });
    say(/13 of 15/.test(nums[0]) && /5 of 15 . 33%/.test(nums[1]), 'dashboard counts submitted (' + nums[0] + ') and humanized (' + nums[1] + ')');
    say($$('.libcard').length === 3, 'three libraries, each with progress');
    await until(function () { return $$('.libcard img').every(function (i) { return i.complete && i.naturalWidth > 1; }); }, 'thumbnails');
    say($$('.libcard img').length === 3, 'each library shows a representative sprite');
    say($$('#topnav a').map(function (a) { return a.textContent; }).join() === 'Dashboard,Import,Libraries', 'the artist menu has Dashboard, Import and Libraries');

    click($$('.libcard').filter(function (a) { return /Pocket Frogs/.test(a.textContent); })[0]);
    await until(function () { return $$('.tile').length === 6; }, 'the library');
    say(true, 'a library lists its six sprites');
    click($$('.tile').filter(function (t) { return /Frog$/.test($('.name', t).textContent) && /waiting/.test(t.textContent); })[0]);
    var ed = await editorReady(), d = ed.test.doc, W = d.w, H = d.h;
    say(W === 16 && H === 16, 'the pixel editor opened on the sprite');
    // the colour pop-out
    say($('#colpop').hidden && !!$('#colbtn') && $('#colbtn').previousElementSibling.dataset.tool === 'pen', 'the colour button sits beside the pen, with the wheel tucked away');
    click($('#colbtn'));
    say(!$('#colpop').hidden && $('#colpop').contains($('#wheel')) && $('#colpop').getBoundingClientRect().width > 150, 'the button pops the colour wheel out');
    setv('#hex', '#E040A0'); $('#hex').dispatchEvent(new Event('change', { bubbles: true }));
    say($('#colsw').style.background.replace(/\s/g, '') === 'rgb(224,64,160)', 'the button shows the chosen colour');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    say($('#colpop').hidden, 'tapping elsewhere closes the pop-out');

    // two fingers: pinch to zoom, and no drawing between them
    var cv0 = $('#cv'), w0 = cv0.getBoundingClientRect().width, r0 = cv0.getBoundingClientRect();
    function tp(type, id, x, y) { cv0.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 11, button: 0, clientX: x, clientY: y })); }
    var cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 3;
    ed.test.setColor(C.hexToColor('#1A9C98'));
    tp('pointerdown', 11, cx - 20, cy); tp('pointerdown', 12, cx + 20, cy);
    for (var k = 1; k <= 6; k++) { tp('pointermove', 11, cx - 20 - k * 8, cy); tp('pointermove', 12, cx + 20 + k * 8, cy); }
    tp('pointerup', 12, cx + 68, cy); tp('pointerup', 11, cx - 68, cy);
    say(d.colors().length === 0 && !ed.test.doc.canUndo(), 'a two-finger gesture draws nothing, not even a line between the fingers');
    say(cv0.getBoundingClientRect().width > w0 * 1.5 || cv0.getBoundingClientRect().width >= 32 * 16 - 1, 'spreading two fingers zoomed the canvas in (' + Math.round(w0) + 'px to ' + Math.round(cv0.getBoundingClientRect().width) + 'px)');
    // a first finger that had begun a stroke is taken back when the second lands
    var r1 = cv0.getBoundingClientRect(), sx = r1.left + 40, sy = r1.top + 40;
    tp('pointerdown', 21, sx, sy); tp('pointermove', 21, sx + 30, sy); tp('pointerdown', 22, sx + 60, sy + 60);
    say(d.colors().length === 0, 'a stroke begun by the first finger is taken back when a second finger lands');
    tp('pointerup', 22, sx + 60, sy + 60); tp('pointerup', 21, sx + 30, sy);
    say(d.colors().length === 0 && !ed.test.doc.canUndo(), 'and lifting the fingers afterwards draws nothing either');
    // one finger still draws
    var r2 = cv0.getBoundingClientRect(), px0 = r2.left + (3.5 / W) * r2.width, py0 = r2.top + (3.5 / H) * r2.height;
    tp('pointerdown', 31, px0, py0); tp('pointermove', 31, px0 + (r2.width / W) * 3, py0); tp('pointerup', 31, px0 + (r2.width / W) * 3, py0);
    say(d.colors().length === 1 && d.get(3, 3) !== 0 && d.get(6, 3) !== 0, 'one finger still draws');
    click($('#undo'));
    ed.test.setColor(C.hexToColor('#1A9C98'));
    for (var x = 2; x < 8; x++) await drawDot(x, 5, W, H);
    click($('#save'));
    await until(function () { return /Saved\./.test($('#status').textContent); }, 'the save');
    say($('#statechip').textContent === 'redrawn', 'the artist\'s drawing on an empty slot is saved as redrawn');
    click($('[data-do=state][data-action=humanize]'));
    await until(function () { return $('[data-do=state][data-action=unhumanize]'); }, 'sign-off');
    say(true, 'the artist signs a sprite off as humanized');

    location.hash = '#/';
    await until(function () { return $('.stats'); }, 'the dashboard again');
    var n2 = $$('.bignum').map(function (b) { return b.textContent.replace(/\s+/g, ' '); });
    say(/14 of 15/.test(n2[0]) && /6 of 15/.test(n2[1]), 'the dashboard now says ' + n2[0] + ' / ' + n2[1]);

    location.hash = '#/libraries';
    await until(function () { return $('.libmgr'); }, 'the libraries page');
    $$('details').forEach(function (d2) { d2.open = true; });
    var boxes = $$('.selspr').slice(0, 2); boxes.forEach(function (b) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
    say(/2 sprites, 0 libraries selected/.test($('#bulkcount').textContent), 'ticking sprites updates the selection count');
    setv('form[data-act=bulk-sprites] [name=category]', 'creatures'); submit($('form[data-act=bulk-sprites]'));
    await until(function () { return $$('table.sprites td').some(function (t) { return t.textContent === 'creatures'; }); }, 'the bulk edit');
    say($$('table.sprites td').filter(function (t) { return t.textContent === 'creatures'; }).length === 2, 'a bulk edit changed only the two ticked sprites');
    var before = $$('.selspr').length;
    $$('.selspr').slice(0, 1).forEach(function (b) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
    click($('[data-do=bulk-del-sprites]'));
    await until(function () { return $$('.selspr').length === before - 1; }, 'the bulk delete');
    say(true, 'bulk delete removed the ticked sprite');
    $$('details').forEach(function (d2) { d2.open = true; });
    var lb = $$('.sellib')[2]; lb.checked = true; lb.dispatchEvent(new Event('change', { bubbles: true }));
    setv('form[data-act=bulk-libs] [name=app]', 'Renamed app'); submit($('form[data-act=bulk-libs]'));
    await until(function () { return $$('.libmgr .pill').some(function (p) { return p.textContent === 'Renamed app'; }); }, 'the library edit');
    say(true, 'a bulk edit changed a library\'s app');
    click($('[data-do=export][data-purpose=library]'));
    await until(function () { return made.some(function (b) { return b.type === 'application/zip'; }); }, 'the export');
    say(true, 'a library can be exported as a zip');

    location.hash = '#/import';
    await until(function () { return $('#drop'); }, 'the import page');
    say(!!$('[data-do=template]') && !!$('form[data-act=newlib]') && !!$('#zipfile'), 'import has the dropbox, the blank schema and the manual builder');
    click($('[data-do=template]'));
    await until(function () { return made.some(function (b) { return b.type === 'application/json'; }); }, 'the template');
    var tpl = JSON.parse(await made.filter(function (b) { return b.type === 'application/json'; })[0].text());
    say(tpl.format === 'skipture-library' && tpl.sprites.length === 2, 'the blank schema downloads as valid JSON');
    var file = new File([JSON.stringify(tpl)], 'blank-schema.json', { type: 'application/json' }), dt = new DataTransfer(); dt.items.add(file);
    $('#zipfile').files = dt.files; $('#zipfile').dispatchEvent(new Event('change'));
    await waitText(/Created My library/, 'the schema import');
    say(/2<\/strong> sprites taken in/.test($('#main').innerHTML), 'a schema.json alone makes a library with its slots');
    location.hash = '#/import';
    await until(function () { return $('form[data-act=newlib]'); }, 'import again');
    setv('form[data-act=newlib] [name=name]', 'By hand'); submit($('form[data-act=newlib]'));
    await until(function () { return /By hand/.test(($('h1') || {}).textContent || ''); }, 'the manual library');
    say(true, 'a library can be built by hand');

    click($('[data-do=leave]'));
    await until(function () { return $('form[data-act=enter]'); }, 'the gate after leaving');
    say(document.body.classList.contains('gate') && !$('#topnav a'), 'leaving returns to the gate and hides the menu');
  }
"""

ROOM = r"""
  async function room() {
    var key = 'room-' + Math.random().toString(36).slice(2, 10), pass = 'violet harbour 42';
    // no such room: a key alone is refused, key plus passphrase offers to make it
    await enterRoom(key);
    await until(function () { return $('.flash .error'); }, 'the refusal');
    say(/No room has that key/.test($('.flash').textContent), 'an unknown key alone says no room has it');
    await enterRoom(key, pass);
    await until(function () { return $('form[data-act=create]'); }, 'the make-a-room question');
    say(new RegExp(key).test($('#main').textContent), 'an unknown key with a passphrase asks before making a room');
    setv('form[data-act=create] [name=again]', 'something else'); submit($('form[data-act=create]'));
    await until(function () { return /not the same/.test($('.flash').textContent); }, 'the mismatch');
    say(true, 'retyping a different passphrase is refused');
    setv('form[data-act=create] [name=again]', pass); submit($('form[data-act=create]'));
    await until(function () { return $('.stats'); }, 'the new room', 200);
    say(await pill() === 'Artist', 'confirming makes the room, and its maker is the artist');

    location.hash = '#/import';
    await until(function () { return $('form[data-act=newlib]'); }, 'import');
    setv('form[data-act=newlib] [name=name]', 'Frogs'); setv('form[data-act=newlib] [name=app]', 'Tadpole'); submit($('form[data-act=newlib]'));
    await until(function () { return /Frogs/.test(($('h1') || {}).textContent || ''); }, 'the library');
    var f = $('form[data-act=addslot]'); f.querySelector('[name=slot]').value = 'frog'; f.querySelector('[name=width]').value = '8'; f.querySelector('[name=height]').value = '8'; submit(f);
    var ed = await editorReady();
    say(/waiting for art/.test($('#statechip').textContent), 'a slot made in the room starts waiting for art');
    var spriteHash = location.hash;
    click($('[data-do=leave]'));

    // a guest
    await enterRoom(key);
    await until(function () { return $('.stats'); }, 'the guest dashboard');
    say(await pill() === 'Guest', 'the key alone opens the room as a guest');
    say($$('#topnav a').map(function (a) { return a.textContent; }).join() === 'Dashboard,Import', 'a guest has no Libraries page in the menu');
    location.hash = '#/libraries';
    await waitText(/Only the artist can manage libraries/, 'the guest refusal');
    say(true, 'a guest who goes to the libraries page is turned away');
    location.hash = spriteHash;
    ed = await editorReady();
    say(!$('[data-do=state]') && !$('form[data-act=meta]'), 'a guest sees no sign-off or details controls');
    var W = ed.test.doc.w, H = ed.test.doc.h;
    ed.test.setColor(C.hexToColor('#B4452B'));
    for (var x = 1; x < 6; x++) await drawDot(x, 2, W, H);
    click($('#save'));
    await until(function () { return /Saved\./.test($('#status').textContent); }, 'the guest save');
    say($('#statechip').textContent === 'as received', 'a guest\'s drawing is saved as received');
    location.hash = '#/';
    await until(function () { return $('.stats'); }, 'guest dashboard');
    say(/1 of 1/.test($$('.bignum')[0].textContent), 'the dashboard counts it as submitted');
    click($('[data-do=leave]'));

    // a wrong passphrase, then the artist signs it off
    await enterRoom(key, 'not the passphrase');
    await until(function () { return $('.flash .error'); }, 'the wrong passphrase');
    say(/not right for this room/.test($('.flash').textContent), 'a wrong passphrase is refused');
    await enterRoom(key, pass);
    await until(function () { return $('.stats'); }, 'the artist dashboard', 200);
    say(await pill() === 'Artist', 'key plus passphrase opens the room as the artist');
    location.hash = spriteHash;
    ed = await editorReady();
    click($('[data-do=state][data-action=humanize]'));
    await until(function () { return $('[data-do=state][data-action=unhumanize]'); }, 'sign-off');
    say(true, 'the artist signs the guest\'s sprite off');
    click($('[data-do=leave]'));

    // the guest can no longer change it
    await enterRoom(key);
    await until(function () { return $('.stats'); }, 'guest again');
    location.hash = spriteHash;
    await until(function () { return $('#editor') && $('#editor').dataset.ready === '1'; }, 'the locked editor');
    say(!!$('.locked') && $('#save').disabled && $('[data-tool=pen]').disabled, 'a signed-off sprite is read-only for a guest');
    click($('[data-do=leave]'));

    // clean up: the artist deletes the room, and the key is free again
    await enterRoom(key, pass);
    await until(function () { return $('.stats'); }, 'artist to clean up', 200);
    location.hash = '#/libraries';
    await until(function () { return $('form[data-act=destroy]'); }, 'the room settings');
    setv('form[data-act=destroy] [name=confirm]', 'DELETE'); submit($('form[data-act=destroy]'));
    await until(function () { return $('form[data-act=enter]'); }, 'the gate after deleting');
    await enterRoom(key);
    await until(function () { return $('.flash .error'); }, 'no room any more');
    say(/No room has that key/.test($('.flash').textContent), 'a deleted room is gone');
  }
"""

TEST = "(function () {" + COMMON + DEMO + ROOM + r"""
  async function run() {
    try { await demo(); } catch (e) { say(false, 'demo stopped: ' + e.message); }
    var live = await fetch('/__live').then(function (r) { return r.text(); }).catch(function () { return 'no'; });
    if (live === 'yes') { try { await room(); } catch (e) { say(false, 'room stopped: ' + e.message); } } else say(true, 'no local Worker, so the real-room checks were skipped');
    say(true, 'done'); fetch('/__done');
  }
  run();
})();
"""

SHOT = "(function () {" + COMMON + r"""
  var want = location.search.slice(1);
  (async function () {
    try {
      if (want === 'gate') return;
      await enterRoom('DEMO');
      await until(function () { return $('.stats'); }, 'the dashboard');
      if (want === 'demo') return;
      if (want === 'libraries') location.hash = '#/libraries';
      else if (want === 'import') location.hash = '#/import';
      else if (want === 'library') click($('.libcard'));
      else if (want === 'editor' || want === 'colour') { click($('.libcard')); await until(function () { return $('.tile'); }, 'tiles'); click($('.tile')); await editorReady(); if (want === 'colour') click($('#colbtn')); }
      await sleep(600);
      if (want === 'libraries') $$('details').forEach(function (d) { d.open = true; });
    } catch (e) { document.title = 'FAILED ' + e.message; }
  })();
})();
"""


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 420
    shot_of = sys.argv[3] if len(sys.argv) > 3 else ""
    tmp = pathlib.Path(tempfile.mkdtemp())
    done = threading.Event()

    def live():
        try:
            c = http.client.HTTPConnection(API.hostname, API.port, timeout=3)
            c.request("POST", "/api/enter", body='{"key":"probe-nothing"}', headers={"Content-Type": "application/json"})
            return c.getresponse().status == 404
        except OSError:
            return False

    is_live = live()

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="text/plain", extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def proxy(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n) if n else None
            c = http.client.HTTPConnection(API.hostname, API.port, timeout=120)
            c.request(self.command, self.path, body=body, headers={k: v for k, v in self.headers.items() if k.lower() not in ("host", "content-length", "connection")})
            r = c.getresponse()
            data = r.read()
            self.send_response(r.status)
            for k, v in r.getheaders():
                if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_POST = proxy

        def do_GET(self):
            path = self.path.split("?")[0]
            if path.startswith("/api/"):
                return self.proxy()
            if path == "/wait":
                done.wait(150 if not shot_of else 4)
                return self.send(200, b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x01D\x00;", "image/gif")
            if path == "/__done":
                done.set()
                return self.send(200, b"ok")
            if path == "/__live":
                return self.send(200, b"yes" if is_live else b"no")
            if path == "/__test.js":
                return self.send(200, (SHOT if shot_of else TEST).encode(), "text/javascript")
            if path in ("/", "/index.html"):
                html = (WEB / "index.html").read_text().replace('<main class="wrap" id="main"></main>', '<main class="wrap" id="main"></main><img src="/wait" width="1" height="1" alt="" style="position:absolute">')
                if not shot_of:
                    html = html.replace('<main class="wrap"', '<pre id="report" style="position:fixed;top:0;left:0;right:0;z-index:99;margin:0;padding:6px 10px;background:#000d;color:#fff;font:11px/1.3 monospace;white-space:pre-wrap"></pre><main class="wrap"')
                html = html.replace("</body>", '<script src="__test.js"></script></body>')
                return self.send(200, html.encode(), "text/html")
            f = (WEB / path.lstrip("/")).resolve()
            ok = f.is_file() and WEB in f.parents and "tests" not in f.parts
            if ok:
                return self.send(200, f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream"))
            self.send(404, b"")

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    shot = out / f"skipture_{shot_of or 'tests'}_{width}.png"
    prof = tmp / "p"
    prof.mkdir()
    r = subprocess.run(["firefox", "--no-remote", "--profile", str(prof), "--headless", f"--window-size={width},1900", "--screenshot", str(shot), f"http://127.0.0.1:{srv.server_address[1]}/" + (f"?{shot_of}" if shot_of else "")],
                       capture_output=True, text=True, timeout=240, env={"MOZ_HEADLESS": "1", "PATH": "/usr/bin:/bin", "HOME": str(tmp)})
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(shot if shot.exists() else r.stderr[-600:])


if __name__ == "__main__":
    main()
