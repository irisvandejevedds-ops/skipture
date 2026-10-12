/* Skipture: the gate, the dashboard, libraries, the editor, import and the artist's libraries page. Talks to a room through api.js; the rules are in lib.js and ops.js. */
(function () {
  'use strict';
  var L = window.SkipLib, O = window.SkipOps, A = window.SkipApi, E = window.SkipEditor, W = L.STATE_WORDS;
  var main = document.getElementById('main'), flashBox = document.getElementById('flash'), topnav = document.getElementById('topnav'), tabbar = document.getElementById('tabbar'), who = document.getElementById('who');
  var api = null, editor = null, urls = [], routing = Promise.resolve(), makeRoom = null;
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  // ---------------- little helpers ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function blobUrl(bytes) { var u = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); urls.push(u); return u; }
  function freeUrls() { urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = []; }
  function flash(msg, bad) {
    flashBox.innerHTML = '<div class="' + (bad ? 'error' : 'ok') + '" role="status">' + esc(msg) + '</div>';
    clearTimeout(flash.t); flash.t = setTimeout(function () { flashBox.innerHTML = ''; }, bad ? 9000 : 3500);
  }
  function download(bytes, name, type) {
    var u = URL.createObjectURL(new Blob([bytes], { type: type || 'application/zip' })), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function head(uid, title, info) {
    return '<input type="checkbox" id="' + uid + '" class="infotoggle"><h3><span>' + esc(title) + '</span>' + (info ? '<label for="' + uid + '" class="infobtn" aria-label="More about this">i</label>' : '') + '</h3>' + (info ? '<div class="callout">' + info + '</div>' : '');
  }
  function title(uid, text, info) {
    return '<input type="checkbox" id="' + uid + '" class="infotoggle"><h1><span>' + esc(text) + '</span>' + (info ? '<label for="' + uid + '" class="infobtn" aria-label="More about this">i</label>' : '') + '</h1>' + (info ? '<div class="callout">' + info + '</div>' : '');
  }
  function bar(p, big) {
    if (!p.total) return '<div class="hbar' + (big ? ' big' : '') + '"></div>';
    function w(n) { return 100 * n / p.total; }
    return '<div class="hbar' + (big ? ' big' : '') + '" role="img" aria-label="' + p.humanized + ' of ' + p.total + ' humanized"><i class="h" style="width:' + w(p.counts.humanized) + '%"></i><i class="t" style="width:' + w(p.counts.touched) +
      '%"></i><i class="r" style="width:' + w(p.counts.raw) + '%"></i><i class="e" style="width:' + w(p.counts.empty) + '%"></i></div>';
  }
  function legend(p) {
    return '<p class="small legend"><span class="chip humanized">' + p.counts.humanized + ' humanized</span> <span class="chip touched">' + p.counts.touched + ' redrawn</span> <span class="chip raw">' + p.counts.raw + ' as received</span>' +
      (p.counts.empty ? ' <span class="chip empty">' + p.counts.empty + ' waiting for art</span>' : '') + '</p>';
  }
  function scaleFor(w, h, box) { return Math.max(1, Math.floor((box || 96) / Math.max(w, h))); }
  /** a picture: from the page data when it came with it, otherwise fetched afterwards (see hydrate) */
  function img(id, w, h, b64, box, alt) {
    var sc = scaleFor(w, h, box), big = w > (box || 96) || h > (box || 96);
    return '<img class="px' + (big ? ' big' : '') + '" data-sid="' + id + '" src="' + (b64 ? blobUrl(O.b64dec(b64)) : BLANK) + '"' + (b64 ? '' : ' data-lazy="1"') + ' width="' + w * sc + '" height="' + h * sc + '" alt="' + esc(alt || '') + '">';
  }
  function hydrate() {
    $$('img[data-lazy]').forEach(function (im) {
      im.removeAttribute('data-lazy');
      api.png(+im.dataset.sid, im.dataset.which || 'current').then(function (b) { im.src = blobUrl(b); }, function () { /* leave the blank */ });
    });
  }
  function when(iso) { return String(iso || '').slice(0, 16).replace('T', ' '); }
  function isArtist() { return api && api.role === 'artist'; }

  // ---------------- the gate ----------------
  var GATE_INFO = '<strong>Try it first.</strong> Type <code>DEMO</code> as the key to look around a demo room full of made-up libraries. It lives in this tab and is gone when you close it.<br><br>' +
    '<strong>Rooms.</strong> A room is a private set of libraries. The key is how you find it. <strong>Guests</strong> come in with the key alone: they can look around, bring art in, and draw on slots nobody has taken over. ' +
    '<strong>Artists</strong> come in with the key and the passphrase: they can also redraw anything, sign sprites off as humanized, export, and edit or delete libraries and sprites.<br><br>' +
    '<strong>Making a room.</strong> Enter a key nobody has used yet (at least 4 characters; a longer key is harder to guess) together with a new passphrase (at least 8). Skipture asks you to confirm, and then the room is yours and you are its artist. ' +
    'Give the key to the people you want as guests and keep the passphrase to yourself.<br><br>' +
    'The passphrase is scrambled in your browser before it is sent, so the server never sees it. If you forget it, it cannot be recovered.';

  function gatePage() {
    var html = '<div class="gate"><div class="brandmark"><span class="mark">Skip<i>ture</i></span></div>';
    if (makeRoom) {
      html += '<div class="card">' + head('i-make', 'Make a new room?', 'No room has this key yet. If you meant to enter an existing room, press Back and check the key for typos. A new room is yours alone to run: the passphrase you set makes you its artist.') +
        '<p>No room has the key <strong>' + esc(makeRoom.key) + '</strong>. Make one, with you as its artist?</p>' +
        '<form data-act="create"><label class="f">Type the passphrase again<input type="password" name="again" autocomplete="new-password" required></label>' +
        '<div class="row"><button class="btn" type="submit">Make the room</button><button class="btn ghost" type="button" data-do="back">Back</button></div></form></div>';
    } else {
      html += '<div class="card">' + head('i-gate', 'Enter a room', GATE_INFO) +
        '<form data-act="enter"><label class="f">Room key<input type="text" name="key" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="80"></label>' +
        '<label class="f">Passphrase (artists)<input type="password" name="pass" autocomplete="current-password"></label>' +
        '<button class="btn" type="submit">Enter</button></form></div>';
    }
    return html + '</div>';
  }

  function start(a) { api = a; makeRoom = null; go('#/'); }
  function startDemo() { return A.demo(window.SkipDemo.seed).then(start); }
  function lost() { api = null; A.leave(); makeRoom = null; flash('Your visit has ended. Enter the room again.', true); route(); }

  // ---------------- the dashboard ----------------
  async function dashboard() {
    var d = await api.call('overview'), t = d.totals;
    var html = title('i-dash', 'Dashboard', 'Everything in this room at a glance. <strong>Submitted</strong> counts the sprites that have art in them. <strong>Humanized</strong> counts the ones the artist has signed off by hand, which is the real measure of progress. Each library shows its progress beside one of its sprites; open a library to see its sprites, and open a sprite to draw on it.');
    html += '<div class="stats"><div class="card">' + head('i-sub', 'Submitted', 'Sprites that have art, whoever brought it: a developer\'s picture, an import, or a drawing made here. Slots still waiting for art are not counted.') +
      '<div class="bignum">' + t.submitted + '<small> of ' + t.sprites + '</small></div><p class="small">sprites have art</p></div>' +
      '<div class="card">' + head('i-hum', 'Humanized', 'Signed off by the artist after looking at the sprite. The percentage is humanized sprites as a share of every sprite in the room.') +
      '<div class="bignum teal">' + t.humanized + '<small> of ' + t.sprites + ' &middot; ' + t.pct + '%</small></div><p class="small">sprites signed off</p></div></div>';
    var lastApp = null;
    d.libraries.forEach(function (l) {
      if (l.app !== lastApp) { lastApp = l.app; html += '<h2 class="apphead">' + esc(l.app || 'No app') + '</h2>'; }
      var p = l.progress, r = l.rep;
      html += '<a class="card libcard withthumb" href="#/library/' + l.id + '"><span class="thumbbox' + (r && r.bgMode === 'transparent' ? ' checker' : '') + '">' + (r ? img(r.id, r.width, r.height, r.png, 96, l.name) : '') + '</span>' +
        '<span class="libinfo"><span class="cardhead"><h3>' + esc(l.name) + '</h3><span class="pct">' + p.pct + '%</span></span>' + bar(p) + '<p class="small">' + p.humanized + ' of ' + p.total + ' humanized &middot; ' + l.submitted + ' submitted' + (p.counts.empty ? ' &middot; ' + p.counts.empty + ' waiting for art' : '') + '</p></span></a>';
    });
    if (!d.libraries.length) html += '<div class="card"><h3>Nothing here yet</h3><p>This room has no libraries. Bring one in, or start one from scratch.</p><div class="row"><a class="btn" href="#/import">Import or build a library</a></div></div>';
    return html;
  }

  // ---------------- a library ----------------
  async function libraryPage(id, q) {
    var d = await api.call('library', { id: id }), lib = d.lib, p = d.progress;
    var show = L.STATES.indexOf(q.show) >= 0 ? q.show : '', list = show ? d.sprites.filter(function (s) { return s.state === show; }) : d.sprites;
    var html = title('i-lib', lib.name, 'Open any sprite to see it large and draw on it. ' + (isArtist() ? 'You are the artist here, so you can redraw anything and sign a sprite off as humanized. ' : 'As a guest you can draw on slots that are empty or still as received; once the artist redraws one it is theirs. ') + 'Library id: <code>' + esc(lib.slug) + '</code>.');
    html += '<p class="small muted">' + esc(lib.app || 'No app') + (lib.description ? ' &middot; ' + esc(lib.description) : '') + '</p>';
    html += '<div class="card">' + head('i-prog', 'How humanized', 'Humanized means the artist signed the slot off by hand. Redrawn means it was edited by the artist but not signed off. As received is the art as it was brought in. The second number counts by pixel area instead of by sprite count.') +
      '<div class="bignum">' + p.pct + '<small>%</small></div>' + bar(p, true) + '<p class="small">' + p.humanized + ' of ' + p.total + ' sprites &middot; ' + p.areaPct + '% by pixel area</p>' + legend(p) + '</div>';
    html += '<div class="tabs"><a href="#/library/' + id + '"' + (!show ? ' aria-current="true"' : '') + '>All</a>' + L.STATES.map(function (st) { return '<a href="#/library/' + id + '?show=' + st + '"' + (show === st ? ' aria-current="true"' : '') + '>' + W[st] + '</a>'; }).join('') + '</div>';
    html += '<div class="grid">' + (list.length ? list.map(function (s) {
      return '<a class="tile" href="#/sprite/' + s.id + '"><span class="thumb' + (s.bgMode === 'transparent' ? ' checker' : '') + '">' + img(s.id, s.width, s.height, s.png, 96, s.name) + '</span><span class="name">' + esc(s.name) + '</span><span class="meta"><span class="chip ' + s.state + '">' + W[s.state] + '</span> <span class="dim">' + s.width + '&times;' + s.height + '</span></span></a>';
    }).join('') : '<p class="muted">Nothing in this view.</p>') + '</div>';
    html += '<div class="card">' + head('i-slot', 'Add a slot', 'A slot is one sprite or texture the app needs. Its id is what the file is named (sprites/&lt;id&gt;.png in a zip). Size is fixed once art exists, so choose it carefully. Textures can be previewed tiled.') + slotForm(id) + '</div>';
    return html;
  }
  function slotForm(libId) {
    return '<form data-act="addslot" data-id="' + libId + '"><div class="grid2"><label class="f">Id<input type="text" name="slot" required maxlength="64" pattern="[a-z0-9][a-z0-9_.\\-]*" placeholder="frog-stage-0"></label><label class="f">Name<input type="text" name="name" maxlength="80"></label>' +
      '<label class="f">Width<input type="number" name="width" min="1" max="512" required></label><label class="f">Height<input type="number" name="height" min="1" max="512" required></label>' +
      '<label class="f">Kind<select name="kind"><option value="sprite">sprite</option><option value="texture">texture</option></select></label><label class="f">Background<select name="bgMode"><option value="transparent">transparent</option><option value="opaque">opaque</option></select></label>' +
      '<label class="f">Category<input type="text" name="category" maxlength="40"></label><label class="check f"><input type="checkbox" name="tile" value="1"> Tiles seamlessly</label></div>' +
      '<label class="f">Notes<input type="text" name="notes" maxlength="500"></label><button class="btn" type="submit">Add slot</button></form>';
  }

  // ---------------- the editor ----------------
  async function editorPage(id) {
    var d = await api.call('sprite', { id: id }), s = d.sprite, lib = d.lib, p = d.progress, art = isArtist();
    var bytes = await Promise.all([api.png(id, 'current'), api.png(id, 'original')]);
    var html = '<div id="editor" data-id="' + s.id + '">' +
      '<div class="crumbs"><a href="#/library/' + lib.id + '">&larr; ' + esc(lib.name) + '</a><span class="navs">' + (d.prev ? '<a class="btn ghost sm" href="#/sprite/' + d.prev + '">&lsaquo; Prev</a>' : '') + (d.next ? '<a class="btn ghost sm" href="#/sprite/' + d.next + '">Next &rsaquo;</a>' : '') + '</span></div>' +
      title('i-ed', s.name, 'Pen paints one pixel, drag to draw. Eraser clears to transparent (or to the background colour on an opaque sprite). Fill floods the connected area of one exact colour. Keys: B pen, E eraser, G fill, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Y redo. Nothing is stored until you press Save (leaving the page saves for you). To work from a picture, bring in a PNG of exactly ' + s.width + '&times;' + s.height + ' or drop it on the canvas. This slot is ' + s.width + '&times;' + s.height + (s.kind === 'texture' ? ', a texture' + (s.tile ? ' that tiles seamlessly' : '') : '') + '; its size cannot change because the file for it must match.' + (art ? '' : ' Your drawing is saved as the art for this slot, as received; only the artist can sign it off.')) +
      (d.locked ? '<div class="locked">The artist has taken this slot over, so it can be looked at but no longer changed here.</div>' : '') +
      '<p class="small"><span class="chip ' + s.state + '" id="statechip">' + W[s.state] + '</span> <span id="changed" class="dim">' + (s.changedPx ? s.changedPx + ' px redrawn' : '') + '</span> <span class="dim">&middot; ' + p.humanized + ' of ' + p.total + ' in the library humanized</span>' + (s.notes ? ' <span class="dim">&middot; ' + esc(s.notes) + '</span>' : '') + '</p>' +
      '<div class="workbench"><section class="canvaspane" style="position:relative"><div class="toolbar" role="toolbar" aria-label="Tools"><button type="button" class="tool on" data-tool="pen" title="Pen (B)">Pen</button><button type="button" class="tool colbtn" id="colbtn" title="Colour" aria-label="Colour" aria-haspopup="true" aria-expanded="false"><span id="colsw"></span></button><button type="button" class="tool" data-tool="erase" title="Eraser (E)">Erase</button><button type="button" class="tool" data-tool="fill" title="Fill (G)">Fill</button><span class="sep"></span>' +
      '<button type="button" class="tool plain" id="undo" title="Undo (Ctrl+Z)" disabled>Undo</button><button type="button" class="tool plain" id="redo" title="Redo (Ctrl+Shift+Z)" disabled>Redo</button><span class="sep"></span><button type="button" class="tool plain" id="zoomout" title="Smaller">&minus;</button><button type="button" class="tool plain" id="zoomin" title="Larger">+</button><button type="button" class="tool plain on" id="gridbtn" title="Grid" aria-pressed="true">Grid</button></div>' +
      '<div class="card colpop" id="colpop" hidden>' + head('i-col', 'Colour', 'Drag round the ring for the hue, inside the square for shade. Or type a hex code. Recent colours and the colours already used in this sprite are below; tap one to pick it up.') + '<div class="wheelwrap"><canvas id="wheel" width="208" height="208" aria-label="Colour wheel"></canvas></div><div class="row colrow"><span id="cur" class="swatch big" aria-label="Current colour"></span><input id="hex" type="text" maxlength="7" value="#1A9C98" spellcheck="false" aria-label="Hex colour"></div><p class="label">Recent</p><div id="recent" class="swatches"></div><p class="label">In this sprite</p><div id="used" class="swatches"></div></div>' +
      '<div id="stage" class="stage checker"><div class="stack"><canvas id="cv" aria-label="Sprite canvas"></canvas><canvas id="grid" aria-hidden="true"></canvas></div></div><p class="small dim" id="pos">&nbsp;</p>' +
      '<div class="row savebar"><button type="button" class="btn" id="save" disabled>Save</button>' + (d.next || d.todo ? '<button type="button" class="btn ghost" id="savenext">Save &amp; next</button>' : '') + (d.locked ? '' : '<label class="btn ghost" for="bring">Bring in a PNG</label><input type="file" id="bring" class="infotoggle" accept="image/png">') + '<span id="status" class="small dim" role="status"></span></div></section>' +
      '<aside class="side">' +
      '<div class="card"' + (art ? '' : ' style="display:none"') + '>' + head('i-bg', 'Background', 'Transparent sprites show a checkerboard behind them. Opaque ones are fully filled: switching to opaque lays the background colour behind every see-through pixel (undo reverses it), and the eraser then paints the background colour. Switching back makes pixels of exactly that colour transparent again.') +
      '<div class="seg"><label><input type="radio" name="bg" value="transparent"' + (s.bgMode === 'transparent' ? ' checked' : '') + '> Transparent</label><label><input type="radio" name="bg" value="opaque"' + (s.bgMode === 'opaque' ? ' checked' : '') + '> Opaque</label></div><div class="row"><span id="bgsw" class="swatch"></span><input id="bgcolor" type="text" maxlength="7" value="' + esc(s.bgColor) + '" spellcheck="false" aria-label="Background colour"><button type="button" class="btn ghost sm" id="bguse">Use current</button></div></div>' +
      '<div class="card">' + head('i-pv', 'Preview', 'The sprite at its true size, enlarged, and beside the original art for comparison.' + (s.tile ? ' Textures are shown tiled three by three.' : '')) + '<div class="previews"><div><p class="label">Actual</p><div class="pvbox checker"><canvas id="pv1"></canvas></div></div><div><p class="label">Larger</p><div class="pvbox checker"><canvas id="pv3"></canvas></div></div><div><p class="label">Original</p><div class="pvbox checker"><canvas id="pvo"></canvas></div></div>' + (s.tile ? '<div><p class="label">Tiled</p><div class="pvbox checker"><canvas id="pvt"></canvas></div></div>' : '') + '</div></div>';
    if (art) {
      html += '<div class="card">' + head('i-sign', 'Sign off', 'Humanized means you looked at this sprite and it is yours: nothing sloppy left. It is a deliberate step, so editing a humanized sprite sets it back to redrawn until you sign it off again. Resetting puts the original art back (the redrawn version is kept in history).') +
        '<div class="row" id="signrow">' + signRow(s.state, s.id) + '</div></div>' +
        '<div class="card">' + head('i-meta', 'About this slot', 'The slot id is <code>' + esc(s.slot) + '</code> and the file for it is sprites/' + esc(s.slot) + '.png. Notes are written into the schema you export, so whoever fills the library in can read them.') +
        '<form data-act="meta" data-id="' + s.id + '"><label class="f">Name<input type="text" name="name" value="' + esc(s.name) + '" maxlength="80"></label><div class="grid2"><label class="f">Kind<select name="kind"><option value="sprite"' + (s.kind === 'sprite' ? ' selected' : '') + '>sprite</option><option value="texture"' + (s.kind === 'texture' ? ' selected' : '') + '>texture</option></select></label>' +
        '<label class="f">Category<input type="text" name="category" value="' + esc(s.category) + '" maxlength="40"></label></div><label class="check f"><input type="checkbox" name="tile" value="1"' + (s.tile ? ' checked' : '') + '> Tiles seamlessly</label><label class="f">Notes<input type="text" name="notes" value="' + esc(s.notes) + '" maxlength="500"></label><button class="btn ghost" type="submit">Save details</button></form>' +
        '<form class="danger" data-act="delslot" data-id="' + s.id + '"><label class="check f"><input type="checkbox" name="confirm" value="1"> Remove this slot</label><button class="btn warn" type="submit">Remove</button></form></div>';
    }
    html += '</aside></div></div>';
    route.after = function () {
      editor = E.mount({
        sprite: { width: s.width, height: s.height, bgMode: s.bgMode, bgColor: s.bgColor, png: bytes[0], originalPng: bytes[1] },
        readOnly: d.locked,
        onSave: function (r) {
          return api.call('saveArt', { id: s.id, png: O.b64enc(r.png), changedPx: r.changedPx, blank: r.blank, edited: r.edited, bgMode: r.bgMode, bgColor: r.bgColor }).then(function (res) { var row = $('#signrow'); if (row) row.innerHTML = signRow(res.state, s.id); return res; });
        },
        onNext: function () { var t = d.todo || d.next; go(t ? '#/sprite/' + t : '#/library/' + lib.id); }
      });
      window.__skipture = editor;
    };
    return html;
  }

  /** the sign-off buttons for a sprite in this state (redrawn in place after a save, so the page never offers a stale choice) */
  function signRow(state, id) {
    return (state === 'humanized' ? '<button class="btn ghost" type="button" data-do="state" data-action="unhumanize" data-id="' + id + '">Undo sign-off</button>' : state === 'empty' ? '<span class="small dim">Draw something first, or bring in a picture.</span>' : '<button class="btn good" type="button" data-do="state" data-action="humanize" data-id="' + id + '">Mark humanized</button>') +
      '<button class="btn ghost" type="button" data-do="state" data-action="reset" data-id="' + id + '" data-confirm="Put the original art back? The current picture stays in history.">Reset to original</button><a class="btn ghost" href="#/sprite/' + id + '/history">History</a>';
  }

  async function historyPage(id) {
    var d = await api.call('history', { id: id }), s = d.sprite;
    return title('i-hist', s.name + ': earlier versions', 'Every save keeps the picture it replaced, newest first, up to ' + L.KEEP_REVISIONS + '. Restoring one keeps the current art as a version too, so nothing is lost either way.') +
      '<p><a class="btn ghost" href="#/sprite/' + id + '">Back to the editor</a></p><div class="grid">' + (d.revisions.length ? d.revisions.map(function (r) {
        return '<div class="tile"><span class="thumb' + (s.bgMode === 'transparent' ? ' checker' : '') + '"><img class="px' + (s.width > 96 || s.height > 96 ? ' big' : '') + '" data-sid="' + id + '" data-which="rev:' + r.id + '"' + (r.png ? ' src="' + blobUrl(O.b64dec(r.png)) + '"' : ' src="' + BLANK + '" data-lazy="1"') + ' width="' + s.width * scaleFor(s.width, s.height) + '" height="' + s.height * scaleFor(s.width, s.height) + '" alt=""></span><span class="meta"><span class="chip ' + r.state + '">' + W[r.state] + '</span></span><span class="name">' + when(r.createdAt) + '</span><span class="dim">' + esc(r.note) + '</span><button class="btn ghost" type="button" data-do="restore" data-id="' + id + '" data-rev="' + r.id + '">Restore</button></div>';
      }).join('') : '<p class="muted">No earlier versions yet.</p>') + '</div>';
  }

  // ---------------- import ----------------
  var TEMPLATE = { format: 'skipture-library', version: 1, library: { slug: 'my-library', name: 'My library', app: 'My app', description: 'What this library is for.' },
    sprites: [{ slot: 'example-sprite', name: 'Example sprite', kind: 'sprite', width: 16, height: 16, tile: false, background: 'transparent', background_color: null, category: '', notes: 'Delete this entry and list your own slots.' },
      { slot: 'example-texture', name: 'Example texture', kind: 'texture', width: 32, height: 32, tile: true, background: 'opaque', background_color: '#336633', category: 'ground', notes: 'Opaque slots need a background colour.' }] };

  function importPage(report, error) {
    var html = title('i-import', 'Import', 'Bring art or a whole library into this room. <strong>Import a library</strong> takes a zip (a schema.json and sprites/&lt;slot&gt;.png for each slot) or just a schema.json. If its library id matches one here, new art goes only into slots that are empty or still as received; anything the artist redrew or signed off is kept. A zip for a new library creates it. ' +
      '<strong>Blank schema</strong> is an empty template to describe a library in a text editor. <strong>Build manually</strong> starts an empty library you fill slot by slot. Everything on this page is open to guests and artists alike.');
    if (error) html += '<div class="error">' + esc(error) + '</div>';
    if (report) {
      html += '<div class="card"><h3>' + (report.created ? 'Created' : 'Merged into') + ' ' + esc(report.library.name) + '</h3><p><strong>' + (report.added.length + report.updated.length) + '</strong> sprites taken in &middot; <strong>' + report.kept.length + '</strong> kept as the artist\'s &middot; <strong>' + report.skipped.length + '</strong> skipped &middot; <strong>' + report.problems.length + '</strong> problems</p><div class="row"><a class="btn" href="#/library/' + report.library.id + '">Open the library</a></div></div>';
      [['Problems', report.problems], ['Kept', report.kept], ['Skipped', report.skipped], ['Taken in', report.added.concat(report.updated)]].forEach(function (g) {
        if (g[1].length) html += '<div class="card"><h3>' + g[0] + '</h3><ul class="plain">' + g[1].map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
      });
    }
    html += '<div class="card">' + head('i-drop', 'Import a library', 'A zip can hold up to 16 MB. Slots must match the sizes in the schema exactly. A schema.json on its own makes the library with every slot waiting for art.') +
      '<div class="dropbox" id="drop"><p class="big">Drop a zip or schema.json here</p><input type="file" id="zipfile" accept=".zip,.json,application/zip,application/json"><p class="small muted">or choose a file</p></div></div>';
    html += '<div class="cols"><div class="card">' + head('i-blank', 'Blank schema', 'A JSON file describing a library: its name and one entry per slot, with width, height, kind, background and notes. Fill it in, then import it here to make the library with empty slots, or send it to someone who will draw the art.') +
      '<p class="small">A template to describe a library in a text editor.</p><button class="btn" type="button" data-do="template">Download blank schema</button></div>' +
      '<div class="card">' + head('i-manual', 'Build a library manually', 'Starts an empty library. Open it afterwards to add slots one by one, then bring art in or draw it.') +
      '<form data-act="newlib"><label class="f">Name<input type="text" name="name" required maxlength="80"></label><label class="f">App<input type="text" name="app" maxlength="60" placeholder="Alberich"></label><label class="f">Description<input type="text" name="description" maxlength="500"></label><button class="btn" type="submit">Create library</button></form></div></div>';
    return html;
  }

  // ---------------- the artist's libraries page ----------------
  async function librariesPage() {
    var ov = await api.call('overview'), libs = await Promise.all(ov.libraries.map(function (l) { return api.call('library', { id: l.id }); }));
    var html = title('i-libs', 'Libraries', 'Manage everything in the room. Tick sprites or whole libraries, then use the bar at the top to change or delete them together. Only the fields you fill in are changed; blank ones are left alone. <strong>Export library</strong> makes a zip of the art as it stands (complete only when every sprite is humanized); <strong>Export schema</strong> makes a zip of empty slots to send to whoever will fill them. Deleting cannot be undone.');
    html += '<div class="bulkbar" id="bulk"><p class="count" id="bulkcount">Nothing selected</p><details><summary>Change or delete the selected</summary>' +
      '<form data-act="bulk-sprites"><span class="tag">Selected sprites</span><label class="f">Kind<select name="kind"><option value="">no change</option><option value="sprite">sprite</option><option value="texture">texture</option></select></label>' +
      '<label class="f">Tiles<select name="tile"><option value="">no change</option><option value="yes">tiles</option><option value="no">does not tile</option></select></label>' +
      '<label class="f">Background<select name="bgMode"><option value="">no change</option><option value="transparent">transparent</option><option value="opaque">opaque</option></select></label>' +
      '<label class="f">Category<input type="text" name="category" maxlength="40" placeholder="no change"></label><label class="f">Notes<input type="text" name="notes" maxlength="500" placeholder="no change"></label>' +
      '<button class="btn sm" type="submit">Apply</button><button class="btn warn sm" type="button" data-do="bulk-del-sprites">Delete sprites</button></form>' +
      '<form data-act="bulk-libs"><span class="tag">Selected libraries</span><label class="f">App<input type="text" name="app" maxlength="60" placeholder="no change"></label><label class="f">Description<input type="text" name="description" maxlength="500" placeholder="no change"></label>' +
      '<button class="btn sm" type="submit">Apply</button><button class="btn warn sm" type="button" data-do="bulk-del-libs">Delete libraries</button></form></details></div>';
    html += '<div class="libmgr">';
    libs.forEach(function (d) {
      var lib = d.lib;
      html += '<div class="card"><div class="libhead"><input type="checkbox" class="sellib" data-id="' + lib.id + '" aria-label="Select ' + esc(lib.name) + '"><h3><a href="#/library/' + lib.id + '">' + esc(lib.name) + '</a></h3><span class="pill">' + esc(lib.app || 'No app') + '</span><span class="pct">' + d.progress.pct + '%</span></div>' +
        bar(d.progress) + '<p class="small">' + d.progress.humanized + ' of ' + d.progress.total + ' humanized &middot; id <code>' + esc(lib.slug) + '</code></p>' +
        '<div class="row"><button class="btn sm" type="button" data-do="export" data-purpose="library" data-id="' + lib.id + '">' + (d.progress.complete ? 'Export library' : 'Export partial') + '</button><button class="btn ghost sm" type="button" data-do="export" data-purpose="schema" data-id="' + lib.id + '">Export schema</button></div>' +
        '<details><summary>Details</summary><form data-act="editlib" data-id="' + lib.id + '"><div class="grid2"><label class="f">Name<input type="text" name="name" value="' + esc(lib.name) + '" required maxlength="80"></label><label class="f">App<input type="text" name="app" value="' + esc(lib.app) + '" maxlength="60"></label></div>' +
        '<label class="f">Description<input type="text" name="description" value="' + esc(lib.description) + '" maxlength="500"></label><button class="btn ghost sm" type="submit">Save details</button></form></details>' +
        '<details><summary>Sprites (' + d.sprites.length + ')</summary><div class="tscroll"><table class="sprites"><thead><tr><th><input type="checkbox" class="selall" data-lib="' + lib.id + '" aria-label="Select all in ' + esc(lib.name) + '"></th><th>Sprite</th><th>Slot</th><th>Size</th><th>Kind</th><th>Category</th><th>State</th></tr></thead><tbody>' +
        d.sprites.map(function (s) {
          return '<tr><td><input type="checkbox" class="selspr" data-id="' + s.id + '" data-lib="' + lib.id + '" aria-label="Select ' + esc(s.name) + '"></td><td><a href="#/sprite/' + s.id + '">' + esc(s.name) + '</a></td><td><code>' + esc(s.slot) + '</code></td><td>' + s.width + '&times;' + s.height + '</td><td>' + s.kind + (s.tile ? ', tiles' : '') + '</td><td>' + esc(s.category) + '</td><td><span class="chip ' + s.state + '">' + W[s.state] + '</span></td></tr>';
        }).join('') + '</tbody></table></div></details></div>';
    });
    if (!libs.length) html += '<div class="card"><h3>No libraries</h3><p>Nothing to manage yet.</p><div class="row"><a class="btn" href="#/import">Import or build a library</a></div></div>';
    html += '</div>';
    html += '<div class="card">' + head('i-room', api.demo ? 'The demo room' : 'This room', api.demo ? 'The demo lives in this tab only. Resetting it puts back the made-up libraries.' : 'Deleting the room removes every library, sprite and version in it for everyone, and frees its key. Guests lose access at once. It cannot be undone.') +
      (api.demo ? '<button class="btn ghost" type="button" data-do="reset-demo">Reset the demo</button>' : '<form data-act="destroy"><label class="f">Type <code>DELETE</code> to delete this room<input type="text" name="confirm" autocomplete="off"></label><button class="btn warn" type="submit">Delete the room</button></form>') + '</div>';
    return html;
  }

  function missing(msg) { return title('i-gone', 'Not found') + '<div class="card"><p>' + esc(msg) + '</p><div class="row"><a class="btn" href="#/">Back to the dashboard</a></div></div>'; }

  // ---------------- routing ----------------
  function parse() {
    var h = location.hash.replace(/^#/, '') || '/', qs = {}, i = h.indexOf('?');
    if (i >= 0) { h.slice(i + 1).split('&').forEach(function (kv) { var p = kv.split('='); qs[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); h = h.slice(0, i); }
    return { parts: h.split('/').filter(Boolean), q: qs };
  }
  function route(extra) {
    routing = routing.then(function () { return render(extra); }).catch(function (e) {
      if (e instanceof A.Ended) return lost();
      console.error(e); flash(e.message || 'Something went wrong.', true);
    });
    return routing;
  }

  function shell(page) {
    var items = [['Dashboard', '#/', 'dash'], ['Import', '#/import', 'import']];
    if (isArtist()) items.push(['Libraries', '#/libraries', 'libraries']);
    var links = items.map(function (i) { return '<a href="' + i[1] + '"' + (i[2] === page ? ' aria-current="page"' : '') + '>' + i[0] + '</a>'; }).join('');
    topnav.innerHTML = links + '<button type="button" class="leave" data-do="leave">Leave</button>';
    tabbar.innerHTML = links + '<button type="button" class="leave" data-do="leave">Leave</button>';
    who.innerHTML = '<span class="pill ' + (api.demo ? 'demo' : isArtist() ? 'artist' : '') + '">' + (api.demo ? 'Demo' : isArtist() ? 'Artist' : 'Guest') + '</span>';
  }

  async function render(extra) {
    if (editor) {
      if (editor.dirty()) await editor.save();
      editor.destroy(); editor = null; window.__skipture = null;
    }
    freeUrls(); route.after = null;
    var r = parse(), p = r.parts, html, page = p[0] || 'dash', id = parseInt(p[1], 10);
    document.body.classList.toggle('gate', !api);
    if (!api) { who.innerHTML = ''; topnav.innerHTML = ''; tabbar.innerHTML = ''; main.className = 'wrap'; main.innerHTML = gatePage(); document.title = 'Skipture'; return; }
    if (page === 'library' && id) html = await libraryPage(id, r.q);
    else if (page === 'sprite' && id && p[2] === 'history') html = isArtist() ? await historyPage(id) : missing('Only the artist can see a sprite\'s history.');
    else if (page === 'sprite' && id) html = await editorPage(id);
    else if (page === 'import') html = importPage(extra && extra.report, extra && extra.error);
    else if (page === 'libraries') html = isArtist() ? await librariesPage() : missing('Only the artist can manage libraries.');
    else if (page === 'dash') html = await dashboard();
    else html = missing('There is no such page.');
    var editing = page === 'sprite' && !p[2];
    main.className = 'wrap' + (editing ? ' wide' : '');
    main.innerHTML = html;
    shell(page === 'library' || page === 'sprite' ? 'dash' : page);
    document.title = 'Skipture';
    window.scrollTo(0, 0);
    hydrate();
    if (route.after) { route.after(); route.after = null; }
    if (page === 'import') wireImport();
    if (page === 'libraries') updateBulk();
  }

  // ---------------- actions ----------------
  function readFile(file) {
    if (file.size > O.CAP.zipBytes) return Promise.reject(new L.LibError('That file is bigger than ' + Math.round(O.CAP.zipBytes / 1000000) + ' MB.'));
    return file.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function wireImport() {
    var drop = $('#drop'), input = $('#zipfile');
    function take(file) {
      if (!file) return;
      readFile(file).then(function (bytes) {
        if (/\.json$/i.test(file.name)) bytes = L.writeZip([{ name: 'schema.json', data: bytes }]);
        return api.importZip(bytes);
      }).then(function (report) { route({ report: report }); }, function (e) { if (e instanceof A.Ended) return lost(); route({ error: e.message || 'Could not read that file.' }); });
    }
    input.addEventListener('change', function () { take(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { take(e.dataTransfer.files[0]); });
  }

  function selected() { return { sprites: $$('.selspr:checked').map(function (c) { return +c.dataset.id; }), libs: $$('.sellib:checked').map(function (c) { return +c.dataset.id; }) }; }
  function updateBulk() {
    var s = selected(), el = $('#bulkcount');
    if (el) el.textContent = !s.sprites.length && !s.libs.length ? 'Nothing selected' : s.sprites.length + ' sprite' + (s.sprites.length === 1 ? '' : 's') + ', ' + s.libs.length + ' librar' + (s.libs.length === 1 ? 'y' : 'ies') + ' selected';
  }

  var forms = {
    enter: async function (f, el) {
      var key = String(f.key || '').trim(), pass = String(f.pass || '');
      if (/^demo$/i.test(key)) return startDemo();
      var btn = $('button[type=submit]', el); btn.disabled = true; btn.textContent = 'Entering…';
      try {
        var r = await A.enter(key, pass);
        if (r.none) {
          if (!pass) throw new Error('No room has that key. To make a new room, enter the key together with a new passphrase.');
          makeRoom = { key: key, pass: pass }; return route();
        }
        start(r.api);
      } finally { btn.disabled = false; btn.textContent = 'Enter'; }
    },
    create: async function (f, el) {
      if (f.again !== makeRoom.pass) throw new Error('The two passphrases are not the same.');
      if (makeRoom.key.length < 4) throw new Error('A room key needs at least 4 characters. Press Back and choose a longer one.');
      if (makeRoom.pass.length < 8) throw new Error('A passphrase needs at least 8 characters. Press Back and choose a longer one.');
      var btn = $('button[type=submit]', el); btn.disabled = true; btn.textContent = 'Making…';
      try { start(await A.create(makeRoom.key, makeRoom.pass)); } finally { btn.disabled = false; btn.textContent = 'Make the room'; }
    },
    newlib: async function (f) { go('#/library/' + (await api.call('createLibrary', f)).id); },
    editlib: async function (f, el) { await api.call('editLibrary', { id: +el.dataset.id, name: f.name, app: f.app, description: f.description }); flash('Saved.'); route(); },
    addslot: async function (f, el) { go('#/sprite/' + (await api.call('addSlot', { libraryId: +el.dataset.id, slot: f.slot, name: f.name, width: f.width, height: f.height, kind: f.kind, bgMode: f.bgMode, category: f.category, tile: f.tile === '1', notes: f.notes })).id); },
    meta: async function (f, el) { await api.call('editMeta', { id: +el.dataset.id, name: f.name, kind: f.kind, tile: f.tile === '1', category: f.category, notes: f.notes }); flash('Saved.'); route(); },
    delslot: async function (f, el) {
      if (f.confirm !== '1') throw new Error('Tick the box to confirm removing this slot.');
      var d = await api.call('sprite', { id: +el.dataset.id }); await api.call('deleteSprite', { id: +el.dataset.id }); go('#/library/' + d.lib.id);
    },
    'bulk-sprites': async function (f) {
      var s = selected().sprites; if (!s.length) throw new Error('Tick some sprites first.');
      var fields = {}; if (f.kind) fields.kind = f.kind; if (f.tile) fields.tile = f.tile === 'yes'; if (f.bgMode) fields.bgMode = f.bgMode; if (f.category) fields.category = f.category; if (f.notes) fields.notes = f.notes;
      var r = await api.call('bulkSprites', { ids: s, action: 'meta', fields: fields }); flash('Changed ' + r.count + ' sprite' + (r.count === 1 ? '' : 's') + '.'); route();
    },
    'bulk-libs': async function (f) {
      var l = selected().libs; if (!l.length) throw new Error('Tick some libraries first.');
      var fields = {}; if (f.app) fields.app = f.app; if (f.description) fields.description = f.description;
      var r = await api.call('bulkLibraries', { ids: l, action: 'edit', fields: fields }); flash('Changed ' + r.count + ' librar' + (r.count === 1 ? 'y' : 'ies') + '.'); route();
    },
    destroy: async function (f) {
      if (String(f.confirm || '').trim() !== 'DELETE') throw new Error('Type DELETE (in capitals) to delete the room.');
      await api.destroy(); api = null; A.leave(); flash('The room is deleted.'); go('#/');
    }
  };

  var doing = {
    leave: async function () { api = null; A.leave(); makeRoom = null; go('#/'); },
    back: async function () { makeRoom = null; route(); },
    template: async function () { download(new TextEncoder().encode(JSON.stringify(TEMPLATE, null, 2) + '\n'), 'blank-schema.json', 'application/json'); },
    'export': async function (el) { var r = await api.exportZip(+el.dataset.id, el.dataset.purpose); download(r.data, r.name); route(); },
    state: async function (el) {
      if (el.dataset.confirm && !window.confirm(el.dataset.confirm)) return;
      await api.call('setState', { id: +el.dataset.id, action: el.dataset.action }); route();
    },
    restore: async function (el) { await api.call('restore', { id: +el.dataset.id, revision: +el.dataset.rev }); go('#/sprite/' + el.dataset.id); },
    'bulk-del-sprites': async function () {
      var s = selected().sprites; if (!s.length) throw new Error('Tick some sprites first.');
      if (!window.confirm('Delete ' + s.length + ' sprite' + (s.length === 1 ? '' : 's') + '? This cannot be undone.')) return;
      await api.call('bulkSprites', { ids: s, action: 'delete' }); flash('Deleted.'); route();
    },
    'bulk-del-libs': async function () {
      var l = selected().libs; if (!l.length) throw new Error('Tick some libraries first.');
      if (!window.confirm('Delete ' + l.length + ' librar' + (l.length === 1 ? 'y' : 'ies') + ' and every sprite in ' + (l.length === 1 ? 'it' : 'them') + '? This cannot be undone.')) return;
      await api.call('bulkLibraries', { ids: l, action: 'delete', confirm: true }); flash('Deleted.'); route();
    },
    'reset-demo': async function () { await startDemo(); flash('The demo is back as it was.'); }
  };

  function fail(err) { if (err instanceof A.Ended) return lost(); flash(err.message || 'That did not work.', true); }
  document.addEventListener('submit', function (e) {
    var el = e.target, act = el.dataset && el.dataset.act;
    if (!act) return;
    e.preventDefault();
    var f = {}; new FormData(el).forEach(function (v, k) { f[k] = v; });
    forms[act](f, el).catch(fail);
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-do]');
    if (!el) return;
    e.preventDefault();
    doing[el.dataset.do](el).catch(fail);
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.classList.contains('selall')) { $$('.selspr[data-lib="' + t.dataset.lib + '"]').forEach(function (c) { c.checked = t.checked; }); }
    if (t.classList.contains('selall') || t.classList.contains('selspr') || t.classList.contains('sellib')) updateBulk();
  });
  window.addEventListener('hashchange', function () { route(); });

  // ---------------- start ----------------
  window.SkipApp = { route: route };
  if (A.wasDemo()) startDemo().catch(function () { route(); });
  else { api = A.resume(); route(); }
})();
