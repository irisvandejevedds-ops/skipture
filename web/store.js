/* Where Skipture keeps a room's libraries when it runs in memory: the demo in the browser, and the tests. (The real rooms live in the server's sqlstore.js, which has the same calls.)
   Records are plain objects; PNGs are Uint8Arrays. Every method is async so the same rules code (lib.js) runs on either. */
(function (root) {
  'use strict';

  function copy(o) { return o && Object.assign({}, o); }
  function bySort(a, b) { return a.sort - b.sort || a.id - b.id; }
  function meta(s) { var m = copy(s); m.pngSize = s.png ? s.png.length : 0; delete m.png; delete m.originalPng; return m; }

  function MemoryStore() { this.t = { libraries: [], sprites: [], revisions: [], exports: [] }; this.n = 0; }
  MemoryStore.prototype._find = function (t, id) { return this.t[t].filter(function (r) { return r.id === id; })[0]; };
  MemoryStore.prototype._put = function (t, rec) {
    var list = this.t[t];
    if (rec.id == null) { rec.id = ++this.n; list.push(copy(rec)); } else { var i = list.findIndex(function (r) { return r.id === rec.id; }); if (i < 0) list.push(copy(rec)); else list[i] = copy(rec); }
    return Promise.resolve(copy(rec));
  };
  MemoryStore.prototype.libraries = function () { return Promise.resolve(this.t.libraries.map(copy)); };
  MemoryStore.prototype.library = function (id) { return Promise.resolve(copy(this._find('libraries', id))); };
  MemoryStore.prototype.saveLibrary = function (l) { return this._put('libraries', l); };
  MemoryStore.prototype.removeLibrary = function (id) {
    var gone = this.t.sprites.filter(function (s) { return s.libraryId === id; }).map(function (s) { return s.id; });
    this.t.libraries = this.t.libraries.filter(function (l) { return l.id !== id; });
    this.t.sprites = this.t.sprites.filter(function (s) { return s.libraryId !== id; });
    this.t.revisions = this.t.revisions.filter(function (r) { return gone.indexOf(r.spriteId) < 0; });
    this.t.exports = this.t.exports.filter(function (e) { return e.libraryId !== id; });
    return Promise.resolve();
  };
  MemoryStore.prototype.sprites = function (libId) { return Promise.resolve(this.t.sprites.filter(function (s) { return s.libraryId === libId; }).sort(bySort).map(copy)); };
  MemoryStore.prototype.spritesMeta = function (libId) { return Promise.resolve(this.t.sprites.filter(function (s) { return s.libraryId === libId; }).sort(bySort).map(meta)); };
  MemoryStore.prototype.allSpritesMeta = function () { return Promise.resolve(this.t.sprites.slice().sort(bySort).map(meta)); };
  MemoryStore.prototype.stats = function () { var b = 0; this.t.sprites.forEach(function (s) { b += s.png.length + s.originalPng.length; }); return Promise.resolve({ sprites: this.t.sprites.length, libraries: this.t.libraries.length, bytes: b }); };
  MemoryStore.prototype.sprite = function (id) { return Promise.resolve(copy(this._find('sprites', id))); };
  MemoryStore.prototype.saveSprite = function (s) { return this._put('sprites', s); };
  MemoryStore.prototype.removeSprite = function (id) {
    this.t.sprites = this.t.sprites.filter(function (s) { return s.id !== id; });
    this.t.revisions = this.t.revisions.filter(function (r) { return r.spriteId !== id; });
    return Promise.resolve();
  };
  MemoryStore.prototype.revisions = function (spriteId) { return Promise.resolve(this.t.revisions.filter(function (r) { return r.spriteId === spriteId; }).sort(function (a, b) { return b.id - a.id; }).map(copy)); };
  MemoryStore.prototype.revision = function (id) { return Promise.resolve(copy(this._find('revisions', id))); };
  MemoryStore.prototype.addRevision = function (r) { return this._put('revisions', r); };
  MemoryStore.prototype.removeRevision = function (id) { this.t.revisions = this.t.revisions.filter(function (r) { return r.id !== id; }); return Promise.resolve(); };
  MemoryStore.prototype.exports = function (libId) { return Promise.resolve(this.t.exports.filter(function (e) { return e.libraryId === libId; }).sort(function (a, b) { return b.id - a.id; }).slice(0, 6).map(copy)); };
  MemoryStore.prototype.addExport = function (e) { return this._put('exports', e); };

  var api = { MemoryStore: MemoryStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SkipStore = api;
})(typeof window !== 'undefined' ? window : this);
