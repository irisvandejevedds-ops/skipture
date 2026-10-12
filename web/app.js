/* Skipture in the browser: the library pages and the editor, all on this device. The rules are in lib.js, storage in store.js, the pixel editor in editor.js. */
(function () {
  'use strict';
  var L = window.SkipLib, E = window.SkipEditor, W = L.STATE_WORDS;
  var main = document.getElementById('main'), flashBox = document.getElementById('flash');
  var S = null, editor = null, urls = [], routing = Promise.resolve();

  // ---------------- little helpers ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function blobUrl(bytes) { var u = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); urls.push(u); return u; }
  function freeUrls() { urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = []; }
  function flash(msg, bad) {
    flashBox.innerHTML = '<div class="' + (bad ? 'error' : 'ok') + '" role="status">' + esc(msg) + '</div>';
    clearTimeout(flash.t); flash.t = setTimeout(function () { flashBox.innerHTML = ''; }, bad ? 9000 : 3500);
  }
  function download(bytes, name) {
    var u = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })), a = document.createElement('a');
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
  function thumbScale(w, h) { return Math.max(1, Math.floor(96 / Math.max(w, h))); }
  function thumb(s, bytes, alt) {
    var sc = thumbScale(s.width, s.height), big = s.width > 96 || s.height > 96;
    return '<span class="thumb' + (s.bgMode === 'transparent' ? ' checker' : '') + '"><img class="px' + (big ? ' big' : '') + '" src="' + blobUrl(bytes) + '" width="' + s.width * sc + '" height="' + s.height * sc + '" alt="' + esc(alt) + '"></span>';
  }
  function when(iso) { return String(iso || '').slice(0, 16).replace('T', ' '); }

  // ---------------- pages ----------------
  async function dashboard() {
    var libs = (await S.libraries()).sort(function (a, b) { return (a.app || '').toLowerCase().localeCompare((b.app || '').toLowerCase()) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    var all = await S.allSprites(), by = {};
    all.forEach(function (s) { (by[s.libraryId] = by[s.libraryId] || []).push(s); });
    var tot = L.overall(all), html = title('i-libs', 'Libraries', 'Every sprite and texture set you keep here. Each slot is as received, redrawn by you, or humanized, which only happens when you sign it off by hand. The percentage counts humanized slots. <strong>Your libraries are stored in this browser on this device only</strong>: nothing is uploaded. Clearing the browser\'s site data removes them, so use <em>Export library</em> on each one to keep a copy.');
    if (tot.total) html += '<div class="card">' + head('i-all', 'Everything together', 'All libraries combined. Humanized slots as a share of every slot.') + '<div class="bignum">' + tot.pct + '<small>%</small></div><p class="small">' + tot.humanized + ' of ' + tot.total + ' sprites humanized</p></div>';
    var lastApp = null;
    libs.forEach(function (l) {
      if (l.app !== lastApp) { lastApp = l.app; html += '<h2 class="apphead">' + esc(l.app || 'No app') + '</h2>'; }
      var p = L.progress(by[l.id] || []);
      html += '<a class="card libcard" href="#/library/' + l.id + '"><div class="cardhead"><h3>' + esc(l.name) + '</h3><span class="pct">' + p.pct + '%</span></div>' + bar(p) + '<p class="small">' + p.humanized + ' of ' + p.total + ' humanized' + (p.counts.empty ? ' &middot; ' + p.counts.empty + ' waiting for art' : '') + '</p></a>';
    });
    if (!libs.length) html += '<div class="card"><h3>Nothing yet</h3><p>Start an empty library below, or bring in a library zip a developer sent you.</p><div class="row"><a class="btn" href="#/import">Import a zip</a><button class="btn ghost" type="button" data-do="sample">Try a small sample</button></div></div>';
    html += '<div class="card">' + head('i-new', 'New library', 'An empty library is a set of slots you define. Add slots one by one, then export the schema and send it to a developer so they can fill it in.') +
      '<form data-act="newlib"><div class="grid2"><label class="f">Name<input type="text" name="name" required maxlength="80"></label><label class="f">App<input type="text" name="app" maxlength="60" placeholder="Alberich"></label></div>' +
      '<label class="f">Description<input type="text" name="description" maxlength="500"></label><button class="btn" type="submit">Create</button></form></div>';
    return html;
  }

  async function libraryPage(id, q) {
    var lib = await S.library(id);
    if (!lib) return missing('That library is not here.');
    var all = await S.sprites(id), p = L.progress(all), show = L.STATES.indexOf(q.show) >= 0 ? q.show : '', list = show ? all.filter(function (s) { return s.state === show; }) : all, exports = await S.exports(id);
    var html = title('i-lib', lib.name, '<strong>Export schema</strong> makes a zip of empty slots with placeholder PNGs, for a developer to fill in and send back (use Import to take it in). <strong>Export library</strong> sends the art as it stands; it is marked complete only when every slot is humanized, otherwise it is a partial export and says so inside the zip. Importing an export on another browser brings the library back with its progress. Library id: <code>' + esc(lib.slug) + '</code>.');
    html += '<p class="small muted">' + esc(lib.app || 'No app') + (lib.description ? ' &middot; ' + esc(lib.description) : '') + '</p>';
    html += '<div class="card">' + head('i-prog', 'How humanized', 'Humanized means you signed the slot off by hand. Redrawn means it was edited but not signed off. As received is the developer\'s or app\'s original art. The second number counts by pixel area instead of by sprite count.') +
      '<div class="bignum">' + p.pct + '<small>%</small></div>' + bar(p, true) + '<p class="small">' + p.humanized + ' of ' + p.total + ' sprites &middot; ' + p.areaPct + '% by pixel area</p>' + legend(p) +
      '<div class="row"><button class="btn ghost" type="button" data-do="export-schema" data-id="' + id + '">Export schema</button><button class="btn' + (p.complete ? '' : ' ghost') + '" type="button" data-do="export-library" data-id="' + id + '">' + (p.complete ? 'Export library' : 'Export partial') + '</button><a class="btn ghost" href="#/import">Import art</a></div></div>';
    html += '<div class="tabs"><a href="#/library/' + id + '"' + (!show ? ' aria-current="true"' : '') + '>All</a>' + L.STATES.map(function (st) { return '<a href="#/library/' + id + '?show=' + st + '"' + (show === st ? ' aria-current="true"' : '') + '>' + W[st] + '</a>'; }).join('') + '</div>';
    html += '<div class="grid">' + (list.length ? list.map(function (s) {
      return '<a class="tile" href="#/sprite/' + s.id + '">' + thumb(s, s.png, s.name) + '<span class="name">' + esc(s.name) + '</span><span class="meta"><span class="chip ' + s.state + '">' + W[s.state] + '</span> <span class="dim">' + s.width + '&times;' + s.height + '</span></span></a>';
    }).join('') : '<p class="muted">Nothing in this view.</p>') + '</div>';
    html += '<div class="card">' + head('i-slot', 'Add a slot', 'A slot is one sprite or texture the app needs. Its id is what the developer\'s file is named (sprites/&lt;id&gt;.png). Size is fixed once art exists, so choose it carefully. Textures can be previewed tiled.') +
      '<form data-act="addslot" data-id="' + id + '"><div class="grid2"><label class="f">Id<input type="text" name="slot" required maxlength="64" pattern="[a-z0-9][a-z0-9_.\\-]*" placeholder="frog-stage-0"></label><label class="f">Name<input type="text" name="name" maxlength="80"></label>' +
      '<label class="f">Width<input type="number" name="width" min="1" max="512" required></label><label class="f">Height<input type="number" name="height" min="1" max="512" required></label>' +
      '<label class="f">Kind<select name="kind"><option value="sprite">sprite</option><option value="texture">texture</option></select></label><label class="f">Background<select name="bgMode"><option value="transparent">transparent</option><option value="opaque">opaque</option></select></label>' +
      '<label class="f">Category<input type="text" name="category" maxlength="40"></label><label class="check f"><input type="checkbox" name="tile" value="1"> Tiles seamlessly</label></div>' +
      '<label class="f">Notes for the developer<input type="text" name="notes" maxlength="500"></label><button class="btn" type="submit">Add slot</button></form></div>';
    html += '<div class="card">' + head('i-lset', 'Library settings', 'Rename the library or change which app it belongs to. The id stays the same so a developer\'s zip still matches. Deleting removes every slot and version from this browser and cannot be undone.') +
      '<form data-act="editlib" data-id="' + id + '"><div class="grid2"><label class="f">Name<input type="text" name="name" value="' + esc(lib.name) + '" required maxlength="80"></label><label class="f">App<input type="text" name="app" value="' + esc(lib.app) + '" maxlength="60"></label></div>' +
      '<label class="f">Description<input type="text" name="description" value="' + esc(lib.description) + '" maxlength="500"></label><button class="btn" type="submit">Save</button></form>' +
      '<form class="danger" data-act="dellib" data-id="' + id + '"><label class="f">Type <code>' + esc(lib.slug) + '</code> to delete this library<input type="text" name="confirm" autocomplete="off"></label><button class="btn warn" type="submit">Delete library</button></form></div>';
    if (exports.length) html += '<div class="card"><h3>Sent out</h3><ul class="plain">' + exports.map(function (e) { return '<li>' + when(e.createdAt) + ' &middot; ' + (e.kind === 'schema' ? 'schema for a developer' : e.complete ? 'finished library' : 'partial library, ' + e.humanized + ' of ' + e.total + ' humanized') + '</li>'; }).join('') + '</ul></div>';
    return html;
  }

  async function editorPage(id) {
    var s = await S.sprite(id);
    if (!s) return missing('That sprite is not here.');
    var lib = await S.library(s.libraryId), sibs = await S.sprites(s.libraryId), p = L.progress(sibs), at = sibs.findIndex(function (x) { return x.id === id; });
    var prev = sibs[at - 1], next = sibs[at + 1];
    var todo = sibs.slice(at + 1).concat(sibs.slice(0, at)).filter(function (x) { return x.state === 'raw' || x.state === 'touched'; })[0];
    var html = '<div id="editor" data-id="' + s.id + '">' +
      '<div class="crumbs"><a href="#/library/' + lib.id + '">&larr; ' + esc(lib.name) + '</a><span class="navs">' + (prev ? '<a class="btn ghost sm" href="#/sprite/' + prev.id + '">&lsaquo; Prev</a>' : '') + (next ? '<a class="btn ghost sm" href="#/sprite/' + next.id + '">Next &rsaquo;</a>' : '') + '</span></div>' +
      title('i-ed', s.name, 'Pen paints one pixel, drag to draw. Eraser clears to transparent (or to the background colour on an opaque sprite). Fill floods the connected area of one exact colour. Keys: B pen, E eraser, G fill, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Y redo. Nothing is stored until you press Save (leaving the page saves for you). To work from a picture, bring in a PNG of exactly ' + s.width + '&times;' + s.height + ' or drop it on the canvas. This slot is ' + s.width + '&times;' + s.height + (s.kind === 'texture' ? ', a texture' + (s.tile ? ' that tiles seamlessly' : '') : '') + '; its size cannot change because the developer\'s file must match it.') +
      '<p class="small"><span class="chip ' + s.state + '" id="statechip">' + W[s.state] + '</span> <span id="changed" class="dim">' + (s.changedPx ? s.changedPx + ' px redrawn' : '') + '</span> <span class="dim">&middot; ' + p.humanized + ' of ' + p.total + ' in the library humanized</span>' + (s.notes ? ' <span class="dim">&middot; ' + esc(s.notes) + '</span>' : '') + '</p>' +
      '<div class="workbench"><section class="canvaspane"><div class="toolbar" role="toolbar" aria-label="Tools"><button type="button" class="tool on" data-tool="pen" title="Pen (B)">Pen</button><button type="button" class="tool" data-tool="erase" title="Eraser (E)">Erase</button><button type="button" class="tool" data-tool="fill" title="Fill (G)">Fill</button><span class="sep"></span>' +
      '<button type="button" class="tool plain" id="undo" title="Undo (Ctrl+Z)" disabled>Undo</button><button type="button" class="tool plain" id="redo" title="Redo (Ctrl+Shift+Z)" disabled>Redo</button><span class="sep"></span><button type="button" class="tool plain" id="zoomout" title="Smaller">&minus;</button><button type="button" class="tool plain" id="zoomin" title="Larger">+</button><button type="button" class="tool plain on" id="gridbtn" title="Grid" aria-pressed="true">Grid</button></div>' +
      '<div id="stage" class="stage checker"><div class="stack"><canvas id="cv" aria-label="Sprite canvas"></canvas><canvas id="grid" aria-hidden="true"></canvas></div></div><p class="small dim" id="pos">&nbsp;</p>' +
      '<div class="row savebar"><button type="button" class="btn" id="save" disabled>Save</button>' + (next || todo ? '<button type="button" class="btn ghost" id="savenext">Save &amp; next</button>' : '') + '<label class="btn ghost" for="bring">Bring in a PNG</label><input type="file" id="bring" class="infotoggle" accept="image/png"><span id="status" class="small dim" role="status"></span></div></section>' +
      '<aside class="side">' +
      '<div class="card">' + head('i-col', 'Colour', 'Drag round the ring for the hue, inside the square for shade. Or type a hex code. Recent colours and the colours already used in this sprite are below; tap one to pick it up.') + '<div class="wheelwrap"><canvas id="wheel" width="208" height="208" aria-label="Colour wheel"></canvas></div><div class="row colrow"><span id="cur" class="swatch big" aria-label="Current colour"></span><input id="hex" type="text" maxlength="7" value="#B4452B" spellcheck="false" aria-label="Hex colour"></div><p class="label">Recent</p><div id="recent" class="swatches"></div><p class="label">In this sprite</p><div id="used" class="swatches"></div></div>' +
      '<div class="card">' + head('i-bg', 'Background', 'Transparent sprites show a checkerboard behind them. Opaque ones are fully filled: switching to opaque lays the background colour behind every see-through pixel (undo reverses it), and the eraser then paints the background colour. Switching back makes pixels of exactly that colour transparent again.') +
      '<div class="seg"><label><input type="radio" name="bg" value="transparent"' + (s.bgMode === 'transparent' ? ' checked' : '') + '> Transparent</label><label><input type="radio" name="bg" value="opaque"' + (s.bgMode === 'opaque' ? ' checked' : '') + '> Opaque</label></div><div class="row"><span id="bgsw" class="swatch"></span><input id="bgcolor" type="text" maxlength="7" value="' + esc(s.bgColor) + '" spellcheck="false" aria-label="Background colour"><button type="button" class="btn ghost sm" id="bguse">Use current</button></div></div>' +
      '<div class="card">' + head('i-pv', 'Preview', 'The sprite at its true size, enlarged, and beside the original art for comparison.' + (s.tile ? ' Textures are shown tiled three by three.' : '')) + '<div class="previews"><div><p class="label">Actual</p><div class="pvbox checker"><canvas id="pv1"></canvas></div></div><div><p class="label">Larger</p><div class="pvbox checker"><canvas id="pv3"></canvas></div></div><div><p class="label">Original</p><div class="pvbox checker"><canvas id="pvo"></canvas></div></div>' + (s.tile ? '<div><p class="label">Tiled</p><div class="pvbox checker"><canvas id="pvt"></canvas></div></div>' : '') + '</div></div>' +
      '<div class="card">' + head('i-sign', 'Sign off', 'Humanized means you looked at this sprite and it is yours: nothing sloppy left. It is a deliberate step, so editing a humanized sprite sets it back to redrawn until you sign it off again. Resetting puts the original art back (the redrawn version is kept in history).') +
      '<div class="row">' + (s.state === 'humanized' ? '<button class="btn ghost" type="button" data-do="state" data-action="unhumanize" data-id="' + s.id + '">Undo sign-off</button>' : s.state === 'empty' ? '<span class="small dim">Draw something first, or bring in a picture.</span>' : '<button class="btn good" type="button" data-do="state" data-action="humanize" data-id="' + s.id + '">Mark humanized</button>') +
      '<button class="btn ghost" type="button" data-do="state" data-action="reset" data-id="' + s.id + '" data-confirm="Put the original art back? The current picture stays in history.">Reset to original</button><a class="btn ghost" href="#/sprite/' + s.id + '/history">History</a></div></div>' +
      '<div class="card">' + head('i-meta', 'About this slot', 'The slot id is <code>' + esc(s.slot) + '</code> and the developer\'s file is sprites/' + esc(s.slot) + '.png. Notes are written into the schema you send out, so developers see them.') +
      '<form data-act="meta" data-id="' + s.id + '"><label class="f">Name<input type="text" name="name" value="' + esc(s.name) + '" maxlength="80"></label><div class="grid2"><label class="f">Kind<select name="kind"><option value="sprite"' + (s.kind === 'sprite' ? ' selected' : '') + '>sprite</option><option value="texture"' + (s.kind === 'texture' ? ' selected' : '') + '>texture</option></select></label>' +
      '<label class="f">Category<input type="text" name="category" value="' + esc(s.category) + '" maxlength="40"></label></div><label class="check f"><input type="checkbox" name="tile" value="1"' + (s.tile ? ' checked' : '') + '> Tiles seamlessly</label><label class="f">Notes<input type="text" name="notes" value="' + esc(s.notes) + '" maxlength="500"></label><button class="btn ghost" type="submit">Save details</button></form>' +
      '<form class="danger" data-act="delslot" data-id="' + s.id + '"><label class="check f"><input type="checkbox" name="confirm" value="1"> Remove this slot</label><button class="btn warn" type="submit">Remove</button></form></div>' +
      '</aside></div></div>';
    route.after = function () {
      editor = E.mount({
        sprite: { width: s.width, height: s.height, bgMode: s.bgMode, bgColor: s.bgColor, png: s.png, originalPng: s.originalPng },
        onSave: async function (r) {
          var state = await L.saveArt(S, s.id, r.png, r.changedPx, r.blank, r.edited, r.bgMode, r.bgColor), pr = L.progress(await S.sprites(s.libraryId));
          return { state: state, word: W[state], humanized: pr.humanized, total: pr.total, pct: pr.pct };
        },
        onNext: function () { var t = todo || next; go(t ? '#/sprite/' + t.id : '#/library/' + lib.id); }
      });
      window.__skipture = editor;
    };
    return html;
  }

  async function historyPage(id) {
    var s = await S.sprite(id);
    if (!s) return missing('That sprite is not here.');
    var revs = await S.revisions(id);
    return title('i-hist', s.name + ': earlier versions', 'Every save keeps the picture it replaced, newest first, up to ' + L.KEEP_REVISIONS + '. Restoring one keeps the current art as a version too, so nothing is lost either way.') +
      '<p><a class="btn ghost" href="#/sprite/' + id + '">Back to the editor</a></p><div class="grid">' + (revs.length ? revs.map(function (r) {
        return '<div class="tile">' + thumb(s, r.png, '') + '<span class="meta"><span class="chip ' + r.state + '">' + W[r.state] + '</span></span><span class="name">' + when(r.createdAt) + '</span><span class="dim">' + esc(r.note) + '</span><button class="btn ghost" type="button" data-do="restore" data-id="' + id + '" data-rev="' + r.id + '">Restore</button></div>';
      }).join('') : '<p class="muted">No earlier versions yet.</p>') + '</div>';
  }

  function importPage(report, error) {
    var html = title('i-import', 'Import', 'Choose or drop a library zip: either a developer\'s filled-in schema, or a library you exported before. If its library id matches one you already have, new art goes only into slots that are empty or still as received. Anything you redrew or humanized is kept. A zip for an unknown library creates it. The zip is read here in the browser and never uploaded.');
    if (error) html += '<div class="error">' + esc(error) + '</div>';
    if (report) {
      html += '<div class="card"><h3>' + (report.created ? 'Created' : 'Merged into') + ' ' + esc(report.library.name) + '</h3><p><strong>' + (report.added.length + report.updated.length) + '</strong> sprites taken in &middot; <strong>' + report.kept.length + '</strong> kept as yours &middot; <strong>' + report.skipped.length + '</strong> skipped &middot; <strong>' + report.problems.length + '</strong> problems</p><div class="row"><a class="btn" href="#/library/' + report.library.id + '">Open the library</a></div></div>';
      [['Problems', report.problems], ['Kept as yours', report.kept], ['Skipped', report.skipped], ['Taken in', report.added.concat(report.updated)]].forEach(function (g) {
        if (g[1].length) html += '<div class="card"><h3>' + g[0] + '</h3><ul class="plain">' + g[1].map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
      });
    }
    return html + '<div class="card">' + head('i-file', 'Choose a zip', 'The zip must have schema.json at the top and sprites/&lt;slot&gt;.png for each slot. Sizes must match the slots exactly. Up to 40 MB.') +
      '<div class="drop" id="drop"><label class="f">Library zip<input type="file" id="zipfile" accept=".zip,application/zip"></label><p class="small muted">or drop it here</p></div></div>';
  }

  function missing(msg) { return title('i-gone', 'Not found') + '<div class="card"><p>' + esc(msg) + '</p><div class="row"><a class="btn" href="#/">Back to the libraries</a></div></div>'; }

  // ---------------- routing ----------------
  function parse() {
    var h = location.hash.replace(/^#/, '') || '/', qs = {}, i = h.indexOf('?');
    if (i >= 0) { h.slice(i + 1).split('&').forEach(function (kv) { var p = kv.split('='); qs[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); h = h.slice(0, i); }
    return { parts: h.split('/').filter(Boolean), q: qs };
  }

  function route(extra) {
    routing = routing.then(function () { return render(extra); }).catch(function (e) { console.error(e); flash('Something went wrong: ' + e.message, true); });
    return routing;
  }

  async function render(extra) {
    if (editor) {
      if (editor.dirty()) await editor.save();
      editor.destroy(); editor = null; window.__skipture = null;
    }
    freeUrls(); route.after = null;
    var r = parse(), p = r.parts, html, page = p[0] || 'libraries', id = parseInt(p[1], 10);
    if (page === 'library' && id) html = await libraryPage(id, r.q);
    else if (page === 'sprite' && id && p[2] === 'history') html = await historyPage(id);
    else if (page === 'sprite' && id) html = await editorPage(id);
    else if (page === 'import') html = importPage(extra && extra.report, extra && extra.error);
    else if (page === 'libraries') html = await dashboard();
    else html = missing('There is no such page.');
    document.body.classList.toggle('editing', page === 'sprite' && !p[2]);
    main.className = 'wrap' + (page === 'sprite' && !p[2] ? ' wide' : '');
    main.innerHTML = html;
    var nav = page === 'import' ? '#/import' : '#/';
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) { if (a.getAttribute('href') === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = 'Skipture';
    window.scrollTo(0, 0);
    if (route.after) { route.after(); route.after = null; }
    if (page === 'import') wireImport();
  }

  // ---------------- actions ----------------
  function wireImport() {
    var drop = document.getElementById('drop'), input = document.getElementById('zipfile');
    function take(file) { if (!file) return; readFile(file).then(function (bytes) { return L.importZip(S, bytes); }).then(function (report) { route({ report: report }); }, function (e) { route({ error: e.message || 'Could not read that zip.' }); }); }
    input.addEventListener('change', function () { take(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { take(e.dataTransfer.files[0]); });
  }
  function readFile(file) {
    if (file.size > 40000000) return Promise.reject(new L.LibError('That zip is bigger than 40 MB.'));
    return file.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  var forms = {
    newlib: async function (f) { go('#/library/' + await L.createLibrary(S, f)); },
    editlib: async function (f, el) {
      var l = await S.library(+el.dataset.id), name = String(f.name || '').trim().slice(0, 80);
      if (!name) throw new L.LibError('Give the library a name.');
      l.name = name; l.app = String(f.app || '').trim().slice(0, 60); l.description = String(f.description || '').trim().slice(0, 500); l.updatedAt = L.iso(); await S.saveLibrary(l);
      flash('Saved.'); route();
    },
    dellib: async function (f, el) {
      var l = await S.library(+el.dataset.id);
      if (String(f.confirm || '').trim() !== l.slug) throw new L.LibError('To delete this library, type its id (' + l.slug + ') exactly.');
      await L.removeLibrary(S, l.id); flash('Library deleted.'); go('#/');
    },
    addslot: async function (f, el) { go('#/sprite/' + await L.addSlot(S, +el.dataset.id, { slot: f.slot, name: f.name, width: f.width, height: f.height, kind: f.kind, bgMode: f.bgMode, category: f.category, tile: f.tile === '1', notes: f.notes })); },
    meta: async function (f, el) {
      var s = await S.sprite(+el.dataset.id);
      s.name = String(f.name || '').trim().slice(0, 80) || s.name; s.kind = L.KINDS.indexOf(f.kind) >= 0 ? f.kind : s.kind; s.tile = f.tile === '1';
      s.category = String(f.category || '').trim().slice(0, 40); s.notes = String(f.notes || '').trim().slice(0, 500); s.updatedAt = L.iso();
      await S.saveSprite(s); await L.touchLibrary(S, s.libraryId); flash('Saved.'); route();
    },
    delslot: async function (f, el) {
      if (f.confirm !== '1') throw new L.LibError('Tick the box to confirm removing this slot.');
      var s = await S.sprite(+el.dataset.id); await S.removeSprite(s.id); await L.touchLibrary(S, s.libraryId); go('#/library/' + s.libraryId);
    }
  };

  var doing = {
    'export-schema': async function (el) { var r = await L.exportZip(S, +el.dataset.id, 'schema'); download(r.data, r.name); route(); },
    'export-library': async function (el) { var r = await L.exportZip(S, +el.dataset.id, 'library'); download(r.data, r.name); route(); },
    state: async function (el) {
      if (el.dataset.confirm && !window.confirm(el.dataset.confirm)) return;
      await L.setState(S, +el.dataset.id, el.dataset.action); route();
    },
    restore: async function (el) { await L.restoreRevision(S, +el.dataset.id, +el.dataset.rev); go('#/sprite/' + el.dataset.id); },
    sample: async function () { go('#/library/' + await makeSample()); }
  };

  document.addEventListener('submit', function (e) {
    var el = e.target, act = el.dataset && el.dataset.act;
    if (!act) return;
    e.preventDefault();
    var f = {}; new FormData(el).forEach(function (v, k) { f[k] = v; });
    forms[act](f, el).catch(function (err) { flash(err.message || 'That did not work.', true); });
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-do]');
    if (!el) return;
    e.preventDefault();
    doing[el.dataset.do](el).catch(function (err) { flash(err.message || 'That did not work.', true); });
  });
  window.addEventListener('hashchange', function () { route(); });

  // a small made-up library so there is something to try
  async function makeSample() {
    var id = await L.createLibrary(S, { name: 'Sample sprites', app: 'Sample', description: 'Made-up art to try the editor on. Delete it when you are done.' });
    var defs = [['bean', 'Bean', 8, 8, 'sprite'], ['crate', 'Crate', 8, 8, 'sprite'], ['bricks', 'Bricks', 8, 8, 'texture']];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i], px = new Uint8Array(d[2] * d[3] * 4);
      for (var y = 0; y < d[3]; y++) for (var x = 0; x < d[2]; x++) {
        var o = (y * d[2] + x) * 4, inside = d[0] === 'bean' ? Math.pow(x - 3.5, 2) / 10 + Math.pow(y - 3.5, 2) / 14 < 1 : true, v = d[0] === 'bricks' ? ((y % 4 === 0 || (x + (y >> 2) * 4) % 8 === 0) ? 90 : 170) : d[0] === 'crate' ? ((x === 0 || y === 0 || x === 7 || y === 7 || x === y) ? 100 : 180) : 150;
        if (inside) { px[o] = v + 40; px[o + 1] = v; px[o + 2] = v - 60 < 0 ? 20 : v - 60; px[o + 3] = 255; }
      }
      await L.addSlot(S, id, { slot: d[0], name: d[1], width: d[2], height: d[3], kind: d[4], tile: d[4] === 'texture', art: await L.encodePng(d[2], d[3], px), origin: 'sample' });
    }
    return id;
  }

  // ---------------- start ----------------
  window.SkipApp = { route: route };
  SkipStore.open().then(function (store) {
    S = store; window.__store = S;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { /* fine */ });
    if (!S.persistent) flash('This browser would not let Skipture keep files, so your work will be lost when you close the tab. Export what you want to keep.', true);
    route();
  });
})();
