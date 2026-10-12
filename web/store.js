/* Where Skipture keeps its libraries: IndexedDB in the browser (so they stay on this device), or plain memory (tests, and browsers that refuse storage).
   Both give the same async calls. Records are plain objects; PNGs are Uint8Arrays. */
(function (root) {
  'use strict';

  function copy(o) { return o && Object.assign({}, o); }
  function bySort(a, b) { return a.sort - b.sort || a.id - b.id; }

  function MemoryStore() {
    this.t = { libraries: [], sprites: [], revisions: [], exports: [] }; this.n = 0; this.persistent = false;
  }
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
    var self = this, gone = this.t.sprites.filter(function (s) { return s.libraryId === id; }).map(function (s) { return s.id; });
    this.t.libraries = this.t.libraries.filter(function (l) { return l.id !== id; });
    this.t.sprites = this.t.sprites.filter(function (s) { return s.libraryId !== id; });
    this.t.revisions = this.t.revisions.filter(function (r) { return gone.indexOf(r.spriteId) < 0; });
    this.t.exports = this.t.exports.filter(function (e) { return e.libraryId !== id; });
    return Promise.resolve();
  };
  MemoryStore.prototype.sprites = function (libId) { return Promise.resolve(this.t.sprites.filter(function (s) { return s.libraryId === libId; }).sort(bySort).map(copy)); };
  MemoryStore.prototype.allSprites = function () { return Promise.resolve(this.t.sprites.map(copy)); };
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

  // ---------------- IndexedDB ----------------
  function wrap(req) { return new Promise(function (ok, bad) { req.onsuccess = function () { ok(req.result); }; req.onerror = function () { bad(req.error); }; }); }

  function IdbStore(db) { this.db = db; this.persistent = true; }
  IdbStore.open = function () {
    return new Promise(function (ok, bad) {
      var req = indexedDB.open('skipture', 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        db.createObjectStore('libraries', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('sprites', { keyPath: 'id', autoIncrement: true }).createIndex('libraryId', 'libraryId');
        db.createObjectStore('revisions', { keyPath: 'id', autoIncrement: true }).createIndex('spriteId', 'spriteId');
        db.createObjectStore('exports', { keyPath: 'id', autoIncrement: true }).createIndex('libraryId', 'libraryId');
      };
      req.onsuccess = function () { ok(new IdbStore(req.result)); };
      req.onerror = function () { bad(req.error); };
      req.onblocked = function () { bad(new Error('blocked')); };
    });
  };
  IdbStore.prototype._os = function (t, mode) { return this.db.transaction(t, mode || 'readonly').objectStore(t); };
  IdbStore.prototype._all = function (t, index, key) { var os = this._os(t); return wrap(index ? os.index(index).getAll(key) : os.getAll()); };
  IdbStore.prototype._get = function (t, id) { return wrap(this._os(t).get(id)); };
  IdbStore.prototype._put = function (t, rec) { var r = Object.assign({}, rec); if (r.id == null) delete r.id; return wrap(this._os(t, 'readwrite').put(r)).then(function (id) { r.id = id; return r; }); };
  IdbStore.prototype._del = function (t, id) { return wrap(this._os(t, 'readwrite').delete(id)); };
  IdbStore.prototype.libraries = function () { return this._all('libraries'); };
  IdbStore.prototype.library = function (id) { return this._get('libraries', id); };
  IdbStore.prototype.saveLibrary = function (l) { return this._put('libraries', l); };
  IdbStore.prototype.removeLibrary = async function (id) {
    var sprites = await this.sprites(id);
    for (var i = 0; i < sprites.length; i++) await this.removeSprite(sprites[i].id);
    var ex = await this._all('exports', 'libraryId', id);
    for (var j = 0; j < ex.length; j++) await this._del('exports', ex[j].id);
    await this._del('libraries', id);
  };
  IdbStore.prototype.sprites = function (libId) { return this._all('sprites', 'libraryId', libId).then(function (l) { return l.sort(bySort); }); };
  IdbStore.prototype.allSprites = function () { return this._all('sprites'); };
  IdbStore.prototype.sprite = function (id) { return this._get('sprites', id); };
  IdbStore.prototype.saveSprite = function (s) { return this._put('sprites', s); };
  IdbStore.prototype.removeSprite = async function (id) {
    var revs = await this._all('revisions', 'spriteId', id);
    for (var i = 0; i < revs.length; i++) await this._del('revisions', revs[i].id);
    await this._del('sprites', id);
  };
  IdbStore.prototype.revisions = function (spriteId) { return this._all('revisions', 'spriteId', spriteId).then(function (l) { return l.sort(function (a, b) { return b.id - a.id; }); }); };
  IdbStore.prototype.revision = function (id) { return this._get('revisions', id); };
  IdbStore.prototype.addRevision = function (r) { return this._put('revisions', r); };
  IdbStore.prototype.removeRevision = function (id) { return this._del('revisions', id); };
  IdbStore.prototype.exports = function (libId) { return this._all('exports', 'libraryId', libId).then(function (l) { return l.sort(function (a, b) { return b.id - a.id; }).slice(0, 6); }); };
  IdbStore.prototype.addExport = function (e) { return this._put('exports', e); };

  /** The browser's store, or memory if storage is refused (private windows in some browsers). */
  function open() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(new MemoryStore());
    return IdbStore.open().catch(function () { return new MemoryStore(); });
  }

  var api = { MemoryStore: MemoryStore, IdbStore: IdbStore, open: open };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SkipStore = api;
})(typeof window !== 'undefined' ? window : this);
