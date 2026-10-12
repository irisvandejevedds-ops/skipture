/* What a room lets people do, and who may do it. The server runs this against the room's database; the demo runs the same code against memory in the browser.
   Guests (a room key) can look around, bring art in and draw on slots nobody has taken over. Artists (key + passphrase) can do everything. */
(function (root) {
  'use strict';
  var L = typeof require === 'function' && typeof module !== 'undefined' ? require('./lib.js') : root.SkipLib;

  var CAP = { sprites: 1500, libraries: 60, bytes: 64000000, zipBytes: 16000000 };
  var INLINE = 16000;                       // PNGs up to this size travel inside the page data; bigger ones are fetched separately

  function Denied(message) { this.message = message; this.name = 'Denied'; }
  Denied.prototype = Object.create(Error.prototype);

  function b64enc(b) { var s = ''; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function b64dec(t) {
    var s; try { s = atob(String(t || '')); } catch (e) { throw new L.LibError('That picture did not arrive intact.'); }
    var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function inline(bytes) { return bytes && bytes.length <= INLINE ? b64enc(bytes) : null; }
  function pub(s) {
    return { id: s.id, libraryId: s.libraryId, slot: s.slot, name: s.name, kind: s.kind, width: s.width, height: s.height, tile: !!s.tile, bgMode: s.bgMode, bgColor: s.bgColor, category: s.category,
      notes: s.notes, state: s.state, origin: s.origin, changedPx: s.changedPx, humanizedAt: s.humanizedAt, sort: s.sort, updatedAt: s.updatedAt };
  }
  function libPub(l) { return { id: l.id, slug: l.slug, name: l.name, app: l.app, description: l.description, updatedAt: l.updatedAt }; }
  function submitted(list) { return list.filter(function (s) { return s.state !== 'empty'; }).length; }
  function str(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }

  async function room(S, extra) {
    var st = await S.stats();
    if (st.sprites + (extra || 0) > CAP.sprites) throw new L.LibError('This room is full: it holds up to ' + CAP.sprites + ' sprites.');
    if (st.bytes > CAP.bytes) throw new L.LibError('This room is full: it holds up to ' + Math.round(CAP.bytes / 1000000) + ' MB of art.');
    return st;
  }
  async function needLibrary(S, id) { var l = await S.library(id); if (!l) throw new L.LibError('That library is not here.'); return l; }
  async function needSprite(S, id) { var s = await S.sprite(id); if (!s) throw new L.LibError('That sprite is not here.'); return s; }
  async function progressFor(S, libId) { return L.progress(await S.spritesMeta(libId)); }

  var OPS = {
    overview: ['guest', async function (S) {
      var libs = (await S.libraries()).sort(function (a, b) { return (a.app || '').toLowerCase().localeCompare((b.app || '').toLowerCase()) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
      var all = await S.allSpritesMeta(), by = {};
      all.forEach(function (s) { (by[s.libraryId] = by[s.libraryId] || []).push(s); });
      var out = [];
      for (var i = 0; i < libs.length; i++) {
        var list = by[libs[i].id] || [], rep = list.filter(function (s) { return s.state !== 'empty'; })[0] || list[0], full = rep ? await S.sprite(rep.id) : null;
        out.push(Object.assign(libPub(libs[i]), { progress: L.progress(list), submitted: submitted(list),
          rep: full ? { id: full.id, width: full.width, height: full.height, bgMode: full.bgMode, updatedAt: full.updatedAt, png: inline(full.png) } : null }));
      }
      var done = all.filter(function (s) { return s.state === 'humanized'; }).length;
      return { libraries: out, totals: { libraries: libs.length, sprites: all.length, submitted: submitted(all), humanized: done, pct: all.length ? Math.floor(100 * done / all.length) : 0 } };
    }],

    library: ['guest', async function (S, a, role) {
      var lib = await needLibrary(S, a.id), sprites = await S.sprites(lib.id);
      return { lib: libPub(lib), progress: L.progress(sprites), sprites: sprites.map(function (s) { return Object.assign(pub(s), { png: inline(s.png) }); }),
        exports: role === 'artist' ? await S.exports(lib.id) : [] };
    }],

    sprite: ['guest', async function (S, a, role) {
      var s = await needSprite(S, a.id), lib = await S.library(s.libraryId), sibs = await S.spritesMeta(s.libraryId), at = sibs.findIndex(function (x) { return x.id === s.id; });
      var todo = sibs.slice(at + 1).concat(sibs.slice(0, at)).filter(function (x) { return x.state === 'raw' || x.state === 'touched'; })[0];
      return { sprite: pub(s), lib: libPub(lib), progress: L.progress(sibs), prev: sibs[at - 1] ? sibs[at - 1].id : null, next: sibs[at + 1] ? sibs[at + 1].id : null, todo: todo ? todo.id : null,
        locked: role !== 'artist' && (s.state === 'touched' || s.state === 'humanized') };
    }],

    history: ['artist', async function (S, a) {
      var s = await needSprite(S, a.id), revs = await S.revisions(s.id);
      return { sprite: pub(s), revisions: revs.map(function (r) { return { id: r.id, state: r.state, note: r.note, createdAt: r.createdAt, png: inline(r.png) }; }) };
    }],

    createLibrary: ['guest', async function (S, a) {
      var st = await S.stats(); if (st.libraries >= CAP.libraries) throw new L.LibError('This room holds up to ' + CAP.libraries + ' libraries.');
      return { id: await L.createLibrary(S, { name: a.name, app: a.app, description: a.description }) };
    }],

    addSlot: ['guest', async function (S, a) {
      await room(S, 1); await needLibrary(S, a.libraryId);
      return { id: await L.addSlot(S, a.libraryId, { slot: a.slot, name: a.name, width: a.width, height: a.height, kind: a.kind, bgMode: a.bgMode, bgColor: a.bgColor, category: a.category, tile: !!a.tile, notes: a.notes }) };
    }],

    saveArt: ['guest', async function (S, a, role) {
      var s = await needSprite(S, a.id), data = b64dec(a.png), state;
      if (role === 'artist') state = await L.saveArt(S, s.id, data, a.changedPx, !!a.blank, a.edited !== false, a.bgMode, a.bgColor);
      else {
        if (s.state === 'touched' || s.state === 'humanized') throw new Denied('The artist has taken this slot over, so it can no longer be changed here.');
        var dim = L.pngInfo(data);
        if (dim[0] !== s.width || dim[1] !== s.height) throw new L.LibError('This sprite is ' + s.width + 'x' + s.height + '; the picture is a different size.');
        if (s.state === 'raw') await L.revise(S, s, 'before a new submission');
        var blank = !!a.blank;
        s.png = data; s.originalPng = data; s.state = blank ? 'empty' : 'raw'; s.changedPx = 0; s.humanizedAt = null; s.origin = blank ? 'blank' : 'guest'; s.updatedAt = L.iso();
        await S.saveSprite(s); await L.touchLibrary(S, s.libraryId); state = s.state;
      }
      var p = await progressFor(S, s.libraryId);
      return { state: state, word: L.STATE_WORDS[state], humanized: p.humanized, total: p.total, pct: p.pct };
    }],

    setState: ['artist', async function (S, a) { await L.setState(S, a.id, a.action); return {}; }],
    restore: ['artist', async function (S, a) { await L.restoreRevision(S, a.id, a.revision); return {}; }],

    editLibrary: ['artist', async function (S, a) {
      var l = await needLibrary(S, a.id), name = str(a.name, 80);
      if (!name) throw new L.LibError('Give the library a name.');
      l.name = name; l.app = str(a.app, 60); l.description = str(a.description, 500); l.updatedAt = L.iso(); await S.saveLibrary(l); return {};
    }],

    deleteLibrary: ['artist', async function (S, a) {
      var l = await needLibrary(S, a.id);
      if (str(a.confirm, 100) !== l.slug) throw new L.LibError('To delete this library, type its id (' + l.slug + ') exactly.');
      await S.removeLibrary(l.id); return {};
    }],

    editMeta: ['artist', async function (S, a) {
      var s = await needSprite(S, a.id);
      s.name = str(a.name, 80) || s.name; if (L.KINDS.indexOf(a.kind) >= 0) s.kind = a.kind; s.tile = !!a.tile; s.category = str(a.category, 40); s.notes = str(a.notes, 500); s.updatedAt = L.iso();
      await S.saveSprite(s); await L.touchLibrary(S, s.libraryId); return {};
    }],

    deleteSprite: ['artist', async function (S, a) { var s = await needSprite(S, a.id); await S.removeSprite(s.id); await L.touchLibrary(S, s.libraryId); return {}; }],

    /** many sprites at once: {ids, action:'delete'} or {ids, action:'meta', fields:{kind?, tile?, category?, notes?, bgMode?}}. Only the fields you give are changed. */
    bulkSprites: ['artist', async function (S, a) {
      var ids = (Array.isArray(a.ids) ? a.ids : []).map(Number).filter(Boolean).slice(0, CAP.sprites), touched = {}, n = 0, f = a.fields || {};
      if (a.action !== 'delete' && a.action !== 'meta') throw new L.LibError('Choose what to do with the selected sprites.');
      if (a.action === 'meta' && !['kind', 'tile', 'category', 'notes', 'bgMode'].some(function (k) { return f[k] !== undefined && f[k] !== null; })) throw new L.LibError('Choose something to change.');
      for (var i = 0; i < ids.length; i++) {
        var s = await S.sprite(ids[i]); if (!s) continue;
        touched[s.libraryId] = 1; n++;
        if (a.action === 'delete') { await S.removeSprite(s.id); continue; }
        if (f.kind !== undefined && L.KINDS.indexOf(f.kind) >= 0) s.kind = f.kind;
        if (f.tile !== undefined && f.tile !== null) s.tile = !!f.tile;
        if (f.category !== undefined && f.category !== null) s.category = str(f.category, 40);
        if (f.notes !== undefined && f.notes !== null) s.notes = str(f.notes, 500);
        if (f.bgMode === 'transparent' || f.bgMode === 'opaque') s.bgMode = f.bgMode;
        s.updatedAt = L.iso(); await S.saveSprite(s);
      }
      for (var k in touched) await L.touchLibrary(S, Number(k));
      return { count: n };
    }],

    /** many libraries at once: {ids, action:'delete', confirm:true} or {ids, action:'edit', fields:{app?, description?}} */
    bulkLibraries: ['artist', async function (S, a) {
      var ids = (Array.isArray(a.ids) ? a.ids : []).map(Number).filter(Boolean), n = 0, f = a.fields || {};
      if (a.action === 'delete' && a.confirm !== true) throw new L.LibError('Confirm that you want to delete the selected libraries.');
      if (a.action !== 'delete' && a.action !== 'edit') throw new L.LibError('Choose what to do with the selected libraries.');
      if (a.action === 'edit' && f.app === undefined && f.description === undefined) throw new L.LibError('Choose something to change.');
      for (var i = 0; i < ids.length; i++) {
        var l = await S.library(ids[i]); if (!l) continue;
        n++;
        if (a.action === 'delete') { await S.removeLibrary(l.id); continue; }
        if (f.app !== undefined) l.app = str(f.app, 60);
        if (f.description !== undefined) l.description = str(f.description, 500);
        l.updatedAt = L.iso(); await S.saveLibrary(l);
      }
      return { count: n };
    }]
  };

  async function run(S, role, op, args) {
    var o = OPS[op];
    if (!o) throw new L.LibError('Unknown request.');
    if (o[0] === 'artist' && role !== 'artist') throw new Denied('Only the artist can do that.');
    return o[1](S, args || {}, role);
  }

  /** a picture: which = 'current' | 'original' | 'rev:<id>' (artist only). -> bytes */
  async function png(S, role, id, which) {
    if (typeof which === 'string' && which.indexOf('rev:') === 0) {
      if (role !== 'artist') throw new Denied('Only the artist can do that.');
      var r = await S.revision(Number(which.slice(4)));
      if (!r || r.spriteId !== id) throw new L.LibError('That version is not here.');
      return r.png;
    }
    var s = await needSprite(S, id);
    return which === 'original' ? s.originalPng : s.png;
  }

  async function exportZip(S, role, id, purpose) {
    if (role !== 'artist') throw new Denied('Only the artist can do that.');
    if (purpose !== 'schema' && purpose !== 'library') throw new L.LibError('Choose what to export.');
    return L.exportZip(S, id, purpose);
  }

  async function importZip(S, role, bytes) {
    if (bytes.length > CAP.zipBytes) throw new L.LibError('That zip is bigger than ' + Math.round(CAP.zipBytes / 1000000) + ' MB.');
    var st = await room(S, 0);
    if (st.bytes + 2 * bytes.length > CAP.bytes) throw new L.LibError('This room does not have space for a zip that size.');
    return L.importZip(S, bytes, 'developer', { restore: role === 'artist' });
  }

  var api = { CAP: CAP, Denied: Denied, run: run, png: png, exportZip: exportZip, importZip: importZip, b64enc: b64enc, b64dec: b64dec, OPS: Object.keys(OPS).reduce(function (m, k) { m[k] = OPS[k][0]; return m; }, {}) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SkipOps = api;
})(typeof window !== 'undefined' ? window : this);
