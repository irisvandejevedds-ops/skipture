/* Skipture editor core: pixels, strokes, undo and redo, flood fill, background handling. No DOM, so it can be tested in node. */
(function (root) {
  'use strict';

  var MAX_UNDO = 300;

  function pack(r, g, b, a) { return (((a << 24) | (b << 16) | (g << 8) | r) >>> 0); }
  function red(c) { return c & 255; }
  function green(c) { return (c >>> 8) & 255; }
  function blue(c) { return (c >>> 16) & 255; }
  function alpha(c) { return (c >>> 24) & 255; }

  function hexToColor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return pack((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
  }
  function colorToHex(c) {
    function h(v) { return (v < 16 ? '0' : '') + v.toString(16); }
    return ('#' + h(red(c)) + h(green(c)) + h(blue(c))).toUpperCase();
  }

  function hsvToColor(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return pack(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), 255);
  }
  function colorToHsv(c) {
    var r = red(c) / 255, g = green(c) / 255, b = blue(c) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d > 0) {
      if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4);
    }
    return { h: (h + 360) % 360, s: mx === 0 ? 0 : d / mx, v: mx };
  }

  /** A fully transparent pixel is always stored as 0, so two "empty" pixels compare equal whatever colour they remember. */
  function norm(c) { return alpha(c) === 0 ? 0 : c; }

  function Doc(w, h, px) {
    this.w = w; this.h = h;
    this.px = px || new Uint32Array(w * h);
    this.undoStack = []; this.redoStack = [];
    this.stroke = null;
    this.saved = new Uint32Array(this.px);
  }

  Doc.fromRGBA = function (w, h, rgba) {
    var d = new Doc(w, h);
    for (var i = 0; i < w * h; i++) d.px[i] = norm(pack(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]));
    d.saved = new Uint32Array(d.px);
    return d;
  };

  Doc.prototype.toRGBA = function (out) {
    out = out || new Uint8ClampedArray(this.w * this.h * 4);
    for (var i = 0; i < this.px.length; i++) {
      var c = this.px[i];
      out[i * 4] = red(c); out[i * 4 + 1] = green(c); out[i * 4 + 2] = blue(c); out[i * 4 + 3] = alpha(c);
    }
    return out;
  };

  Doc.prototype.inBounds = function (x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; };
  Doc.prototype.get = function (x, y) { return this.inBounds(x, y) ? this.px[y * this.w + x] : 0; };

  Doc.prototype.beginStroke = function () { this.stroke = { idx: [], before: [], after: [], seen: {}, meta: null }; };

  /** Set one pixel inside the open stroke. Returns true when the pixel actually changed. */
  Doc.prototype.paint = function (x, y, color) {
    if (!this.stroke || !this.inBounds(x, y)) return false;
    var i = y * this.w + x;
    color = norm(color);
    if (this.px[i] === color) return false;
    var s = this.stroke;
    if (s.seen[i] === undefined) { s.seen[i] = s.idx.length; s.idx.push(i); s.before.push(this.px[i]); s.after.push(color); } else { s.after[s.seen[i]] = color; }
    this.px[i] = color;
    return true;
  };

  /** A straight run of single pixels between two points (Bresenham), so a fast drag leaves no gaps. Returns the changed indexes. */
  Doc.prototype.line = function (x0, y0, x1, y1, color) {
    var changed = [], dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (;;) {
      if (this.paint(x0, y0, color)) changed.push(y0 * this.w + x0);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return changed;
  };

  /** Close the stroke and make it undoable. meta (optional) rides along, e.g. a background mode change. Returns the stroke, or null if nothing happened. */
  Doc.prototype.endStroke = function (meta) {
    var s = this.stroke; this.stroke = null;
    if (!s || (!s.idx.length && !meta)) return null;
    s.meta = meta || null;
    this.undoStack.push(s);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
    return s;
  };

  Doc.prototype.canUndo = function () { return this.undoStack.length > 0; };
  Doc.prototype.canRedo = function () { return this.redoStack.length > 0; };

  Doc.prototype.undo = function () {
    var s = this.undoStack.pop();
    if (!s) return null;
    for (var k = 0; k < s.idx.length; k++) this.px[s.idx[k]] = s.before[k];
    this.redoStack.push(s);
    return s;
  };
  Doc.prototype.redo = function () {
    var s = this.redoStack.pop();
    if (!s) return null;
    for (var k = 0; k < s.idx.length; k++) this.px[s.idx[k]] = s.after[k];
    this.undoStack.push(s);
    return s;
  };

  /** Flood fill the same-coloured region (four-way, exact match) as one undoable stroke. Returns the changed indexes. */
  Doc.prototype.fill = function (x, y, color) {
    if (!this.inBounds(x, y)) return [];
    color = norm(color);
    var target = this.px[y * this.w + x];
    if (target === color) return [];
    var stack = [y * this.w + x], changed = [], w = this.w, h = this.h;
    this.beginStroke();
    while (stack.length) {
      var i = stack.pop();
      if (this.px[i] !== target) continue;
      var cx = i % w, cy = (i - cx) / w;
      this.paint(cx, cy, color);
      changed.push(i);
      if (cx > 0) stack.push(i - 1);
      if (cx < w - 1) stack.push(i + 1);
      if (cy > 0) stack.push(i - w);
      if (cy < h - 1) stack.push(i + w);
    }
    this.endStroke();
    return changed;
  };

  /** What the eraser paints: nothing on a transparent sprite, the background colour on an opaque one. */
  Doc.eraseValue = function (mode, bgColor) { return mode === 'opaque' ? bgColor : 0; };

  /** Switch to an opaque background: transparent (and see-through) pixels are laid over the background colour. One undoable step. */
  Doc.prototype.flatten = function (bgColor, prev) {
    this.beginStroke();
    var br = red(bgColor), bg = green(bgColor), bb = blue(bgColor);
    for (var i = 0; i < this.px.length; i++) {
      var c = this.px[i], a = alpha(c);
      if (a === 255) continue;
      var f = a / 255;
      var out = a === 0 ? bgColor : pack(Math.round(red(c) * f + br * (1 - f)), Math.round(green(c) * f + bg * (1 - f)), Math.round(blue(c) * f + bb * (1 - f)), 255);
      this.paint(i % this.w, (i - (i % this.w)) / this.w, out);
    }
    return this.endStroke({ prev: prev, next: { mode: 'opaque', color: colorToHex(bgColor) } });
  };

  /** Switch back to transparent: pixels exactly the background colour become transparent again. One undoable step. */
  Doc.prototype.unflatten = function (bgColor, prev) {
    this.beginStroke();
    for (var i = 0; i < this.px.length; i++) if (this.px[i] === bgColor) this.paint(i % this.w, (i - (i % this.w)) / this.w, 0);
    return this.endStroke({ prev: prev, next: { mode: 'transparent', color: colorToHex(bgColor) } });
  };

  Doc.prototype.isBlank = function () {
    for (var i = 0; i < this.px.length; i++) if (alpha(this.px[i]) !== 0) return false;
    return true;
  };

  /** Pixels that now differ from another image of the same size (the original art). */
  Doc.prototype.changedFrom = function (orig) {
    var n = 0;
    for (var i = 0; i < this.px.length; i++) if (norm(this.px[i]) !== norm(orig[i])) n++;
    return n;
  };

  Doc.prototype.markSaved = function () { this.saved = new Uint32Array(this.px); };
  Doc.prototype.isEdited = function () {
    for (var i = 0; i < this.px.length; i++) if (this.px[i] !== this.saved[i]) return true;
    return false;
  };

  /** Colours in use, most common first (transparent excluded). -> [[color, count], ...] */
  Doc.prototype.colors = function (limit) {
    var counts = {}, i, c;
    for (i = 0; i < this.px.length; i++) { c = this.px[i]; if (alpha(c) !== 0) counts[c] = (counts[c] || 0) + 1; }
    var list = Object.keys(counts).map(function (k) { return [Number(k), counts[k]]; });
    list.sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
    return list.slice(0, limit || 32);
  };

  var api = { Doc: Doc, pack: pack, red: red, green: green, blue: blue, alpha: alpha, hexToColor: hexToColor, colorToHex: colorToHex, hsvToColor: hsvToColor, colorToHsv: colorToHsv, norm: norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SkipCore = api;
})(typeof window !== 'undefined' ? window : this);
