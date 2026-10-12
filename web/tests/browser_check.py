"""Loads the real app in headless Firefox, drives it (a sample library, the editor, signing off, bringing in a picture, exporting, importing, leaving with unsaved work),
and screenshots it with a pass/fail report on top.     python browser_check.py OUT_DIR [WIDTH]
Serves ../ over local http only; nothing leaves the machine."""
import http.server
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time

WEB = pathlib.Path(__file__).resolve().parents[1]
TYPES = {".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".html": "text/html", ".webmanifest": "application/manifest+json"}

TEST = r"""
(function () {
  var out = [];
  function say(ok, msg) { out.push((ok ? 'PASS ' : 'FAIL ') + msg); var p = document.getElementById('report'); if (p) p.textContent = out.join('\n'); }
  var L = window.SkipLib, C = window.SkipCore;
  function $(s) { return document.querySelector(s); } function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function until(fn, what) { for (var i = 0; i < 100; i++) { var v = await fn(); if (v) return v; await sleep(50); } say(false, 'timed out waiting for ' + what); throw new Error(what); }
  function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
  function submit(f) { f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
  function ptr(el, type, x, y, W, H) { var r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: r.left + (x + .5) * r.width / W, clientY: r.top + (y + .5) * r.height / H })); }
  var zips = [], mk = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) { if (b && b.type === 'application/zip') zips.push(b); return mk(b); };
  window.confirm = function () { return true; };

  async function run() {
    try {
      await until(function () { return window.__store && $('#main').children.length; }, 'the first page');
      var S = window.__store;
      say(S.persistent === true, 'libraries are kept in IndexedDB');
      say(/Nothing yet/.test($('#main').textContent), 'the empty dashboard invites you to start');

      click($('[data-do=sample]'));
      await until(function () { return $$('.tile').length === 3; }, 'the sample library');
      say(/Sample sprites/.test($('h1').textContent), 'the sample library opened with 3 slots');
      say($$('.tile img').every(function (i) { return i.complete && i.naturalWidth === 8; }), 'thumbnails show the stored PNGs');

      var bean = $$('.tile').filter(function (t) { return /Bean/.test(t.textContent); })[0];
      location.hash = bean.getAttribute('href').replace(/^.*#/, '#');
      await until(function () { return $('#editor') && $('#editor').dataset.ready === '1'; }, 'the editor');
      var ed = window.__skipture, d = ed.test.doc, cv = $('#cv'), W = d.w, H = d.h;
      say(W === 8 && H === 8 && cv.getBoundingClientRect().width >= 16, 'editor loaded 8x8 and is zoomed up');
      ed.test.setColor(C.hexToColor('#3A7BD5'));
      ptr(cv, 'pointerdown', 0, 0, W, H); ptr(cv, 'pointermove', 6, 0, W, H); ptr(cv, 'pointerup', 6, 0, W, H);
      var run = true; for (var x = 0; x <= 6; x++) if (d.get(x, 0) !== C.hexToColor('#3A7BD5')) run = false;
      say(run, 'pen drag painted an unbroken run');
      say(/Unsaved/.test($('#status').textContent) && !$('#save').disabled, 'Save lit up with the unsaved note');
      click($('#save'));
      await until(function () { return /Saved\./.test($('#status').dataset.msg || $('#status').textContent); }, 'the save');
      var rec = (await S.allSprites()).filter(function (s) { return s.slot === 'bean'; })[0];
      say(rec.state === 'touched' && rec.changedPx >= 7, 'saved: state is redrawn with ' + rec.changedPx + ' px changed');
      say((await S.revisions(rec.id)).length === 1, 'the picture it replaced went to history');
      say(!!$('#statechip') && $('#statechip').textContent === 'redrawn', 'the chip says redrawn');

      click($('[data-do=state][data-action=humanize]'));
      await until(function () { return $('[data-do=state][data-action=unhumanize]'); }, 'sign-off');
      say((await S.sprite(rec.id)).state === 'humanized', 'Mark humanized signed it off');

      // editing a humanized sprite and leaving without pressing Save still keeps the work, and drops the sign-off
      await until(function () { return window.__skipture && window.__skipture.test; }, 'editor again');
      ed = window.__skipture; d = ed.test.doc;
      ptr($('#cv'), 'pointerdown', 7, 7, W, H); ptr($('#cv'), 'pointerup', 7, 7, W, H);
      location.hash = '#/';
      await until(function () { return /Everything together/.test($('#main').textContent); }, 'the dashboard');
      rec = await S.sprite(rec.id);
      say(rec.state === 'touched' && rec.humanizedAt === null, 'leaving with unsaved work saved it, and editing dropped the sign-off');

      // bringing in a picture of the right and wrong size
      location.hash = '#/sprite/' + rec.id;
      await until(function () { return $('#editor') && $('#editor').dataset.ready === '1' && window.__skipture.test; }, 'editor for the picture');
      ed = window.__skipture; d = ed.test.doc;
      var px = new Uint8Array(8 * 8 * 4); for (var i = 0; i < 64; i++) { px[i * 4] = 10; px[i * 4 + 1] = 200; px[i * 4 + 2] = 30; px[i * 4 + 3] = 255; }
      var file = new File([await L.encodePng(8, 8, px)], 'bean.png', { type: 'image/png' }), dt = new DataTransfer(); dt.items.add(file);
      $('#bring').files = dt.files; $('#bring').dispatchEvent(new Event('change'));
      await until(function () { return /Picture brought in/.test($('#status').textContent); }, 'the picture');
      say(d.get(3, 3) === C.pack(10, 200, 30, 255), 'a picture of the right size filled the canvas');
      click($('#undo'));
      say(d.get(3, 3) !== C.pack(10, 200, 30, 255), 'bringing a picture in is one undo');
      var wrong = new File([await L.encodePng(4, 4, new Uint8Array(64).fill(255))], 'x.png', { type: 'image/png' }), dt2 = new DataTransfer(); dt2.items.add(wrong);
      $('#bring').files = dt2.files; $('#bring').dispatchEvent(new Event('change'));
      await until(function () { return /4.4, but this slot is 8.8/.test($('#status').textContent); }, 'the size complaint');
      say(true, 'a picture of the wrong size was refused in plain words');

      // a new library and a slot through the forms
      location.hash = '#/';
      await until(function () { return $('form[data-act=newlib]'); }, 'dashboard form');
      $('form[data-act=newlib] [name=name]').value = 'Test pack'; $('form[data-act=newlib] [name=app]').value = 'Demo';
      submit($('form[data-act=newlib]'));
      await until(function () { return /Test pack/.test($('h1').textContent); }, 'the new library');
      var f = $('form[data-act=addslot]'); f.querySelector('[name=slot]').value = 'hero'; f.querySelector('[name=width]').value = '16'; f.querySelector('[name=height]').value = '12';
      submit(f);
      await until(function () { return $('#editor') && $('#editor').dataset.ready === '1'; }, 'the new empty slot');
      say(/waiting for art/.test($('#statechip').textContent), 'a new slot starts waiting for art');
      location.hash = '#/library/' + (await S.libraries()).filter(function (l) { return l.name === 'Test pack'; })[0].id;
      await until(function () { return $('[data-do=export-schema]'); }, 'library page');

      // export, and the zip comes back in
      click($('[data-do=export-schema]'));
      await until(function () { return zips.length === 1; }, 'the schema download');
      var bytes = new Uint8Array(await zips[0].arrayBuffer()), M = new SkipStore.MemoryStore(), rep = await L.importZip(M, bytes);
      say(rep.created && rep.added.join() === 'hero' && rep.problems.length === 0, 'the exported schema imports cleanly elsewhere');

      // import through the page
      location.hash = '#/import';
      await until(function () { return $('#zipfile'); }, 'import page');
      var bundle = L.writeZip([{ name: 'schema.json', data: new TextEncoder().encode(JSON.stringify({ format: 'skipture-library', version: 1, library: { slug: 'test-pack', name: 'Test pack' }, sprites: [{ slot: 'hero', width: 16, height: 12 }] })) },
        { name: 'sprites/hero.png', data: await L.encodePng(16, 12, new Uint8Array(16 * 12 * 4).fill(120)) }]);
      var dt3 = new DataTransfer(); dt3.items.add(new File([bundle], 'dev.zip', { type: 'application/zip' }));
      $('#zipfile').files = dt3.files; $('#zipfile').dispatchEvent(new Event('change'));
      await until(function () { return /taken in/.test($('#main').textContent); }, 'the import report');
      say(/1<\/strong> sprites taken in/.test($('#main').innerHTML), 'importing a developer\'s zip filled the slot');
      location.hash = '#/library/' + rep.library.id; // not the same id as in M; just exercise a missing page
      await until(function () { return /Not found|Test pack|Sample/.test($('#main').textContent); }, 'a page');
      var hero = (await S.allSprites()).filter(function (s) { return s.slot === 'hero'; })[0];
      say(hero.state === 'raw' && hero.origin === 'developer', 'developer art arrived as received');

      location.hash = '#/';
      await until(function () { return $$('.libcard').length === 2; }, 'two libraries');
      say($$('.libcard').length === 2, 'the dashboard lists both libraries');
    } catch (e) { say(false, 'stopped: ' + e.message); }
    say(true, 'done');
  }
  run();
})();
"""


SEED = r"""
(async function () {
  function $(s) { return document.querySelector(s); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  while (!window.__store || !$('[data-do=sample]')) await sleep(50);
  $('[data-do=sample]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  while (!document.querySelector('.tile')) await sleep(50);
  var want = location.search.indexOf('library') >= 0;
  if (!want) location.hash = document.querySelector('.tile').getAttribute('href').replace(/^.*#/, '#');
})();
"""


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 420
    shot_hash = sys.argv[3] if len(sys.argv) > 3 else ""
    tmp = pathlib.Path(tempfile.mkdtemp())

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/wait":
                time.sleep(2 if shot_hash else 12)
                body, ctype = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x01D\x00;", "image/gif"
            elif path == "/__test.js":
                body, ctype = (SEED if shot_hash else TEST).encode(), "text/javascript"
            elif path in ("/", "/index.html"):
                html = (WEB / "index.html").read_text().replace('<main class="wrap" id="main"></main>', '<main class="wrap" id="main"></main><img src="/wait" width="1" height="1" alt="" style="position:absolute">')
                if shot_hash:
                    html = html.replace("</body>", '<script src="__test.js"></script></body>')
                else:
                    html = html.replace('<main class="wrap"', '<pre id="report" style="position:fixed;top:0;left:0;right:0;z-index:99;margin:0;padding:6px 10px;background:#000c;color:#fff;font:12px/1.35 monospace;white-space:pre-wrap"></pre><main class="wrap"')
                    html = html.replace("</body>", '<script src="__test.js"></script></body>')
                body, ctype = html.encode(), "text/html"
            else:
                f = (WEB / path.lstrip("/")).resolve()
                ok = f.is_file() and WEB in f.parents and "tests" not in f.parts
                body, ctype = (f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream")) if ok else (b"", "text/plain")
            self.send_response(200 if body else 404)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    shot = out / f"skipture_{shot_hash or 'tests'}_{width}.png"
    prof = tmp / "p"
    prof.mkdir()
    r = subprocess.run(["firefox", "--no-remote", "--profile", str(prof), "--headless", f"--window-size={width},1700", "--screenshot", str(shot), f"http://127.0.0.1:{srv.server_address[1]}/" + ("?library" if shot_hash == "library" else "")],
                       capture_output=True, text=True, timeout=150, env={"MOZ_HEADLESS": "1", "PATH": "/usr/bin:/bin", "HOME": str(tmp)})
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(shot if shot.exists() else r.stderr[-600:])


if __name__ == "__main__":
    main()
