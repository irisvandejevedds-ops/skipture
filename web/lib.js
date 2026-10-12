/* Skipture's rules, with no page in sight: libraries, slots, humanization, PNG and zip files, and merging a developer's zip.
   Everything talks to a store (store.js) through a few async calls, so the same code runs in the browser and in node's tests. */
(function (root) {
  'use strict';

  var SLOT = /^[a-z0-9][a-z0-9_.-]{0,63}$/, SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/, HEX = /^#[0-9A-Fa-f]{6}$/;
  var KINDS = ['sprite', 'texture'], STATES = ['empty', 'raw', 'touched', 'humanized'], FORMAT = 'skipture-library';
  var MAX_ZIP = 40000000, MAX_SPRITES = 1500, MAX_TOTAL = 120000000, MAX_SIDE = 512, MAX_PNG = 2000000, MAX_SCHEMA = 5000000, KEEP_REVISIONS = 25;
  var STATE_WORDS = { empty: 'waiting for art', raw: 'as received', touched: 'redrawn', humanized: 'humanized' };
  var README = 'Skipture library\n================\n\nschema.json describes the slots in this library. Each slot is one sprite or texture.\n\nTo fill it in:\n' +
    '  1. Put a PNG for each slot at sprites/<slot>.png. The size must match the width and height in schema.json exactly.\n' +
    '  2. Transparent backgrounds: use a PNG with an alpha channel. Slots that say "opaque" must be fully filled.\n' +
    '  3. Zip the folder back up (keep schema.json and the sprites folder at the top level) and send it back.\n\n' +
    'Anything you draw here will be redrawn by hand before it ships. Do not change schema.json.\n';

  function LibError(message) { this.message = message; this.name = 'LibError'; }
  LibError.prototype = Object.create(Error.prototype);

  function iso(d) { return (d || new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function slugify(text) { var s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, ''); return s || 'library'; }
  function utf8(s) { return new TextEncoder().encode(s); }
  function same(a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

  // ---------------- bytes: crc, deflate ----------------
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes, crc) { var c = ~(crc || 0); for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (~c) >>> 0; }

  async function pump(stream, bytes, limit) {
    var w = stream.writable.getWriter(), r = stream.readable.getReader(), parts = [], total = 0;
    var writing = w.write(bytes).then(function () { return w.close(); }).catch(function () { /* the reader reports the failure */ });
    for (;;) {
      var step = await r.read();
      if (step.done) break;
      total += step.value.length;
      if (limit && total > limit) { try { await r.cancel(); } catch (e) { /* ignore */ } throw new LibError('A file in that zip is larger than it says it is.'); }
      parts.push(step.value);
    }
    await writing;
    var out = new Uint8Array(total), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  function zlibDeflate(bytes) { return pump(new CompressionStream('deflate'), bytes, 0); }
  function rawInflate(bytes, limit) {
    return pump(new DecompressionStream('deflate-raw'), bytes, limit).catch(function (e) { throw e instanceof LibError ? e : new LibError('That zip is damaged.'); });
  }

  // ---------------- PNG ----------------
  var SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  function pngInfo(b) {
    if (!(b instanceof Uint8Array) || b.length < 33) throw new LibError('That is not a PNG file.');
    for (var i = 0; i < 8; i++) if (b[i] !== SIG[i]) throw new LibError('That is not a PNG file.');
    if (b.length > MAX_PNG) throw new LibError('That PNG is larger than 2 MB.');
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (dv.getUint32(8) !== 13 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') throw new LibError('That PNG header is damaged.');
    var w = dv.getUint32(16), h = dv.getUint32(20);
    if (!(w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE)) throw new LibError('That PNG is ' + w + 'x' + h + '; sprites must be between 1 and ' + MAX_SIDE + ' pixels a side.');
    var tail = ''; for (var j = Math.max(0, b.length - 16); j < b.length; j++) tail += String.fromCharCode(b[j]);
    if (tail.indexOf('IEND') < 0) throw new LibError('That PNG is cut off.');
    return [w, h];
  }
  function chunk(kind, body) {
    var out = new Uint8Array(12 + body.length), dv = new DataView(out.buffer);
    dv.setUint32(0, body.length); for (var i = 0; i < 4; i++) out[4 + i] = kind.charCodeAt(i);
    out.set(body, 8); dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  }
  /** rgba: Uint8Array/Uint8ClampedArray of w*h*4. -> PNG bytes (8-bit RGBA, no interlace). */
  async function encodePng(w, h, rgba) {
    if (rgba.length !== w * h * 4) throw new LibError('The pixel data does not match the size.');
    var raw = new Uint8Array(h * (w * 4 + 1));
    for (var y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
    var head = new Uint8Array(13), dv = new DataView(head.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); head[8] = 8; head[9] = 6;
    var parts = [new Uint8Array(SIG), chunk('IHDR', head), chunk('IDAT', await zlibDeflate(raw)), chunk('IEND', new Uint8Array(0))];
    return concat(parts);
  }
  function concat(parts) {
    var n = 0; parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n), at = 0; parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  function blankPng(w, h, rgba) {
    var px = new Uint8Array(w * h * 4), c = rgba || [0, 0, 0, 0];
    if (c[0] || c[1] || c[2] || c[3]) for (var i = 0; i < w * h; i++) { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = c[3]; }
    return encodePng(w, h, px);
  }

  // ---------------- zip ----------------
  var DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  /** entries: [{name, data: Uint8Array}] -> zip bytes (files stored, not compressed: PNGs are already small). */
  function writeZip(entries) {
    var chunks = [], central = [], offset = 0;
    entries.forEach(function (e) {
      var name = utf8(e.name), crc = crc32(e.data), size = e.data.length;
      var lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, DOS_DATE, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true); dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
      lh.set(name, 30);
      var ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, DOS_DATE, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
      ch.set(name, 46);
      chunks.push(lh, e.data); central.push(ch); offset += lh.length + size;
    });
    var cdSize = 0; central.forEach(function (c) { cdSize += c.length; });
    var end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return concat(chunks.concat(central, [end]));
  }

  /** Opens a zip in memory. Nothing is ever written anywhere. -> {names:[...], read(name, limit) -> Promise<Uint8Array>} */
  function readZip(bytes) {
    if (bytes.length > MAX_ZIP) throw new LibError('That zip is bigger than 40 MB.');
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new LibError('That is not a zip file.');
    var count = dv.getUint16(end + 10, true), at = dv.getUint32(end + 16, true);
    if (count === 0xFFFF || at === 0xFFFFFFFF) throw new LibError('That zip uses a format Skipture cannot read.');
    if (count > MAX_SPRITES * 2 + 10) throw new LibError('That zip is too large or has too many files.');
    var files = {}, names = [], total = 0;
    for (var n = 0; n < count; n++) {
      if (at + 46 > bytes.length || dv.getUint32(at, true) !== 0x02014b50) throw new LibError('That zip is damaged.');
      var method = dv.getUint16(at + 10, true), csize = dv.getUint32(at + 20, true), usize = dv.getUint32(at + 24, true), nl = dv.getUint16(at + 28, true), el = dv.getUint16(at + 30, true), cl = dv.getUint16(at + 32, true), off = dv.getUint32(at + 42, true);
      var name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nl));
      total += usize;
      if (total > MAX_TOTAL) throw new LibError('That zip is too large or has too many files.');
      if (!/\/$/.test(name)) { files[name] = { method: method, csize: csize, usize: usize, off: off }; names.push(name); }
      at += 46 + nl + el + cl;
    }
    return {
      names: names,
      read: async function (name, limit) {
        var f = files[name];
        if (!f) throw new LibError('There is no ' + name + ' in that zip.');
        var cap = limit || MAX_PNG;
        if (f.usize > cap) throw new LibError(name + ' is too large.');
        if (f.off + 30 > bytes.length || dv.getUint32(f.off, true) !== 0x04034b50) throw new LibError('That zip is damaged.');
        var start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
        if (start + f.csize > bytes.length) throw new LibError('That zip is damaged.');
        var body = bytes.subarray(start, start + f.csize);
        var out;
        if (f.method === 0) out = body.slice();
        else if (f.method === 8) out = await rawInflate(body, Math.min(cap, f.usize + 1));
        else throw new LibError('That zip uses a way of packing files Skipture cannot read.');
        if (out.length !== f.usize) throw new LibError('That zip is damaged.');
        return out;
      }
    };
  }

  // ---------------- libraries and slots ----------------
  async function uniqueSlug(S, base) {
    var taken = {}; (await S.libraries()).forEach(function (l) { taken[l.slug] = 1; });
    var slug = base, n = 2;
    while (taken[slug]) { slug = base.slice(0, 44) + '-' + n; n++; }
    return slug;
  }

  async function createLibrary(S, o) {
    var name = String(o.name || '').trim().slice(0, 80);
    if (!name) throw new LibError('Give the library a name.');
    var now = iso(), slug = await uniqueSlug(S, slugify(o.slug || name));
    var lib = await S.saveLibrary({ slug: slug, name: name, app: String(o.app || '').trim().slice(0, 60), description: String(o.description || '').trim().slice(0, 500), createdAt: now, updatedAt: now });
    return lib.id;
  }

  async function touchLibrary(S, id) { var l = await S.library(id); if (l) { l.updatedAt = iso(); await S.saveLibrary(l); } }

  async function addSlot(S, libId, o) {
    var slot = String(o.slot || '').trim().toLowerCase();
    if (!SLOT.test(slot)) throw new LibError("'" + slot + "' is not a usable slot id: use lowercase letters, digits, dashes, underscores and dots (up to 64).");
    var existing = await S.sprites(libId);
    if (existing.some(function (s) { return s.slot === slot; })) throw new LibError("The slot '" + slot + "' already exists.");
    var w = parseInt(o.width, 10), h = parseInt(o.height, 10);
    if (!(w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE)) throw new LibError('Size must be between 1 and ' + MAX_SIDE + ' pixels a side.');
    var kind = KINDS.indexOf(o.kind) >= 0 ? o.kind : 'sprite', bgMode = o.bgMode === 'opaque' ? 'opaque' : 'transparent', bgColor = HEX.test(o.bgColor || '') ? o.bgColor.toUpperCase() : '#FFFFFF';
    var data, state, origin;
    if (o.art) {
      var dim = pngInfo(o.art);
      if (dim[0] !== w || dim[1] !== h) throw new LibError("The art for '" + slot + "' is " + dim[0] + 'x' + dim[1] + ', but the slot is ' + w + 'x' + h + '.');
      data = o.art; state = o.state || 'raw'; origin = o.origin || 'app';
    } else { data = await blankPng(w, h); state = 'empty'; origin = 'blank'; }
    var now = iso(), order = existing.reduce(function (m, s) { return Math.max(m, s.sort); }, 0) + 1;
    var s = await S.saveSprite({ libraryId: libId, slot: slot, name: String(o.name || slot).trim().slice(0, 80), kind: kind, width: w, height: h, tile: !!o.tile, bgMode: bgMode, bgColor: bgColor,
      category: String(o.category || '').trim().slice(0, 40), notes: String(o.notes || '').trim().slice(0, 500), png: data, originalPng: data, state: state, origin: origin, changedPx: 0, humanizedAt: null,
      sort: order, createdAt: now, updatedAt: now });
    await touchLibrary(S, libId);
    return s.id;
  }

  // ---------------- how humanized is it ----------------
  function progress(sprites) {
    var counts = { empty: 0, raw: 0, touched: 0, humanized: 0 }, area = 0, done = 0;
    sprites.forEach(function (s) { counts[s.state]++; area += s.width * s.height; if (s.state === 'humanized') done += s.width * s.height; });
    var total = sprites.length;
    return { total: total, counts: counts, humanized: counts.humanized, pct: total ? Math.floor(100 * counts.humanized / total) : 0, complete: total > 0 && counts.humanized === total,
      areaPct: area ? Math.floor(100 * done / area) : 0, waiting: counts.empty };
  }
  function overall(sprites) { var d = sprites.filter(function (s) { return s.state === 'humanized'; }).length; return { total: sprites.length, humanized: d, pct: sprites.length ? Math.floor(100 * d / sprites.length) : 0 }; }

  // ---------------- saving hand work ----------------
  async function revise(S, s, note) {
    await S.addRevision({ spriteId: s.id, png: s.png, state: s.state, note: note, createdAt: iso() });
    var revs = await S.revisions(s.id);
    for (var i = KEEP_REVISIONS; i < revs.length; i++) await S.removeRevision(revs[i].id);
  }

  /** Store hand-drawn art. changedPx: pixels now different from the original; edited: pixels differ from what was loaded; blank: nothing is drawn.
   *  Changing humanized work drops it back to redrawn, so sign-off is always deliberate. -> the new state. */
  async function saveArt(S, id, data, changedPx, blank, edited, bgMode, bgColor) {
    var s = await S.sprite(id);
    if (!s) throw new LibError('No such sprite.');
    var dim = pngInfo(data);
    if (dim[0] !== s.width || dim[1] !== s.height) throw new LibError('This sprite is ' + s.width + 'x' + s.height + '; the saved image is a different size.');
    changedPx = Math.max(0, Math.min(parseInt(changedPx, 10) || 0, s.width * s.height));
    var state;
    if (blank) state = 'empty'; else if (s.state === 'empty') state = 'touched'; else if (edited) state = changedPx ? 'touched' : 'raw'; else state = s.state;
    if (edited) await revise(S, s, 'before a save');
    var wasEmpty = s.state === 'empty';
    s.bgMode = bgMode === 'opaque' || bgMode === 'transparent' ? bgMode : s.bgMode;
    s.bgColor = bgColor && HEX.test(bgColor) ? bgColor.toUpperCase() : s.bgColor;
    if (wasEmpty && !blank) s.origin = 'drawn';
    s.png = data; s.state = state; s.changedPx = changedPx; s.humanizedAt = state === 'humanized' ? s.humanizedAt : null; s.updatedAt = iso();
    await S.saveSprite(s); await touchLibrary(S, s.libraryId);
    return state;
  }

  async function setState(S, id, action) {
    var s = await S.sprite(id);
    if (!s) throw new LibError('No such sprite.');
    var now = iso();
    if (action === 'humanize') {
      if (s.state === 'empty') throw new LibError('There is no art in this slot yet. Draw something or bring in a picture first.');
      s.state = 'humanized'; s.humanizedAt = now;
    } else if (action === 'unhumanize') { s.state = s.changedPx ? 'touched' : 'raw'; s.humanizedAt = null; }
    else if (action === 'reset') {
      if (!same(s.png, s.originalPng)) await revise(S, s, 'before reset to original');
      s.png = s.originalPng; s.state = s.origin === 'blank' ? 'empty' : 'raw'; s.changedPx = 0; s.humanizedAt = null;
    } else throw new LibError('Unknown action.');
    s.updatedAt = now;
    await S.saveSprite(s); await touchLibrary(S, s.libraryId);
  }

  async function restoreRevision(S, id, revId) {
    var s = await S.sprite(id), r = await S.revision(revId);
    if (!s || !r || r.spriteId !== id) throw new LibError('No such version.');
    await revise(S, s, 'before restoring an earlier version');
    s.png = r.png; s.state = same(r.png, s.originalPng) ? 'raw' : 'touched'; s.humanizedAt = null; s.updatedAt = iso();
    await S.saveSprite(s); await touchLibrary(S, s.libraryId);
  }

  // ---------------- the zip a library travels in ----------------
  function slotJson(s, withState) {
    var d = { slot: s.slot, name: s.name, kind: s.kind, width: s.width, height: s.height, tile: !!s.tile, background: s.bgMode, background_color: s.bgMode === 'opaque' ? s.bgColor : null, category: s.category, notes: s.notes };
    if (withState) { d.state = s.state; d.humanized_at = s.humanizedAt; }
    return d;
  }

  /** purpose: 'schema' (blank slots for a developer) or 'library' (the art as it stands). -> {data, name, complete} */
  async function exportZip(S, libId, purpose) {
    var lib = await S.library(libId);
    if (!lib) throw new LibError('No such library.');
    var sprites = await S.sprites(libId), prog = progress(sprites);
    var schema = { format: FORMAT, version: 1, purpose: purpose, generated_at: iso(), library: { slug: lib.slug, name: lib.name, app: lib.app, description: lib.description }, sprites: sprites.map(function (s) { return slotJson(s, purpose === 'library'); }) };
    if (purpose === 'library') { schema.complete = prog.complete; schema.humanized = { done: prog.humanized, of: prog.total }; }
    var entries = [{ name: 'schema.json', data: utf8(JSON.stringify(schema, null, 2)) }];
    entries.push({ name: 'README.txt', data: utf8(purpose === 'schema' ? README : lib.name + ': ' + prog.humanized + ' of ' + prog.total + ' sprites humanized' +
      (prog.complete ? '' : ' (partial export: slots marked in schema.json are not finished)') + '.\nDrop sprites/<slot>.png into your project. schema.json lists every slot.\n') });
    for (var i = 0; i < sprites.length; i++) {
      var s = sprites[i];
      if (purpose === 'schema') entries.push({ name: 'sprites/' + s.slot + '.png', data: await blankPng(s.width, s.height, s.bgMode === 'opaque' ? [255, 255, 255, 255] : null) });
      else if (s.state !== 'empty') entries.push({ name: 'sprites/' + s.slot + '.png', data: s.png });
    }
    await S.addExport({ libraryId: libId, kind: purpose, complete: prog.complete, humanized: prog.humanized, total: prog.total, createdAt: iso() });
    return { data: writeZip(entries), name: lib.slug + '-' + (purpose === 'schema' ? 'schema' : prog.complete ? 'library' : 'partial') + '.zip', complete: prog.complete };
  }

  /** Merge a library zip. A zip for a library we know adds art only where it is safe: slots that are empty or still as received take the new art, slots that were
   *  redrawn or humanized are left alone. A zip for an unknown library creates it (an artist's finished-library export keeps its progress, so it works as a backup;
   *  pass {restore:false} to ignore the progress a zip claims). -> report */
  async function importZip(S, bytes, origin, opts) {
    origin = origin || 'developer';
    var restore = !opts || opts.restore !== false;
    var z = readZip(bytes);
    if (z.names.indexOf('schema.json') < 0) throw new LibError('There is no schema.json at the top of that zip.');
    var schema;
    try { schema = JSON.parse(new TextDecoder().decode(await z.read('schema.json', MAX_SCHEMA))); } catch (e) { if (e instanceof LibError) throw e; throw new LibError('schema.json is not valid JSON.'); }
    if (!schema || typeof schema !== 'object' || schema.format !== FORMAT || !Array.isArray(schema.sprites) || !schema.library || typeof schema.library !== 'object') throw new LibError('schema.json is not a Skipture library schema.');
    if (schema.sprites.length > MAX_SPRITES) throw new LibError('That library has too many sprites.');
    var meta = schema.library, slug = slugify(meta.slug || meta.name || 'library'), report = { library: null, created: false, added: [], updated: [], kept: [], skipped: [], problems: [] };
    var lib = (await S.libraries()).filter(function (l) { return l.slug === slug; })[0];
    if (!lib) {
      var id = await createLibrary(S, { name: meta.name || slug, app: meta.app || '', description: meta.description || '', slug: slug });
      report.created = true; lib = await S.library(id);
    }
    report.library = { id: lib.id, name: lib.name };
    var backup = restore && report.created && schema.purpose === 'library', names = {};
    z.names.forEach(function (n) { names[n] = 1; });
    for (var i = 0; i < schema.sprites.length; i++) {
      var d = schema.sprites[i], label = d && typeof d === 'object' ? d.slot || '?' : '?';
      try {
        if (!d || typeof d !== 'object') throw new LibError('a slot entry is not an object');
        var slot = String(d.slot || '').toLowerCase(), path = 'sprites/' + slot + '.png';
        var art = SLOT.test(slot) && names[path] ? await z.read(path, MAX_PNG) : null;
        var dim = art ? pngInfo(art) : null;
        var existing = (await S.sprites(lib.id)).filter(function (s) { return s.slot === slot; })[0];
        if (!existing) {
          if (!report.created) { report.skipped.push(slot + ': not a slot in this library, ignored'); continue; }
          var st = backup && art && STATES.indexOf(d.state) > 0 ? d.state : 'raw';
          await addSlot(S, lib.id, { slot: slot, name: d.name || slot, width: d.width, height: d.height, kind: d.kind, tile: !!d.tile, bgMode: d.background, bgColor: d.background_color, category: d.category, notes: d.notes, art: art, origin: origin, state: art ? st : null });
          if (backup && art && st === 'humanized') { var made = (await S.sprites(lib.id)).filter(function (s) { return s.slot === slot; })[0]; made.humanizedAt = d.humanized_at || iso(); await S.saveSprite(made); }
          report.added.push(slot);
          continue;
        }
        if (!art) { report.skipped.push(slot + ': no sprites/' + slot + '.png in the zip'); continue; }
        if (dim[0] !== existing.width || dim[1] !== existing.height) throw new LibError('is ' + dim[0] + 'x' + dim[1] + ' but the slot is ' + existing.width + 'x' + existing.height);
        if (existing.state === 'touched' || existing.state === 'humanized') { report.kept.push(slot + ': already ' + existing.state + ', your version was kept'); continue; }
        if (same(art, existing.png)) { report.skipped.push(slot + ': same art as before'); continue; }
        if (existing.state !== 'empty') await revise(S, existing, 'before developer art replaced it');
        existing.png = art; existing.originalPng = art; existing.state = 'raw'; existing.changedPx = 0; existing.origin = origin; existing.humanizedAt = null; existing.updatedAt = iso();
        await S.saveSprite(existing);
        report.updated.push(slot);
      } catch (e) {
        if (!(e instanceof LibError) && !(e instanceof TypeError) && !(e instanceof RangeError)) throw e;
        report.problems.push(label + ': ' + e.message);
      }
    }
    await touchLibrary(S, lib.id);
    return report;
  }

  async function removeLibrary(S, id) { await S.removeLibrary(id); }

  var api = { LibError: LibError, SLOT: SLOT, HEX: HEX, KINDS: KINDS, STATES: STATES, STATE_WORDS: STATE_WORDS, MAX_SIDE: MAX_SIDE, MAX_PNG: MAX_PNG, KEEP_REVISIONS: KEEP_REVISIONS,
    iso: iso, revise: revise, slugify: slugify, crc32: crc32, pngInfo: pngInfo, encodePng: encodePng, blankPng: blankPng, writeZip: writeZip, readZip: readZip,
    createLibrary: createLibrary, addSlot: addSlot, progress: progress, overall: overall, saveArt: saveArt, setState: setState, restoreRevision: restoreRevision,
    exportZip: exportZip, importZip: importZip, removeLibrary: removeLibrary, touchLibrary: touchLibrary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SkipLib = api;
})(typeof window !== 'undefined' ? window : this);
