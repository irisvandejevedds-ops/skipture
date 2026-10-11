/* Skipture editor: the canvas, tools, colour wheel, background handling and saving. The pixel logic lives in core.js. */
(function () {
  'use strict';
  var C = window.SkipCore, Doc = C.Doc;
  var root = document.getElementById('editor');
  if (!root || !C) return;

  var W = +root.dataset.w, H = +root.dataset.h;
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), gridCv = $('grid'), stage = $('stage'), ctx = cv.getContext('2d', { willReadFrequently: true });
  cv.width = W; cv.height = H;

  var doc = null, orig = null, img = null;
  var tool = 'pen', color = C.hexToColor('#B4452B'), hsv = C.colorToHsv(color);
  var bgMode = root.dataset.bgMode, bgColor = C.hexToColor(root.dataset.bgColor) || C.pack(255, 255, 255, 255);
  var zoom = 8, showGrid = true, metaDirty = false, saving = false;
  var drawing = false, last = null;

  // ---------- loading ----------
  function loadPixels(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () {
        var c = document.createElement('canvas'); c.width = W; c.height = H;
        var x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0);
        resolve(Doc.fromRGBA(W, H, x.getImageData(0, 0, W, H).data));
      };
      im.onerror = function () { reject(new Error('could not load ' + url)); };
      im.src = url;
    });
  }

  // ---------- drawing the canvas ----------
  function pushToCanvas(indexes) {
    var all = !indexes;
    if (all) { img = ctx.createImageData(W, H); doc.toRGBA(img.data); ctx.putImageData(img, 0, 0); return; }
    for (var k = 0; k < indexes.length; k++) {
      var i = indexes[k], c = doc.px[i], o = i * 4;
      img.data[o] = C.red(c); img.data[o + 1] = C.green(c); img.data[o + 2] = C.blue(c); img.data[o + 3] = C.alpha(c);
      ctx.putImageData(img, 0, 0, i % W, Math.floor(i / W), 1, 1);
    }
  }

  function layout() {
    cv.style.width = W * zoom + 'px'; cv.style.height = H * zoom + 'px';
    gridCv.style.width = W * zoom + 'px'; gridCv.style.height = H * zoom + 'px';
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    gridCv.width = Math.round(W * zoom * dpr); gridCv.height = Math.round(H * zoom * dpr);
    var g = gridCv.getContext('2d'); g.clearRect(0, 0, gridCv.width, gridCv.height);
    if (showGrid && zoom >= 6) {
      var step = zoom * dpr; g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1; g.beginPath();
      for (var x = 1; x < W; x++) { g.moveTo(Math.round(x * step) + .5, 0); g.lineTo(Math.round(x * step) + .5, gridCv.height); }
      for (var y = 1; y < H; y++) { g.moveTo(0, Math.round(y * step) + .5); g.lineTo(gridCv.width, Math.round(y * step) + .5); }
      g.stroke();
    }
    $('gridbtn').classList.toggle('on', showGrid); $('gridbtn').setAttribute('aria-pressed', String(showGrid));
  }

  function fitZoom() {
    var availW = Math.max(120, Math.min(stage.clientWidth - 20, 760)), availH = 620;
    zoom = Math.max(1, Math.min(32, Math.floor(Math.min(availW / W, availH / H))));
  }

  function previews() {
    var pv1 = $('pv1'), pv3 = $('pv3');
    pv1.width = W; pv1.height = H; pv1.getContext('2d').clearRect(0, 0, W, H); pv1.getContext('2d').drawImage(cv, 0, 0);
    var k = Math.max(2, Math.min(6, Math.floor(160 / Math.max(W, H)) || 2));
    pv3.width = W; pv3.height = H; pv3.style.width = W * k + 'px'; pv3.style.height = H * k + 'px';
    pv3.getContext('2d').clearRect(0, 0, W, H); pv3.getContext('2d').drawImage(cv, 0, 0);
    var pvt = $('pvt');
    if (pvt) {
      pvt.width = W * 3; pvt.height = H * 3; var t = pvt.getContext('2d');
      for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) t.drawImage(cv, a * W, b * H);
      var tk = Math.max(1, Math.min(4, Math.floor(180 / (W * 3)) || 1)); pvt.style.width = W * 3 * tk + 'px'; pvt.style.height = H * 3 * tk + 'px';
    }
  }

  // ---------- state of the page ----------
  function refreshUI() {
    $('undo').disabled = !doc.canUndo(); $('redo').disabled = !doc.canRedo();
    var edited = doc.isEdited() || metaDirty;
    $('save').disabled = !edited && !saving;
    if ($('savenext')) $('savenext').disabled = saving;
    $('status').textContent = saving ? 'Saving…' : edited ? 'Unsaved changes' : $('status').dataset.msg || '';
    if (!edited && !saving) delete $('status').dataset.msg;
    $('changed').textContent = (function () { var n = doc.changedFrom(orig.px); return n ? n + ' px redrawn' : ''; })();
    previews(); usedColors();
  }

  function usedColors() {
    var box = $('used'); box.textContent = '';
    doc.colors(24).forEach(function (e) { box.appendChild(swatch(e[0])); });
    if (!box.firstChild) { var s = document.createElement('span'); s.className = 'dim small'; s.textContent = 'nothing drawn yet'; box.appendChild(s); }
  }
  function swatch(c) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.style.background = C.colorToHex(c); b.title = C.colorToHex(c);
    if (C.alpha(c) < 255) b.style.opacity = String(C.alpha(c) / 255);
    b.addEventListener('click', function () { setColor(c); });
    return b;
  }
  function recent(c) {
    var list = [];
    try { list = JSON.parse(localStorage.getItem('skipture.recent') || '[]'); } catch (e) { list = []; }
    var hex = C.colorToHex(c); list = [hex].concat(list.filter(function (x) { return x !== hex; })).slice(0, 14);
    try { localStorage.setItem('skipture.recent', JSON.stringify(list)); } catch (e) { /* private mode */ }
    drawRecent();
  }
  function drawRecent() {
    var box = $('recent'); box.textContent = '';
    var list = []; try { list = JSON.parse(localStorage.getItem('skipture.recent') || '[]'); } catch (e) { list = []; }
    list.forEach(function (h) { var c = C.hexToColor(h); if (c) box.appendChild(swatch(c)); });
    if (!box.firstChild) { var s = document.createElement('span'); s.className = 'dim small'; s.textContent = 'none yet'; box.appendChild(s); }
  }

  // ---------- tools ----------
  function setTool(t) {
    tool = t;
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    cv.style.cursor = t === 'fill' ? 'cell' : 'crosshair';
  }
  function paintValue() { return tool === 'erase' ? Doc.eraseValue(bgMode, bgColor) : color; }

  function cell(e) {
    var r = cv.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) * W / r.width), Math.floor((e.clientY - r.top) * H / r.height)];
  }
  function afterStroke(changed) { if (changed) { if (tool === 'pen') recent(color); refreshUI(); } }

  cv.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    var p = cell(e);
    if (tool === 'fill') {
      var ch = doc.fill(p[0], p[1], color);
      if (ch.length) { pushToCanvas(ch); recent(color); refreshUI(); }
      return;
    }
    drawing = true; last = p; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
    doc.beginStroke();
    var v = paintValue();
    if (doc.paint(p[0], p[1], v)) pushToCanvas([p[1] * W + p[0]]);
  });
  cv.addEventListener('pointermove', function (e) {
    var p = cell(e);
    if (doc && doc.inBounds(p[0], p[1])) { var c = doc.get(p[0], p[1]); $('pos').textContent = p[0] + ', ' + p[1] + (C.alpha(c) ? '  ' + C.colorToHex(c) : '  transparent'); }
    if (!drawing) return;
    var pts = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (!pts.length) pts = [e];
    var v = paintValue();
    pts.forEach(function (pe) {
      var q = cell(pe);
      if (q[0] === last[0] && q[1] === last[1]) return;
      var ch = doc.line(last[0], last[1], q[0], q[1], v); last = q;
      if (ch.length) pushToCanvas(ch);
    });
  });
  function endDraw() {
    if (!drawing) return;
    drawing = false; last = null;
    afterStroke(doc.endStroke());
  }
  cv.addEventListener('pointerup', endDraw); cv.addEventListener('pointercancel', endDraw);
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function applyMeta(op, forward) {
    if (!op || !op.meta) return;
    var m = forward ? op.meta.next : op.meta.prev;
    if (!m) return;
    setBg(m.mode, C.hexToColor(m.color) || bgColor, true);
  }
  function undo() { if (drawing) return; var op = doc.undo(); if (!op) return; pushToCanvas(op.idx); applyMeta(op, false); refreshUI(); }
  function redo() { if (drawing) return; var op = doc.redo(); if (!op) return; pushToCanvas(op.idx); applyMeta(op, true); refreshUI(); }

  // ---------- background ----------
  function setBg(mode, c, silent) {
    bgMode = mode; bgColor = c;
    document.querySelector('input[name=bg][value=' + mode + ']').checked = true;
    $('bgcolor').value = C.colorToHex(c); $('bgsw').style.background = C.colorToHex(c);
    stage.classList.toggle('checker', mode === 'transparent');
    if (!silent) metaDirty = true;
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name=bg]'), function (r) {
    r.addEventListener('change', function () {
      var mode = r.value; if (mode === bgMode) return;
      var prev = { mode: bgMode, color: C.colorToHex(bgColor) };
      var op = mode === 'opaque' ? doc.flatten(bgColor, prev) : doc.unflatten(bgColor, prev);
      bgMode = mode; metaDirty = true; setBg(mode, bgColor);
      pushToCanvas(op ? op.idx : []); refreshUI();
    });
  });
  $('bgcolor').addEventListener('change', function () { var c = C.hexToColor(this.value); if (c) { bgColor = c; setBg(bgMode, c); refreshUI(); } else this.value = C.colorToHex(bgColor); });
  $('bguse').addEventListener('click', function () { bgColor = color; setBg(bgMode, color); refreshUI(); });

  // ---------- colour wheel ----------
  var wheel = $('wheel'), wx = wheel.getContext('2d'), WS = wheel.width, CX = WS / 2, R = WS / 2 - 4, RI = R - 24, SQ = Math.floor(2 * (RI - 6) / Math.SQRT2), SQ0 = Math.round(CX - SQ / 2);
  var ring = null, wmode = null;
  function buildRing() {
    ring = wx.createImageData(WS, WS);
    for (var y = 0; y < WS; y++) for (var x = 0; x < WS; x++) {
      var dx = x + .5 - CX, dy = y + .5 - CX, d = Math.sqrt(dx * dx + dy * dy);
      if (d > RI && d < R) {
        var a = Math.atan2(dy, dx) * 180 / Math.PI, c = C.hsvToColor(a, 1, 1), o = (y * WS + x) * 4;
        var edge = Math.min(1, R - d, d - RI);
        ring.data[o] = C.red(c); ring.data[o + 1] = C.green(c); ring.data[o + 2] = C.blue(c); ring.data[o + 3] = Math.round(255 * edge);
      }
    }
  }
  function drawWheel() {
    if (!ring) buildRing();
    wx.clearRect(0, 0, WS, WS); wx.putImageData(ring, 0, 0);
    var sq = wx.createImageData(SQ, SQ);
    for (var y = 0; y < SQ; y++) for (var x = 0; x < SQ; x++) {
      var c = C.hsvToColor(hsv.h, x / (SQ - 1), 1 - y / (SQ - 1)), o = (y * SQ + x) * 4;
      sq.data[o] = C.red(c); sq.data[o + 1] = C.green(c); sq.data[o + 2] = C.blue(c); sq.data[o + 3] = 255;
    }
    wx.putImageData(sq, SQ0, SQ0);
    function ringMark(x, y) { wx.beginPath(); wx.arc(x, y, 6, 0, 6.2832); wx.lineWidth = 3; wx.strokeStyle = '#fff'; wx.stroke(); wx.lineWidth = 1; wx.strokeStyle = '#000'; wx.stroke(); }
    var a = hsv.h * Math.PI / 180, rm = (R + RI) / 2;
    ringMark(CX + Math.cos(a) * rm, CX + Math.sin(a) * rm);
    ringMark(SQ0 + hsv.s * (SQ - 1), SQ0 + (1 - hsv.v) * (SQ - 1));
  }
  function setColor(c, keepHue) {
    color = c;
    var h = C.colorToHsv(c);
    hsv = keepHue ? { h: hsv.h, s: h.s, v: h.v } : (h.s === 0 || h.v === 0 ? { h: hsv.h, s: h.s, v: h.v } : h);
    $('cur').style.background = C.colorToHex(c); $('hex').value = C.colorToHex(c);
    drawWheel();
  }
  function fromHsv() { color = C.hsvToColor(hsv.h, hsv.s, hsv.v); $('cur').style.background = C.colorToHex(color); $('hex').value = C.colorToHex(color); drawWheel(); }
  function wheelPoint(e) {
    var r = wheel.getBoundingClientRect(), sx = WS / r.width;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sx];
  }
  function wheelMove(e) {
    var p = wheelPoint(e), dx = p[0] - CX, dy = p[1] - CX;
    if (wmode === 'hue') { hsv.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; }
    else { hsv.s = Math.max(0, Math.min(1, (p[0] - SQ0) / (SQ - 1))); hsv.v = Math.max(0, Math.min(1, 1 - (p[1] - SQ0) / (SQ - 1))); }
    fromHsv();
  }
  wheel.addEventListener('pointerdown', function (e) {
    var p = wheelPoint(e), d = Math.hypot(p[0] - CX, p[1] - CX);
    if (d >= RI - 3 && d <= R + 3) wmode = 'hue';
    else if (p[0] >= SQ0 - 4 && p[0] <= SQ0 + SQ + 4 && p[1] >= SQ0 - 4 && p[1] <= SQ0 + SQ + 4) wmode = 'sv';
    else return;
    e.preventDefault(); try { wheel.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } wheelMove(e);
  });
  wheel.addEventListener('pointermove', function (e) { if (wmode) wheelMove(e); });
  wheel.addEventListener('pointerup', function () { wmode = null; });
  wheel.addEventListener('pointercancel', function () { wmode = null; });
  $('hex').addEventListener('change', function () { var c = C.hexToColor(this.value); if (c) setColor(c); else this.value = C.colorToHex(color); });

  // ---------- saving ----------
  function blobOf() {
    return new Promise(function (resolve) {
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d'), d = x.createImageData(W, H); doc.toRGBA(d.data); x.putImageData(d, 0, 0);
      c.toBlob(resolve, 'image/png');
    });
  }
  function save() {
    if (saving) return Promise.resolve(false);
    saving = true; refreshUI();
    var headers = { 'Content-Type': 'image/png', 'X-Skipture-Changed': String(doc.changedFrom(orig.px)), 'X-Skipture-Edited': doc.isEdited() ? '1' : '0',
      'X-Skipture-Blank': doc.isBlank() ? '1' : '0', 'X-Skipture-Bg': bgMode, 'X-Skipture-Bg-Color': C.colorToHex(bgColor) };
    return blobOf().then(function (blob) { return fetch(root.dataset.save, { method: 'POST', headers: headers, body: blob, credentials: 'same-origin' }); })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'save failed'); return j; }); })
      .then(function (j) {
        doc.markSaved(); metaDirty = false; saving = false;
        var chip = $('statechip'); chip.className = 'chip ' + j.state; chip.textContent = j.state_word;
        $('status').dataset.msg = 'Saved. ' + j.humanized + ' of ' + j.total + ' humanized (' + j.pct + '%).';
        refreshUI(); return true;
      })
      .catch(function (err) { saving = false; refreshUI(); $('status').textContent = 'Could not save: ' + err.message; return false; });
  }
  $('save').addEventListener('click', save);
  if ($('savenext')) $('savenext').addEventListener('click', function () { save().then(function (ok) { if (ok) location.href = root.dataset.todo || root.dataset.next || root.dataset.lib; }); });

  // leaving with unsaved work: ask. Links and forms that navigate away go through the same check.
  function dirty() { return doc && (doc.isEdited() || metaDirty); }
  window.addEventListener('beforeunload', function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  Array.prototype.forEach.call(document.querySelectorAll('form[data-guard-form]'), function (f) {
    f.addEventListener('submit', function (e) { if (!dirty()) return; e.preventDefault(); save().then(function (ok) { if (ok) f.submit(); }); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('form[data-confirm]'), function (f) {
    f.addEventListener('submit', function (e) { if (!window.confirm(f.dataset.confirm)) e.preventDefault(); });
  });

  // ---------- buttons and keys ----------
  Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
  $('undo').addEventListener('click', undo); $('redo').addEventListener('click', redo);
  $('zoomin').addEventListener('click', function () { zoom = Math.min(40, zoom + (zoom < 8 ? 1 : 2)); layout(); });
  $('zoomout').addEventListener('click', function () { zoom = Math.max(1, zoom - (zoom <= 8 ? 1 : 2)); layout(); });
  $('gridbtn').addEventListener('click', function () { showGrid = !showGrid; layout(); });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 's') { e.preventDefault(); save(); }
    else if (!mod && k === 'b') setTool('pen'); else if (!mod && k === 'e') setTool('erase'); else if (!mod && k === 'g') setTool('fill');
  });

  // ---------- go ----------
  Promise.all([loadPixels(root.dataset.png), loadPixels(root.dataset.original)]).then(function (docs) {
    doc = docs[0]; orig = docs[1];
    img = ctx.createImageData(W, H);
    pushToCanvas(null);
    setBg(bgMode, bgColor, true);
    if (bgMode === 'opaque') stage.classList.remove('checker');
    var o = $('pvo'); o.width = W; o.height = H; o.getContext('2d').putImageData((function () { var d = ctx.createImageData(W, H); orig.toRGBA(d.data); return d; })(), 0, 0);
    var ok = Math.max(2, Math.min(6, Math.floor(160 / Math.max(W, H)) || 2)); o.style.width = W * ok + 'px'; o.style.height = H * ok + 'px';
    fitZoom(); layout(); setTool('pen'); setColor(color); drawRecent(); refreshUI();
    root.dataset.ready = '1';
    window.__skipture = { doc: doc, save: save, undo: undo, redo: redo, setTool: setTool, setColor: setColor, setBg: function (m) { var r = document.querySelector('input[name=bg][value=' + m + ']'); r.checked = true; r.dispatchEvent(new Event('change')); } };
  }).catch(function (err) { $('status').textContent = 'Could not load this sprite: ' + err.message; });
  var lastStageW = 0;
  window.addEventListener('resize', function () { if (doc && Math.abs(stage.clientWidth - lastStageW) > 40) { lastStageW = stage.clientWidth; fitZoom(); layout(); } });
})();
