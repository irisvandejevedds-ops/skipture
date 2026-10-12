/* Skipture: the gate, the browse pages, the workbench editor, import and the ledger. Talks to a room through api.js; the rules are in lib.js and ops.js. */
(function () {
  'use strict';
  var L = window.SkipLib, O = window.SkipOps, A = window.SkipApi, E = window.SkipEditor, W = L.STATE_WORDS;
  var main = document.getElementById('main'), flashBox = document.getElementById('flash'), topnav = document.getElementById('topnav'), tabbar = document.getElementById('tabbar'), who = document.getElementById('who');
  var api = null, editor = null, urls = [], routing = Promise.resolve(), makeRoom = null, ledger = null;
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
  function isArtist() { return api && api.role === 'artist'; }
  function when(iso) {
    var t = Date.parse(iso); if (!t) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    return m < 1 ? 'now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
  }

  // ---------------- pixel icons ----------------
  var ICON = {
    pen: ['......#.', '.....###', '....###.', '...###..', '..###...', '.###....', '##......', '#.......'],
    erase: ['........', '..#####.', '.#####.#', '#####.##', '####.##.', '###.##..', '.##.#...', '........'],
    fill: ['...##...', '..#..#..', '.#....#.', '######.#', '#....#.#', '.#..#..#', '..##....', '........'],
    undo: ['..#.....', '.##.....', '#######.', '.##...#.', '..#...#.', '......#.', '.#####..', '........'],
    redo: ['.....#..', '.....##.', '.#######', '.#...##.', '.#...#..', '.#......', '..#####.', '........'],
    plus: ['...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...'],
    minus: ['........', '........', '........', '########', '########', '........', '........', '........'],
    grid: ['#.#.#.#.', '........', '#.#.#.#.', '........', '#.#.#.#.', '........', '#.#.#.#.', '........'],
    check: ['........', '.......#', '......##', '#....##.', '##..##..', '.####...', '..##....', '........'],
    folder: ['###.....', '#####...', '########', '#......#', '#......#', '#......#', '########', '........'],
    imp: ['...##...', '...##...', '...##...', '######..', '.####...', '..##....', '........', '######..'],
    lib: ['.######.', '#......#', '#.####.#', '#......#', '#.####.#', '#......#', '.######.', '........'],
    dots: ['........', '........', '.#.#.#..', '........', '........', '........', '........', '........'],
    dash: ['########', '#.#.#.##', '########', '#.#.#.##', '########', '#.#.#.##', '########', '........']
  };
  var iconCache = {};
  function icon(n) {
    if (!iconCache[n]) {
      var c = document.createElement('canvas'); c.width = 8; c.height = 8; var x = c.getContext('2d'); x.fillStyle = '#000';
      ICON[n].forEach(function (row, y) { for (var i = 0; i < 8; i++) if (row[i] === '#') x.fillRect(i, y, 1, 1); });
      iconCache[n] = c.toDataURL();
    }
    return '<i class="ic" style="-webkit-mask-image:url(' + iconCache[n] + ');mask-image:url(' + iconCache[n] + ')"></i>';
  }

  // ---------------- html pieces ----------------
  function head(uid, title, info) {
    return '<input type="checkbox" id="' + uid + '" class="infotoggle"><h3><span>' + esc(title) + '</span>' + (info ? '<label for="' + uid + '" class="infobtn" aria-label="More about this">i</label>' : '') + '</h3>' + (info ? '<div class="callout">' + info + '</div>' : '');
  }
  function pagehead(uid, text, info, extra) {
    return '<input type="checkbox" id="' + uid + '" class="infotoggle"><div class="pagehead"><h1>' + esc(text) + '</h1>' + (extra || '') + (info ? '<label for="' + uid + '" class="infobtn" aria-label="More about this">i</label>' : '') + '</div>' + (info ? '<div class="callout top">' + info + '</div>' : '');
  }
  function ph(uid, title, right, info) {
    return '<input type="checkbox" id="' + uid + '" class="infotoggle"><div class="panelh"><span>' + esc(title) + '</span><span class="r">' + (right ? '<span>' + right + '</span>' : '') + (info ? '<label for="' + uid + '" class="infobtn" aria-label="More about this">i</label>' : '') + '</span></div>' + (info ? '<div class="callout">' + info + '</div>' : '');
  }
  function bar(p, big) {
    if (!p.total) return '<span class="hbar' + (big ? ' big' : '') + '"></span>';
    function w(n) { return 100 * n / p.total; }
    return '<span class="hbar' + (big ? ' big' : '') + '" role="img" aria-label="' + p.humanized + ' of ' + p.total + ' humanized"><i class="h" style="width:' + w(p.counts.humanized) + '%"></i><i class="u" style="width:' + w(p.counts.touched) +
      '%"></i><i class="r" style="width:' + w(p.counts.raw) + '%"></i><i class="e" style="width:' + w(p.counts.empty) + '%"></i></span>';
  }
  function chip(state, id) { return '<span class="chip ' + state + '"' + (id ? ' id="' + id + '"' : '') + '>' + W[state] + '</span>'; }
  function pip(state) { return '<i class="pip ' + state + '" title="' + W[state] + '"></i>'; }
  /** a picture: from the page data when it came with it, otherwise fetched afterwards (see hydrate) */
  function img(id, b64, alt) {
    return '<img class="px" data-sid="' + id + '" src="' + (b64 ? blobUrl(O.b64dec(b64)) : BLANK) + '"' + (b64 ? '' : ' data-lazy="1"') + ' alt="' + esc(alt || '') + '">';
  }
  function hydrate() {
    $$('img[data-lazy]').forEach(function (im) {
      im.removeAttribute('data-lazy');
      api.png(+im.dataset.sid, im.dataset.which || 'current').then(function (b) { im.src = blobUrl(b); }, function () { /* leave the blank */ });
    });
  }

  // ---------------- the gate ----------------
  var GATE_INFO = '<strong>Try it first.</strong> Type <code>DEMO</code> as the key to look around a demo room full of made-up libraries. It lives in this tab and is gone when you close it.<br><br>' +
    '<strong>Rooms.</strong> A room is a private set of libraries. The key is how you find it. <strong>Guests</strong> come in with the key alone: they can look around, bring art in, and draw on slots nobody has taken over. ' +
    '<strong>Artists</strong> come in with the key and the passphrase: they can also redraw anything, sign sprites off as humanized, export, and edit or delete libraries and sprites.<br><br>' +
    '<strong>Making a room.</strong> Enter a key nobody has used yet (at least 4 characters; a longer key is harder to guess) together with a new passphrase (at least 8). Skipture asks you to confirm, and then the room is yours and you are its artist. ' +
    'Give the key to the people you want as guests and keep the passphrase to yourself.<br><br>' +
    'The passphrase is scrambled in your browser before it is sent, so the server never sees it. If you forget it, it cannot be recovered.';

  function gatePage() {
    var html = '<div class="gate-box"><div class="brandmark"><span class="mark">Skip<i>ture</i></span></div>';
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

  // ---------------- loading the room ----------------
  async function loadRoom() {
    var ov = await api.call('overview');
    var libs = await Promise.all(ov.libraries.map(function (l) { return api.call('library', { id: l.id }); }));
    return { ov: ov, libs: libs };
  }

  /** the left-hand tree: every library with its progress, and the current library's sprites */
  function sideTree(ov, curLib, sprites, curSprite) {
    var html = '<div class="panelh"><span>Room</span><span class="num">' + ov.totals.sprites + ' sprites</span></div>';
    html += '<a class="lib all' + (!curLib ? ' cur' : '') + '" href="#/"><span>Everything</span><span class="p num">' + ov.totals.pct + '%</span></a>';
    var lastApp = null;
    ov.libraries.forEach(function (l) {
      if (l.app !== lastApp) { lastApp = l.app; html += '<div class="app-h">' + esc(l.app || 'No app') + '</div>'; }
      html += '<a class="lib' + (l.id === curLib ? ' cur' : '') + '" href="#/library/' + l.id + '"><span>' + esc(l.name) + '</span><span class="p num">' + l.progress.pct + '%</span>' + bar(l.progress) + '</a>';
      if (l.id === curLib && sprites) sprites.forEach(function (s) {
        html += '<a class="spr' + (s.id === curSprite ? ' cur' : '') + '" href="#/sprite/' + s.id + '">' + img(s.id, s.png, '') + '<span class="nm">' + esc(s.slot) + '</span>' + pip(s.state) + '</a>';
      });
    });
    return '<aside class="side">' + html + '</aside>';
  }

  // ---------------- browse: the whole room, or one library ----------------
  async function browsePage(only) {
    var d = await loadRoom(), libs = only ? d.libs.filter(function (x) { return x.lib.id === only; }) : d.libs;
    if (only && !libs.length) return missing('That library is not here.');
    var all = []; libs.forEach(function (x) { all = all.concat(x.sprites); });
    var cnt = { empty: 0, raw: 0, touched: 0, humanized: 0 }; all.forEach(function (s) { cnt[s.state]++; });
    var total = all.length, pct = total ? Math.floor(100 * cnt.humanized / total) : 0, submitted = total - cnt.empty;
    var prog = { total: total, humanized: cnt.humanized, counts: cnt };
    var title = only ? libs[0].lib.name : 'Dashboard';
    var info = only ? 'Open any sprite to see it large and draw on it. ' + (isArtist() ? 'You are the artist here, so you can redraw anything and sign a sprite off as humanized. ' : 'As a guest you can draw on slots that are empty or still as received; once the artist redraws one it is theirs. ') + 'Library id: <code>' + esc(libs[0].lib.slug) + '</code>.'
      : 'Every sprite in this room as a tile with a dot for its state. <strong>Submitted</strong> counts the sprites that have art in them. <strong>Humanized</strong> counts the ones the artist has signed off by hand, which is the real measure of progress. The buttons filter the tiles by state; the box filters by name. Open a tile to draw on it.';
    var html = '<div class="shell">' + sideTree(d.ov, only || 0, null, 0) + '<section class="content" id="content" data-f="">';
    html += pagehead('i-dash', title, info);
    html += '<div class="stats"><div class="stat"><span class="lab">Submitted</span><div class="bignum">' + submitted + '<small>of ' + total + '</small></div></div>' +
      '<div class="stat h"><span class="lab">Humanized</span><div class="bignum">' + cnt.humanized + '<small>' + pct + '%</small></div>' + bar(prog, true) + '</div></div>';
    html += '<div class="filters" id="filters"><span class="f1 on" data-filter="">All <em>' + total + '</em></span>' +
      ['empty', 'raw', 'touched', 'humanized'].map(function (st) { return '<span class="f1" data-filter="' + st + '">' + pip(st) + W[st] + ' <em>' + cnt[st] + '</em></span>'; }).join('') +
      '<input type="search" id="tilefind" placeholder="Filter by name…" aria-label="Filter sprites by name"></div>';
    var lastApp = null;
    libs.forEach(function (x) {
      var l = x.lib, p = x.progress;
      if (!only && l.app !== lastApp) lastApp = l.app;
      html += '<div class="lh"><a href="#/library/' + l.id + '">' + esc(l.name) + '</a>' + bar(p, true) + '<span class="num">' + p.humanized + '/' + p.total + ' &middot; ' + p.pct + '%</span><span class="sp"></span><span>' + esc(l.app || '') + '</span></div><div class="grid">' +
        x.sprites.map(function (s) {
          return '<a class="t s-' + s.state + '" href="#/sprite/' + s.id + '" title="' + esc(s.name) + '" data-name="' + esc((s.name + ' ' + s.slot).toLowerCase()) + '">' + pip(s.state) + '<span class="th checker sm">' + img(s.id, s.png, s.name) + '</span><span class="id">' + esc(s.slot) + '</span></a>';
        }).join('') + '</div>';
    });
    if (!libs.length) html += '<div class="card">' + head('i-none', 'Nothing here yet') + '<p>This room has no libraries. Bring one in, or start one from scratch.</p><div class="row"><a class="btn" href="#/import">Import or build a library</a></div></div>';
    if (only) {
      html += '<div class="card slotform">' + head('i-slot', 'Add a slot', 'A slot is one sprite or texture the app needs. Its id is what the file is named (sprites/&lt;id&gt;.png in a zip). Size is fixed once art exists, so choose it carefully. Textures can be previewed tiled.') + slotForm(only) + '</div>';
    }
    return html + '</section></div>';
  }
  function slotForm(libId) {
    return '<form data-act="addslot" data-id="' + libId + '"><div class="grid2"><label class="f">Id<input type="text" name="slot" required maxlength="64" pattern="[a-z0-9][a-z0-9_.\\-]*" placeholder="frog-stage-0"></label><label class="f">Name<input type="text" name="name" maxlength="80"></label>' +
      '<label class="f">Width<input type="number" name="width" min="1" max="512" required></label><label class="f">Height<input type="number" name="height" min="1" max="512" required></label>' +
      '<label class="f">Kind<select name="kind"><option value="sprite">sprite</option><option value="texture">texture</option></select></label><label class="f">Background<select name="bgMode"><option value="transparent">transparent</option><option value="opaque">opaque</option></select></label>' +
      '<label class="f">Category<input type="text" name="category" maxlength="40"></label><label class="check f"><input type="checkbox" name="tile" value="1"> Tiles seamlessly</label></div>' +
      '<label class="f">Notes<input type="text" name="notes" maxlength="500"></label><button class="btn" type="submit">Add slot</button></form>';
  }

  // ---------------- the editor: workbench ----------------
  function signRow(state, id) {
    return (state === 'humanized' ? '<button class="tbtn" type="button" data-do="state" data-action="unhumanize" data-id="' + id + '">Undo sign-off</button>' : state === 'empty' ? '<span class="small dim">Draw something first, or bring in a picture.</span>' : '<button class="tbtn good" type="button" data-do="state" data-action="humanize" data-id="' + id + '">' + icon('check') + ' Mark humanized</button>') +
      '<button class="tbtn" type="button" data-do="state" data-action="reset" data-id="' + id + '" data-confirm="Put the original art back? The current picture stays in history.">Reset</button>';
  }

  async function editorPage(id) {
    var d = await api.call('sprite', { id: id }), s = d.sprite, lib = d.lib, art = isArtist();
    var results = await Promise.all([api.png(id, 'current'), api.png(id, 'original'), api.call('overview'), api.call('library', { id: lib.id })]);
    var ov = results[2], ld = results[3], sibs = ld.sprites, at = sibs.findIndex(function (x) { return x.id === id; });
    ov.libraries.forEach(function (l) { if (l.id === lib.id) l.progress = ld.progress; });
    var p = ld.progress;
    var html = '<div class="ed" id="editor" data-id="' + s.id + '">' + sideTree(ov, lib.id, sibs, s.id) +
      '<section class="mid">' +
      '<div class="crumb"><span class="lab full"><a href="#/library/' + lib.id + '">' + esc(lib.name) + '</a></span><span class="full">/</span><b class="full">' + esc(s.slot) + '</b>' +
      '<select id="sprpick" aria-label="Sprite in ' + esc(lib.name) + '">' + sibs.map(function (x) { return '<option value="' + x.id + '"' + (x.id === id ? ' selected' : '') + '>' + esc(x.slot) + ' &middot; ' + W[x.state] + '</option>'; }).join('') + '</select>' +
      chip(s.state, 'statechip') + '<span class="sp"></span><span class="dim num full">' + (at + 1) + ' of ' + sibs.length + '</span>' +
      '<button class="tbtn sm mobonly" type="button" data-do="insp" title="Details" aria-label="Details">' + icon('dots') + '</button>' +
      (d.prev ? '<a class="tbtn sm" href="#/sprite/' + d.prev + '" title="Previous ([)">&lsaquo;</a>' : '') + (d.next ? '<a class="tbtn sm" href="#/sprite/' + d.next + '" title="Next (])">&rsaquo;</a>' : '') + '</div>' +
      (d.locked ? '<div class="locked">The artist has taken this slot over, so it can be looked at but no longer changed here.</div>' : '') +
      '<div class="tools" role="toolbar" aria-label="Tools"><button type="button" class="tbtn on" data-tool="pen" title="Pen (B)" aria-label="Pen">' + icon('pen') + '</button>' +
      '<button type="button" class="tbtn colbtn" id="colbtn" title="Colour" aria-label="Colour" aria-haspopup="true" aria-expanded="false"><span id="colsw"></span></button>' +
      '<button type="button" class="tbtn" data-tool="erase" title="Eraser (E)" aria-label="Eraser">' + icon('erase') + '</button><button type="button" class="tbtn" data-tool="fill" title="Fill (G)" aria-label="Fill">' + icon('fill') + '</button><i class="sepv"></i>' +
      '<button type="button" class="tbtn" id="undo" title="Undo (Ctrl+Z)" aria-label="Undo" disabled>' + icon('undo') + '</button><button type="button" class="tbtn" id="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled>' + icon('redo') + '</button><i class="sepv"></i>' +
      '<button type="button" class="tbtn" id="zoomout" title="Smaller" aria-label="Zoom out">' + icon('minus') + '</button><button type="button" class="tbtn" id="zoomin" title="Larger" aria-label="Zoom in">' + icon('plus') + '</button><button type="button" class="tbtn on" id="gridbtn" title="Grid" aria-label="Grid" aria-pressed="true">' + icon('grid') + '</button><span class="sp"></span>' +
      (d.locked ? '' : '<label class="tbtn" for="bring" title="Bring in a PNG" aria-label="Bring in a PNG">' + icon('imp') + '</label><input type="file" id="bring" class="infotoggle" accept="image/png">') +
      (d.next || d.todo ? '<button type="button" class="tbtn" id="savenext" title="Save and open the next sprite">Save &amp; next</button>' : '') + '<button type="button" class="tbtn pri" id="save" disabled>Save</button></div>' +
      '<div class="card colpop" id="colpop" hidden>' + head('i-col', 'Colour', 'Drag round the ring for the hue, inside the square for shade. Or type a hex code. Recent colours and the colours already used in this sprite are below; tap one to pick it up.') +
      '<div class="wheelwrap"><canvas id="wheel" width="208" height="208" aria-label="Colour wheel"></canvas></div><div class="colrow"><span id="cur" class="swatch big" aria-label="Current colour"></span><input id="hex" type="text" maxlength="7" value="#1A9C98" spellcheck="false" aria-label="Hex colour"></div>' +
      '<p class="label">Recent</p><div id="recent" class="swatches"></div><p class="label">In this sprite</p><div id="used" class="swatches"></div></div>' +
      '<div id="stage" class="stage checker"><div class="stack"><canvas id="cv" aria-label="Sprite canvas"></canvas><canvas id="grid" aria-hidden="true"></canvas></div></div>' +
      '<div class="statusbar"><span id="pos">&nbsp;</span><span id="changed">' + (s.changedPx ? s.changedPx + ' px redrawn' : '') + '</span><span id="status" role="status"></span><span class="hint">B pen &middot; E erase &middot; G fill &middot; Ctrl+Z undo &middot; [ ] prev/next</span></div></section>' +
      '<aside class="insp" id="insp">' +
      '<div class="sec">' + ph('i-pv', 'Preview', '1x &middot; larger &middot; original', 'The sprite at its true size, enlarged, and beside the original art for comparison.' + (s.tile ? ' Textures are shown tiled three by three.' : '')) +
      '<div class="in"><div class="prevs previews"><div><span class="cap">1x</span><div class="pvbox checker sm"><canvas id="pv1"></canvas></div></div><div><span class="cap">Larger</span><div class="pvbox checker sm"><canvas id="pv3"></canvas></div></div><div><span class="cap">Original</span><div class="pvbox checker sm"><canvas id="pvo"></canvas></div></div>' + (s.tile ? '<div><span class="cap">Tiled</span><div class="pvbox checker sm"><canvas id="pvt"></canvas></div></div>' : '') + '</div></div></div>' +
      '<div class="sec">' + ph('i-sign', 'State', p.humanized + ' of ' + p.total + ' done', art ? 'Humanized means you looked at this sprite and it is yours: nothing sloppy left. It is a deliberate step, so editing a humanized sprite sets it back to redrawn until you sign it off again. Resetting puts the original art back (the redrawn version is kept in history).' : 'Your drawing is saved as the art for this slot, as received. Only the artist can sign a sprite off as humanized.') +
      '<div class="in">' + (art ? '<div class="row" id="signrow" style="margin:0">' + signRow(s.state, s.id) + '</div>' : '<span class="small dim">The artist signs sprites off.</span>') + '</div></div>' +
      '<div class="sec"' + (art ? '' : ' hidden') + '>' + ph('i-bg', 'Background', '', 'Transparent sprites show a checkerboard behind them. Opaque ones are fully filled: switching to opaque lays the background colour behind every see-through pixel (undo reverses it), and the eraser then paints the background colour. Switching back makes pixels of exactly that colour transparent again.') +
      '<div class="in"><div class="seg"><label><input type="radio" name="bg" value="transparent"' + (s.bgMode === 'transparent' ? ' checked' : '') + '> Transparent</label><label><input type="radio" name="bg" value="opaque"' + (s.bgMode === 'opaque' ? ' checked' : '') + '> Opaque</label></div><div class="row" style="margin:0"><span id="bgsw" class="swatch"></span><input id="bgcolor" type="text" maxlength="7" value="' + esc(s.bgColor) + '" spellcheck="false" aria-label="Background colour"><button type="button" class="tbtn sm" id="bguse">Use current</button></div></div></div>' +
      '<div class="sec">' + ph('i-meta', 'Slot', '', 'The slot id is <code>' + esc(s.slot) + '</code> and the file for it is sprites/' + esc(s.slot) + '.png. Notes are written into the schema you export, so whoever fills the library in can read them.') + '<div class="in">' +
      (art ? '<form data-act="meta" data-id="' + s.id + '"><label class="f">Name<input type="text" name="name" value="' + esc(s.name) + '" maxlength="80"></label><div class="grid2"><label class="f">Kind<select name="kind"><option value="sprite"' + (s.kind === 'sprite' ? ' selected' : '') + '>sprite</option><option value="texture"' + (s.kind === 'texture' ? ' selected' : '') + '>texture</option></select></label>' +
        '<label class="f">Category<input type="text" name="category" value="' + esc(s.category) + '" maxlength="40"></label></div><label class="check f"><input type="checkbox" name="tile" value="1"' + (s.tile ? ' checked' : '') + '> Tiles seamlessly</label><label class="f">Notes<input type="text" name="notes" value="' + esc(s.notes) + '" maxlength="500"></label><button class="tbtn" type="submit">Save details</button></form>' +
        '<form data-act="delslot" data-id="' + s.id + '" style="margin-top:10px"><label class="check f"><input type="checkbox" name="confirm" value="1"> Remove this slot</label><button class="tbtn warn" type="submit">Remove</button></form>'
        : '<div class="kv"><span>id</span><span>' + esc(s.slot) + '</span><span>size</span><span>' + s.width + ' &times; ' + s.height + '</span><span>kind</span><span>' + s.kind + (s.tile ? ', tiles' : '') + '</span><span>notes</span><span style="color:var(--mute)">' + esc(s.notes || 'none') + '</span></div>') + '</div></div>' +
      (art ? '<div class="sec">' + ph('i-hist', 'History', '', 'Every save keeps the picture it replaced, newest first, up to ' + L.KEEP_REVISIONS + '. You can restore any of them; the current art is kept as a version too.') + '<div class="in"><a class="tbtn" href="#/sprite/' + s.id + '/history">Open history</a></div></div>' : '') +
      '</aside></div>';
    route.after = function () {
      editor = E.mount({
        sprite: { width: s.width, height: s.height, bgMode: s.bgMode, bgColor: s.bgColor, png: results[0], originalPng: results[1] },
        readOnly: d.locked,
        onSave: function (r) {
          return api.call('saveArt', { id: s.id, png: O.b64enc(r.png), changedPx: r.changedPx, blank: r.blank, edited: r.edited, bgMode: r.bgMode, bgColor: r.bgColor }).then(function (res) { var row = $('#signrow'); if (row) row.innerHTML = signRow(res.state, s.id); return res; });
        },
        onNext: function () { var t = d.todo || d.next; go(t ? '#/sprite/' + t : '#/library/' + lib.id); }
      });
      window.__skipture = editor;
      route.keys = function (e) {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '') || e.ctrlKey || e.metaKey) return;
        if (e.key === '[' && d.prev) go('#/sprite/' + d.prev); else if (e.key === ']' && d.next) go('#/sprite/' + d.next);
      };
    };
    return html;
  }

  async function historyPage(id) {
    var d = await api.call('history', { id: id }), s = d.sprite;
    return '<div class="content" style="max-width:1000px">' + pagehead('i-hist', s.name + ': earlier versions', 'Every save keeps the picture it replaced, newest first, up to ' + L.KEEP_REVISIONS + '. Restoring one keeps the current art as a version too, so nothing is lost either way.') +
      '<p><a class="tbtn" href="#/sprite/' + id + '">&lsaquo; Back to the editor</a></p><div class="grid" style="grid-template-columns:repeat(auto-fill,120px)">' + (d.revisions.length ? d.revisions.map(function (r) {
        return '<div class="t" style="width:120px"><span class="th checker sm"><img class="px" data-sid="' + id + '" data-which="rev:' + r.id + '"' + (r.png ? ' src="' + blobUrl(O.b64dec(r.png)) + '"' : ' src="' + BLANK + '" data-lazy="1"') + ' alt=""></span><div style="padding:4px 2px;font-size:11px">' + chip(r.state) + '<div class="dim">' + esc(when(r.createdAt)) + '</div><div class="dim">' + esc(r.note) + '</div></div><button class="tbtn sm" type="button" data-do="restore" data-id="' + id + '" data-rev="' + r.id + '">Restore</button></div>';
      }).join('') : '<p class="muted">No earlier versions yet.</p>') + '</div></div>';
  }

  // ---------------- import ----------------
  function importPage(report, error) {
    var html = pagehead('i-import', 'Import', 'Bring art or a whole library into this room. <strong>Import a library</strong> takes a zip (a schema.json and sprites/&lt;slot&gt;.png for each slot) or just a schema.json. If its library id matches one here, new art goes only into slots that are empty or still as received; anything the artist redrew or signed off is kept. A zip for a new library creates it. ' +
      '<strong>Format guide</strong> is a document for developers that explains the zip and schema.json, with a blank starter schema inside it. <strong>Build manually</strong> starts an empty library you fill slot by slot. Everything on this page is open to guests and artists alike.');
    if (error) html += '<div class="error">' + esc(error) + '</div>';
    if (report) {
      html += '<div class="card"><h3>' + (report.created ? 'Created' : 'Merged into') + ' ' + esc(report.library.name) + '</h3><p><strong>' + (report.added.length + report.updated.length) + '</strong> sprites taken in &middot; <strong>' + report.kept.length + '</strong> kept as the artist\'s &middot; <strong>' + report.skipped.length + '</strong> skipped &middot; <strong>' + report.problems.length + '</strong> problems</p><div class="row"><a class="btn" href="#/library/' + report.library.id + '">Open the library</a></div></div>';
      [['Problems', report.problems], ['Kept', report.kept], ['Skipped', report.skipped], ['Taken in', report.added.concat(report.updated)]].forEach(function (g) {
        if (g[1].length) html += '<div class="card"><h3>' + g[0] + '</h3><ul class="plain">' + g[1].map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
      });
    }
    html += '<div class="card">' + head('i-drop', 'Import a library', 'A zip can hold up to 16 MB. Slots must match the sizes in the schema exactly. A schema.json on its own makes the library with every slot waiting for art.') +
      '<div class="dropbox" id="drop"><p class="big">Drop a zip or schema.json here</p><input type="file" id="zipfile" accept=".zip,.json,application/zip,application/json"><p class="small muted">or choose a file</p></div></div>';
    html += '<div class="cols"><div class="card">' + head('i-blank', 'Format guide and blank schema', 'A short document to pass to developers. It explains the zip, every field of schema.json and the rules for the PNGs, and has a blank starter schema inside it: copy that into a schema.json, fill it in, then import it here to make the library with empty slots, or send it to someone who will draw the art.') +
      '<p class="small">What a developer needs, with a blank schema inside.</p><div class="row"><button class="btn" type="button" data-do="template">Download format guide</button></div></div>' +
      '<div class="card">' + head('i-manual', 'Build a library manually', 'Starts an empty library. Open it afterwards to add slots one by one, then bring art in or draw it.') +
      '<form data-act="newlib"><label class="f">Name<input type="text" name="name" required maxlength="80"></label><label class="f">App<input type="text" name="app" maxlength="60" placeholder="Alberich"></label><label class="f">Description<input type="text" name="description" maxlength="500"></label><button class="btn" type="submit">Create library</button></form></div></div>';
    return html;
  }

  // ---------------- libraries: the ledger (artist) ----------------
  async function librariesPage() {
    var d = await loadRoom();
    ledger = { rows: {}, order: [], cur: 0 };
    var html = '<div class="ledger"><div class="main"><div class="bulk" id="bulk"><div class="line"><span class="cnt" id="bulkcount">Nothing selected</span><button class="tbtn moreb" type="button" data-do="bulk-more">Edit &#9662;</button>' +
      '<label class="infobtn" for="i-libs" aria-label="More about this" style="margin-left:auto">i</label></div>' +
      '<form data-act="bulk-sprites" class="line fields"><span class="tag">Sprites</span><select name="kind" aria-label="Kind"><option value="">kind</option><option value="sprite">sprite</option><option value="texture">texture</option></select>' +
      '<select name="tile" aria-label="Tiles"><option value="">tiles</option><option value="yes">tiles</option><option value="no">does not tile</option></select><select name="bgMode" aria-label="Background"><option value="">background</option><option value="transparent">transparent</option><option value="opaque">opaque</option></select>' +
      '<input type="text" name="category" maxlength="40" placeholder="category" aria-label="Category"><input type="text" name="notes" maxlength="500" placeholder="notes" aria-label="Notes">' +
      '<button class="tbtn pri" type="submit">Apply</button><button class="tbtn warn" type="button" data-do="bulk-del-sprites">Delete sprites</button></form>' +
      '<form data-act="bulk-libs" class="line fields"><span class="tag">Libraries</span><input type="text" name="app" maxlength="60" placeholder="app" aria-label="App"><input type="text" name="description" maxlength="500" placeholder="description" aria-label="Description">' +
      '<button class="tbtn pri" type="submit">Apply</button><button class="tbtn warn" type="button" data-do="bulk-del-libs">Delete libraries</button></form></div>' +
      '<input type="checkbox" id="i-libs" class="infotoggle"><div class="callout top" style="margin:10px">Manage everything in the room. Tick sprites or libraries, then use the bar at the top to change or delete them together. Only the fields you fill in are changed; blank ones are left alone. <strong>Export</strong> makes a zip of the art as it stands (complete only when every sprite is humanized); <strong>Schema</strong> makes a zip of empty slots to send to whoever will fill them. Click a row to peek at it; keys: J and K move, X ticks, Enter opens the editor, H marks humanized. Deleting cannot be undone.</div>' +
      '<div class="tbl"><table class="sprites libmgr"><thead><tr><th class="c"><input type="checkbox" class="selall" aria-label="Select every sprite"></th><th></th><th>Name</th><th class="hide-m">Slot</th><th class="hide-m">Size</th><th class="hide-m">Kind</th><th class="hide-m">Category</th><th class="hide-m">Background</th><th>State</th><th class="hide-m">Changed</th></tr></thead>';
    d.libs.forEach(function (x) {
      var l = x.lib, p = x.progress;
      html += '<tbody data-lib="' + l.id + '"><tr class="grp"><td colspan="10"><div class="gl"><input type="checkbox" class="sellib" data-id="' + l.id + '" aria-label="Select ' + esc(l.name) + '"><button class="tog" type="button" data-do="grp-toggle" aria-label="Fold or unfold">&#9662;</button><a href="#/library/' + l.id + '">' + esc(l.name) + '</a>' + bar(p) +
        '<i class="m num">' + p.humanized + ' of ' + p.total + ' &middot; ' + p.pct + '%</i><span class="pill">' + esc(l.app || 'No app') + '</span><span class="sp"></span>' +
        '<button class="tbtn sm hide-m" type="button" data-do="export" data-purpose="library" data-id="' + l.id + '">' + (p.complete ? 'Export' : 'Export partial') + '</button><button class="tbtn sm hide-m" type="button" data-do="export" data-purpose="schema" data-id="' + l.id + '">Schema</button><button class="tbtn sm" type="button" data-do="rename">Edit</button></div></td></tr>' +
        '<tr class="editrow" hidden><td colspan="10"><form data-act="editlib" data-id="' + l.id + '"><label class="f">Name<input type="text" name="name" value="' + esc(l.name) + '" required maxlength="80"></label><label class="f">App<input type="text" name="app" value="' + esc(l.app) + '" maxlength="60"></label>' +
        '<label class="f">Description<input type="text" name="description" value="' + esc(l.description) + '" maxlength="500"></label><button class="tbtn pri" type="submit">Save</button><button class="tbtn sm hide-m" type="button" data-do="export" data-purpose="library" data-id="' + l.id + '">Export</button><button class="tbtn sm hide-m" type="button" data-do="export" data-purpose="schema" data-id="' + l.id + '">Schema</button></form></td></tr>';
      x.sprites.forEach(function (s) {
        ledger.rows[s.id] = { s: s, lib: l }; ledger.order.push(s.id);
        html += '<tr class="lr" data-id="' + s.id + '"><td class="c"><input type="checkbox" class="selspr" data-id="' + s.id + '" data-lib="' + l.id + '" aria-label="Select ' + esc(s.name) + '"></td><td>' + img(s.id, s.png, '') + '</td><td>' + esc(s.name) + '<span class="mu small" style="color:var(--mute2);margin-left:6px">' + esc(s.slot) + '</span></td>' +
          '<td class="mu hide-m"><code>' + esc(s.slot) + '</code></td><td class="mu num hide-m">' + s.width + '&times;' + s.height + '</td><td class="mu hide-m">' + s.kind + (s.tile ? ', tiles' : '') + '</td><td class="mu hide-m">' + esc(s.category) + '</td><td class="mu hide-m">' + s.bgMode + '</td><td>' + chip(s.state) + '</td><td class="mu num hide-m">' + esc(when(s.updatedAt)) + '</td></tr>';
      });
      html += '</tbody>';
    });
    html += '</table>' + (d.libs.length ? '' : '<div class="card" style="margin:14px">' + head('i-nolib', 'No libraries') + '<p>Nothing to manage yet.</p><div class="row"><a class="btn" href="#/import">Import or build a library</a></div></div>') +
      '<div class="card roomcard">' + head('i-room', api.demo ? 'The demo room' : 'This room', api.demo ? 'The demo lives in this tab only. Resetting it puts back the made-up libraries.' : 'Deleting the room removes every library, sprite and version in it for everyone, and frees its key. Guests lose access at once. It cannot be undone.') +
      (api.demo ? '<div class="row"><button class="btn ghost" type="button" data-do="reset-demo">Reset the demo</button></div>' : '<form data-act="destroy"><label class="f">Type <code>DELETE</code> to delete this room<input type="text" name="confirm" autocomplete="off"></label><button class="btn warn" type="submit">Delete the room</button></form>') + '</div></div></div>' +
      '<aside class="peek" id="peek"><div class="panelh"><span>Peek</span><span class="r"><span id="peekname"></span><button class="tbtn sm mobonly" type="button" data-do="peek-close" aria-label="Close">x</button></span></div><div class="in" id="peekin"><span class="small dim">Click a row to see it here.</span></div></aside></div>';
    return html;
  }

  function peekFor(id) {
    var r = ledger.rows[id]; if (!r) return;
    var s = r.s;
    $('#peekname').textContent = s.slot;
    $('#peekin').innerHTML = '<div class="big checker sm">' + img(s.id, s.png, s.name) + '</div><div><div style="font:700 11px var(--px);letter-spacing:.04em;margin-bottom:4px">' + esc(s.name) + '</div>' + chip(s.state) + ' <span class="small dim">' + esc(r.lib.name) + ' &middot; ' + s.width + '&times;' + s.height + '</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;min-width:150px"><a class="tbtn pri" href="#/sprite/' + s.id + '">' + icon('pen') + ' Open in editor</a>' +
      (s.state === 'humanized' ? '<button class="tbtn" type="button" data-do="state" data-action="unhumanize" data-id="' + s.id + '">Undo sign-off</button>' : s.state === 'empty' ? '' : '<button class="tbtn good" type="button" data-do="state" data-action="humanize" data-id="' + s.id + '">' + icon('check') + ' Mark humanized</button>') + '</div>' +
      '<div class="lab k" style="margin-top:4px">Shortcuts</div><div class="keys"><span class="kbd">J K</span><span>next or previous row</span><span class="kbd">X</span><span>tick the row</span><span class="kbd">Enter</span><span>open in editor</span><span class="kbd">H</span><span>mark humanized</span></div>';
    hydrate();
    $('#peek').classList.add('on');
    $$('tr.lr.cur').forEach(function (t) { t.classList.remove('cur'); });
    var row = $('tr.lr[data-id="' + id + '"]'); if (row) { row.classList.add('cur'); row.scrollIntoView({ block: 'nearest' }); }
    ledger.cur = id;
  }

  function missing(msg) { return '<div class="content">' + pagehead('i-gone', 'Not found') + '<div class="card">' + head('i-nf', 'Nothing here') + '<p>' + esc(msg) + '</p><div class="row"><a class="btn" href="#/">Back to the dashboard</a></div></div></div>'; }

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
    var items = [['Dashboard', '#/', 'dash', 'dash'], ['Import', '#/import', 'import', 'imp']];
    if (isArtist()) items.push(['Libraries', '#/libraries', 'libraries', 'folder']);
    topnav.innerHTML = items.map(function (i) { return '<a href="' + i[1] + '"' + (i[2] === page ? ' aria-current="page"' : '') + '>' + i[0] + '</a>'; }).join('');
    tabbar.innerHTML = items.map(function (i) { return '<a href="' + i[1] + '"' + (i[2] === page ? ' aria-current="page"' : '') + '>' + icon(i[3]) + i[0] + '</a>'; }).join('');
    who.innerHTML = '<span class="pill ' + (api.demo ? 'demo' : isArtist() ? 'artist' : '') + '">' + (api.demo ? 'Demo' : isArtist() ? 'Artist' : 'Guest') + '</span><button type="button" class="leave" data-do="leave">Leave</button>';
  }

  async function render(extra) {
    if (editor) {
      if (editor.dirty()) await editor.save();
      editor.destroy(); editor = null; window.__skipture = null;
    }
    freeUrls(); route.after = null; route.keys = null; ledger = null;
    var r = parse(), p = r.parts, html, page = p[0] || 'dash', id = parseInt(p[1], 10);
    document.body.classList.toggle('gate', !api);
    if (!api) { who.innerHTML = ''; topnav.innerHTML = ''; tabbar.innerHTML = ''; main.className = 'wrap'; main.innerHTML = gatePage(); document.title = 'Skipture'; return; }
    var plain = false;
    if (page === 'library' && id) html = await browsePage(id);
    else if (page === 'sprite' && id && p[2] === 'history') html = isArtist() ? await historyPage(id) : missing('Only the artist can see a sprite\'s history.');
    else if (page === 'sprite' && id) html = await editorPage(id);
    else if (page === 'import') { html = importPage(extra && extra.report, extra && extra.error); plain = true; }
    else if (page === 'libraries') html = isArtist() ? await librariesPage() : missing('Only the artist can manage libraries.');
    else if (page === 'dash') html = await browsePage(0);
    else html = missing('There is no such page.');
    main.className = 'wrap' + (plain ? ' plain' : '');
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
    $$('tr.lr').forEach(function (t) { t.classList.toggle('sel', !!$('.selspr:checked', t)); });
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
    insp: async function () { var e = $('#editor'); if (e) e.classList.toggle('sheet'); },
    template: async function () {
      var r = await fetch('library-format.md'); if (!r.ok) throw new Error('Could not fetch the guide. Try again.');
      download(new Uint8Array(await r.arrayBuffer()), 'skipture-library-format.md', 'text/markdown');
    },
    'export': async function (el) { var r = await api.exportZip(+el.dataset.id, el.dataset.purpose); download(r.data, r.name); route(); },
    state: async function (el) {
      if (el.dataset.confirm && !window.confirm(el.dataset.confirm)) return;
      var keep = ledger ? ledger.cur : 0;
      await api.call('setState', { id: +el.dataset.id, action: el.dataset.action });
      await route(); if (keep && $('#peek')) peekFor(keep);
    },
    restore: async function (el) { await api.call('restore', { id: +el.dataset.id, revision: +el.dataset.rev }); go('#/sprite/' + el.dataset.id); },
    rename: async function (el) { var tb = el.closest('tbody'), row = $('.editrow', tb); row.hidden = !row.hidden; },
    'grp-toggle': async function (el) { el.closest('tbody').classList.toggle('col'); },
    'bulk-more': async function () { $('#bulk').classList.toggle('open'); },
    'peek-close': async function () { $('#peek').classList.remove('on'); },
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
    if (el) { e.preventDefault(); doing[el.dataset.do](el).catch(fail); return; }
    var fl = e.target.closest && e.target.closest('.f1[data-filter]');
    if (fl) { $$('.f1').forEach(function (b) { b.classList.toggle('on', b === fl); }); $('#content').dataset.f = fl.dataset.filter; return; }
    var row = e.target.closest && e.target.closest('tr.lr');
    if (row && ledger && !e.target.closest('input,a,button')) peekFor(+row.dataset.id);
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'sprpick') return go('#/sprite/' + t.value);
    if (t.classList.contains('selall')) $$('.selspr').forEach(function (c) { c.checked = t.checked; });
    if (t.classList.contains('selall') || t.classList.contains('selspr') || t.classList.contains('sellib')) updateBulk();
  });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'tilefind') return;
    var q = e.target.value.trim().toLowerCase();
    $$('.t[data-name]').forEach(function (t) { t.classList.toggle('nomatch', !!q && t.dataset.name.indexOf(q) < 0); });
  });
  document.addEventListener('keydown', function (e) {
    if (route.keys) route.keys(e);
    if (!ledger || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '') || e.ctrlKey || e.metaKey) return;
    var i = ledger.order.indexOf(ledger.cur), k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') { e.preventDefault(); var n = ledger.order[Math.max(0, Math.min(ledger.order.length - 1, i < 0 ? 0 : i + (k === 'j' ? 1 : -1)))]; if (n) peekFor(n); }
    else if (k === 'x' && ledger.cur) { var c = $('.selspr[data-id="' + ledger.cur + '"]'); if (c) { c.checked = !c.checked; updateBulk(); } }
    else if (e.key === 'Enter' && ledger.cur) go('#/sprite/' + ledger.cur);
    else if (k === 'h' && ledger.cur && ledger.rows[ledger.cur].s.state !== 'empty') { var r = ledger.rows[ledger.cur].s; doing.state({ dataset: { id: r.id, action: r.state === 'humanized' ? 'unhumanize' : 'humanize' } }).catch(fail); }
  });
  window.addEventListener('hashchange', function () { route(); });

  // ---------------- start ----------------
  window.SkipApp = { route: route };
  if (A.wasDemo()) startDemo().catch(function () { route(); });
  else { api = A.resume(); route(); }
})();
