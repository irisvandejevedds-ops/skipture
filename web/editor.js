/* Skipture editor: the canvas, tools, colour wheel, background handling and saving. The pixel logic lives in core.js. */
(function (global) {
  'use strict';
  var C = global.SkipCore, Doc = C.Doc, L = global.SkipLib;

  /** Brings the editor in the page to life. o = {sprite, onSave(result), onNext()}. Returns {dirty, save, destroy}. */
  function mount(o) {
  var root = document.getElementById('editor');
  var sprite = o.sprite, W = sprite.width, H = sprite.height;
  var offs = [], ro = !!o.readOnly;
  function listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); offs.push(function () { target.removeEventListener(type, fn, opts); }); }
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), gridCv = $('grid'), stage = $('stage'), ctx = cv.getContext('2d', { willReadFrequently: true });
  cv.width = W; cv.height = H;

  var doc = null, orig = null, img = null;
  var tool = 'pen', color = C.hexToColor('#1A9C98'), hsv = C.colorToHsv(color);
  var bgMode = sprite.bgMode, bgColor = C.hexToColor(sprite.bgColor) || C.pack(255, 255, 255, 255);
  var zoom = 8, showGrid = true, metaDirty = false, saving = false;
  var drawing = false, last = null;

  // ---------- loading ----------
  function loadPixels(bytes) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), im = new Image();
      im.onload = function () {
        var c = document.createElement('canvas'); c.width = W; c.height = H;
        var x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0);
        URL.revokeObjectURL(url);
        resolve(Doc.fromRGBA(W, H, x.getImageData(0, 0, W, H).data));
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('could not read the picture')); };
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
    var availW = Math.max(120, stage.clientWidth - 24), availH = stage.clientHeight > 150 ? stage.clientHeight - 24 : 480;
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
  var prevTool = 'pen', picking = false;
  function setTool(t) {
    if (t === 'pick' && tool !== 'pick') prevTool = tool;
    tool = t;
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    cv.style.cursor = t === 'fill' ? 'cell' : t === 'pick' ? 'copy' : 'crosshair';
  }
  function paintValue() { return tool === 'erase' ? Doc.eraseValue(bgMode, bgColor) : color; }

  function cell(e) {
    var r = cv.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) * W / r.width), Math.floor((e.clientY - r.top) * H / r.height)];
  }
  function afterStroke(changed) { if (changed) { if (tool === 'pen') recent(color); refreshUI(); } }

  // One finger (or a mouse, or a pen) draws. A second finger turns the gesture into pan and zoom, and whatever the first finger had started is taken back.
  var pts = {}, pinch = null, pendingFill = null;
  function nPts() { return Object.keys(pts).length; }
  function twoPts() { var k = Object.keys(pts); return [pts[k[0]], pts[k[1]]]; }
  function pickAt(p) {
    if (!doc.inBounds(p[0], p[1])) return;
    var c = doc.get(p[0], p[1]);
    if (C.alpha(c) === 0) { $('status').textContent = 'That pixel is transparent, so there is no colour to pick.'; return; }
    setColor(C.pack(C.red(c), C.green(c), C.blue(c), 255));
    $('status').textContent = 'Picked ' + C.colorToHex(c) + '.';
  }
  function abortStroke() {
    picking = false;
    if (drawing) {
      drawing = false; last = null;
      var s = doc.endStroke();
      if (s) { var op = doc.undo(); doc.redoStack.length = 0; if (op) pushToCanvas(op.idx); refreshUI(); }
    }
    pendingFill = null;
  }
  function pinchState() { var p = twoPts(); return { d: Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)), mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2 }; }
  function doFill(p) { var ch = doc.fill(p[0], p[1], color); if (ch.length) { pushToCanvas(ch); recent(color); refreshUI(); } }

  cv.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch' && e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    pts[e.pointerId] = { x: e.clientX, y: e.clientY, type: e.pointerType };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
    if (nPts() >= 2) { abortStroke(); if (nPts() === 2) pinch = pinchState(); return; }
    if (tool === 'pick' || (e.altKey && e.pointerType !== 'touch')) { picking = true; pickAt(cell(e)); return; }     // the dropper, or Alt with any tool
    if (ro) return;
    var p = cell(e);
    if (tool === 'fill') {
      if (e.pointerType === 'touch') pendingFill = { p: p, x: e.clientX, y: e.clientY };     // wait: this may be the start of a pinch
      else doFill(p);
      return;
    }
    drawing = true; last = p;
    doc.beginStroke();
    var v = paintValue();
    if (doc.paint(p[0], p[1], v)) pushToCanvas([p[1] * W + p[0]]);
  });
  cv.addEventListener('pointermove', function (e) {
    if (pts[e.pointerId]) { pts[e.pointerId].x = e.clientX; pts[e.pointerId].y = e.clientY; }
    if (pinch && nPts() === 2) {
      var n = pinchState(), r = cv.getBoundingClientRect(), ux = (pinch.mx - r.left) / zoom, uy = (pinch.my - r.top) / zoom;
      zoom = Math.max(1, Math.min(40, zoom * n.d / pinch.d));
      layout();
      var r2 = cv.getBoundingClientRect();
      stage.scrollLeft += (r2.left + ux * zoom) - n.mx; stage.scrollTop += (r2.top + uy * zoom) - n.my;
      pinch = n;
      return;
    }
    if (picking) { pickAt(cell(e)); return; }
    if (pendingFill && Math.hypot(e.clientX - pendingFill.x, e.clientY - pendingFill.y) > 12) pendingFill = null;
    var p = cell(e);
    if (doc && doc.inBounds(p[0], p[1])) { var c = doc.get(p[0], p[1]); $('pos').textContent = p[0] + ', ' + p[1] + (C.alpha(c) ? '  ' + C.colorToHex(c) : '  transparent'); }
    if (!drawing) return;
    var cs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (!cs.length) cs = [e];
    var v = paintValue();
    cs.forEach(function (pe) {
      var q = cell(pe);
      if (q[0] === last[0] && q[1] === last[1]) return;
      var ch = doc.line(last[0], last[1], q[0], q[1], v); last = q;
      if (ch.length) pushToCanvas(ch);
    });
  });
  function endDraw(e) {
    var had = e && pts[e.pointerId];
    if (e) delete pts[e.pointerId];
    if (picking && !pinch) { picking = false; if (tool === 'pick') setTool(prevTool); return; }       // after a pick the pen (or whatever you had) comes back
    if (pinch) { if (nPts() < 2) pinch = null; return; }          // lifting a finger after a pinch never draws
    if (pendingFill && e && e.type === 'pointerup' && had) { var f = pendingFill; pendingFill = null; doFill(f.p); return; }
    pendingFill = null;
    if (!drawing) return;
    drawing = false; last = null;
    afterStroke(doc.endStroke());
  }
  cv.addEventListener('pointerup', endDraw); cv.addEventListener('pointercancel', function (e) { if (nPts() <= 1 && !pinch) abortStroke(); endDraw(e); });
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
    $('cur').style.background = C.colorToHex(c); $('colsw').style.background = C.colorToHex(c); $('hex').value = C.colorToHex(c);
    drawWheel();
  }
  function fromHsv() { color = C.hsvToColor(hsv.h, hsv.s, hsv.v); $('cur').style.background = C.colorToHex(color); $('colsw').style.background = C.colorToHex(color); $('hex').value = C.colorToHex(color); drawWheel(); }
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

  // ---------- the colour pop-out ----------
  var pop = $('colpop'), colbtn = $('colbtn');
  function showPop(on) { pop.hidden = !on; if (on) { pop.style.top = (colbtn.offsetTop + colbtn.offsetHeight + 8) + 'px'; pop.style.left = Math.max(0, Math.min(colbtn.offsetLeft, (pop.offsetParent || root).clientWidth - pop.offsetWidth - 4)) + 'px'; } colbtn.setAttribute('aria-expanded', String(on)); colbtn.classList.toggle('on', on); if (on) drawWheel(); }
  colbtn.addEventListener('click', function (e) { e.stopPropagation(); showPop(pop.hidden); });
  listen(document, 'pointerdown', function (e) { if (!pop.hidden && !pop.contains(e.target) && !colbtn.contains(e.target)) showPop(false); });
  listen(document, 'keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { showPop(false); colbtn.focus(); } });
  colbtn.addEventListener('keydown', function () { /* default button behaviour */ });

  // ---------- saving ----------
  function save() {
    if (saving || ro) return Promise.resolve(false);
    saving = true; refreshUI();
    var changed = doc.changedFrom(orig.px), edited = doc.isEdited(), blank = doc.isBlank();
    return L.encodePng(W, H, doc.toRGBA())
      .then(function (bytes) { return o.onSave({ png: bytes, changedPx: changed, edited: edited, blank: blank, bgMode: bgMode, bgColor: C.colorToHex(bgColor) }); })
      .then(function (j) {
        doc.markSaved(); metaDirty = false; saving = false;
        var chip = $('statechip'); chip.className = 'chip ' + j.state; chip.textContent = j.word;
        $('status').dataset.msg = 'Saved. ' + j.humanized + ' of ' + j.total + ' humanized (' + j.pct + '%).';
        if ($('changed')) refreshUI(); return true;
      })
      .catch(function (err) { saving = false; refreshUI(); $('status').textContent = 'Could not save: ' + err.message; return false; });
  }
  $('save').addEventListener('click', save);
  if ($('savenext')) $('savenext').addEventListener('click', function () { save().then(function (ok) { if (ok) o.onNext(); }); });

  function dirty() { return !!doc && (doc.isEdited() || metaDirty); }
  listen(window, 'beforeunload', function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- bringing in a picture ----------
  function bring(file) {
    if (!file || ro) return;
    if (!/\.png$/i.test(file.name) && file.type !== 'image/png') { $('status').textContent = 'That is not a PNG picture.'; return; }
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      URL.revokeObjectURL(url);
      if (im.naturalWidth !== W || im.naturalHeight !== H) { $('status').textContent = 'That picture is ' + im.naturalWidth + '\u00d7' + im.naturalHeight + ', but this slot is ' + W + '\u00d7' + H + '.'; return; }
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
      var fresh = Doc.fromRGBA(W, H, x.getImageData(0, 0, W, H).data), n = 0;
      doc.beginStroke();
      for (var i = 0; i < fresh.px.length; i++) if (doc.paint(i % W, (i - (i % W)) / W, fresh.px[i])) n++;
      doc.endStroke(); pushToCanvas(null); refreshUI();
      $('status').textContent = n ? 'Picture brought in. Press Save to keep it.' : 'That picture is the same as what is here.';
    };
    im.onerror = function () { URL.revokeObjectURL(url); $('status').textContent = 'Could not read that picture.'; };
    im.src = url;
  }
  if ($('bring')) $('bring').addEventListener('change', function () { bring(this.files[0]); this.value = ''; });
  stage.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
  stage.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); bring(e.dataTransfer.files[0]); } });

  // ---------- buttons and keys ----------
  Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
  $('undo').addEventListener('click', undo); $('redo').addEventListener('click', redo);
  $('zoomin').addEventListener('click', function () { zoom = Math.min(40, zoom + (zoom < 8 ? 1 : 2)); layout(); });
  $('zoomout').addEventListener('click', function () { zoom = Math.max(1, zoom - (zoom <= 8 ? 1 : 2)); layout(); });
  $('gridbtn').addEventListener('click', function () { showGrid = !showGrid; layout(); });
  listen(document, 'keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 's') { e.preventDefault(); save(); }
    else if (!mod && k === 'b') setTool('pen'); else if (!mod && k === 'e') setTool('erase'); else if (!mod && k === 'g') setTool('fill'); else if (!mod && k === 'i') setTool('pick');
  });

  // ---------- go ----------
  var lastStageW = 0;
  listen(window, 'resize', function () { if (doc && Math.abs(stage.clientWidth - lastStageW) > 40) { lastStageW = stage.clientWidth; fitZoom(); layout(); } });
  var api = { dirty: dirty, save: save, destroy: function () { offs.forEach(function (f) { f(); }); offs = []; } };
  Promise.all([loadPixels(sprite.png), loadPixels(sprite.originalPng)]).then(function (docs) {
    doc = docs[0]; orig = docs[1];
    img = ctx.createImageData(W, H);
    pushToCanvas(null);
    setBg(bgMode, bgColor, true);
    if (bgMode === 'opaque') stage.classList.remove('checker');
    var oc = $('pvo'); oc.width = W; oc.height = H; oc.getContext('2d').putImageData((function () { var d = ctx.createImageData(W, H); orig.toRGBA(d.data); return d; })(), 0, 0);
    var ok = Math.max(2, Math.min(6, Math.floor(160 / Math.max(W, H)) || 2)); oc.style.width = W * ok + 'px'; oc.style.height = H * ok + 'px';
    fitZoom(); layout(); setTool('pen'); setColor(color); drawRecent(); refreshUI();
    if (ro) Array.prototype.forEach.call(document.querySelectorAll('.tools .tbtn:not(#zoomin):not(#zoomout):not(#gridbtn):not(#colbtn), #save, #savenext'), function (b) { b.disabled = true; });
    root.dataset.ready = '1';
    api.test = { doc: doc, undo: undo, redo: redo, setTool: setTool, setColor: setColor, setBg: function (m) { var r = document.querySelector('input[name=bg][value=' + m + ']'); r.checked = true; r.dispatchEvent(new Event('change')); } };
  }).catch(function (err) { $('status').textContent = 'Could not load this sprite: ' + err.message; });
  return api;
  }

  global.SkipEditor = { mount: mount };
})(window);
