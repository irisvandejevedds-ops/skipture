/* A room's libraries in the Durable Object's SQLite database. Same calls as the in-memory store in web/store.js, so web/lib.js and web/ops.js run unchanged.
   `sql` is the Durable Object's ctx.storage.sql (or anything with exec(query, ...bindings) -> {toArray(), one()}). */

function u8(x) { return x == null ? x : x instanceof Uint8Array ? x : new Uint8Array(x); }
function ab(b) { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS libraries(id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, app TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sprites(id INTEGER PRIMARY KEY AUTOINCREMENT, library_id INTEGER NOT NULL, slot TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
     tile INTEGER NOT NULL DEFAULT 0, bg_mode TEXT NOT NULL, bg_color TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', png BLOB NOT NULL, original_png BLOB NOT NULL,
     state TEXT NOT NULL, origin TEXT NOT NULL, changed_px INTEGER NOT NULL DEFAULT 0, humanized_at TEXT, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(library_id, slot))`,
  `CREATE INDEX IF NOT EXISTS ix_sprites_lib ON sprites(library_id)`,
  `CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, sprite_id INTEGER NOT NULL, png BLOB NOT NULL, state TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS ix_revisions_sprite ON revisions(sprite_id)`,
  `CREATE TABLE IF NOT EXISTS exports(id INTEGER PRIMARY KEY AUTOINCREMENT, library_id INTEGER NOT NULL, kind TEXT NOT NULL, complete INTEGER NOT NULL, humanized INTEGER NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, created_at INTEGER NOT NULL)`,
];

const META_COLS = 'id, library_id, slot, name, kind, width, height, tile, bg_mode, bg_color, category, notes, state, origin, changed_px, humanized_at, sort, created_at, updated_at';

function lib(r) { return r && { id: r.id, slug: r.slug, name: r.name, app: r.app, description: r.description, createdAt: r.created_at, updatedAt: r.updated_at }; }
function sprite(r) {
  return r && { id: r.id, libraryId: r.library_id, slot: r.slot, name: r.name, kind: r.kind, width: r.width, height: r.height, tile: !!r.tile, bgMode: r.bg_mode, bgColor: r.bg_color, category: r.category, notes: r.notes,
    png: u8(r.png), originalPng: u8(r.original_png), state: r.state, origin: r.origin, changedPx: r.changed_px, humanizedAt: r.humanized_at, sort: r.sort, createdAt: r.created_at, updatedAt: r.updated_at };
}
function spriteMeta(r) { const s = sprite(r); delete s.png; delete s.originalPng; s.pngSize = r.png_size || 0; return s; }
function rev(r) { return r && { id: r.id, spriteId: r.sprite_id, png: u8(r.png), state: r.state, note: r.note, createdAt: r.created_at }; }

export class SqlStore {
  constructor(sql) {
    this.sql = sql;
    for (const q of SCHEMA) sql.exec(q);
  }
  all(q, ...b) { return this.sql.exec(q, ...b).toArray(); }
  one(q, ...b) { return this.all(q, ...b)[0]; }

  async libraries() { return this.all('SELECT * FROM libraries').map(lib); }
  async library(id) { return lib(this.one('SELECT * FROM libraries WHERE id=?', id)); }
  async saveLibrary(l) {
    const r = this.one('INSERT OR REPLACE INTO libraries(id,slug,name,app,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?) RETURNING id', l.id ?? null, l.slug, l.name, l.app || '', l.description || '', l.createdAt, l.updatedAt);
    return { ...l, id: r.id };
  }
  async removeLibrary(id) {
    this.sql.exec('DELETE FROM revisions WHERE sprite_id IN (SELECT id FROM sprites WHERE library_id=?)', id);
    this.sql.exec('DELETE FROM sprites WHERE library_id=?', id);
    this.sql.exec('DELETE FROM exports WHERE library_id=?', id);
    this.sql.exec('DELETE FROM libraries WHERE id=?', id);
  }

  async sprites(libId) { return this.all('SELECT * FROM sprites WHERE library_id=? ORDER BY sort, id', libId).map(sprite); }
  async spritesMeta(libId) { return this.all(`SELECT ${META_COLS}, length(png) AS png_size FROM sprites WHERE library_id=? ORDER BY sort, id`, libId).map(spriteMeta); }
  async allSpritesMeta() { return this.all(`SELECT ${META_COLS}, length(png) AS png_size FROM sprites ORDER BY sort, id`).map(spriteMeta); }
  async sprite(id) { return sprite(this.one('SELECT * FROM sprites WHERE id=?', id)); }
  async saveSprite(s) {
    const r = this.one(`INSERT OR REPLACE INTO sprites(id,library_id,slot,name,kind,width,height,tile,bg_mode,bg_color,category,notes,png,original_png,state,origin,changed_px,humanized_at,sort,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, s.id ?? null, s.libraryId, s.slot, s.name, s.kind, s.width, s.height, s.tile ? 1 : 0, s.bgMode, s.bgColor, s.category || '', s.notes || '',
      ab(s.png), ab(s.originalPng), s.state, s.origin, s.changedPx || 0, s.humanizedAt ?? null, s.sort || 0, s.createdAt, s.updatedAt);
    return { ...s, id: r.id };
  }
  async removeSprite(id) {
    this.sql.exec('DELETE FROM revisions WHERE sprite_id=?', id);
    this.sql.exec('DELETE FROM sprites WHERE id=?', id);
  }
  async stats() {
    const s = this.one('SELECT COUNT(*) n, COALESCE(SUM(length(png)+length(original_png)),0) b FROM sprites');
    const r = this.one('SELECT COALESCE(SUM(length(png)),0) b FROM revisions');
    return { sprites: s.n, libraries: this.one('SELECT COUNT(*) n FROM libraries').n, bytes: s.b + r.b };
  }

  async revisions(spriteId) { return this.all('SELECT * FROM revisions WHERE sprite_id=? ORDER BY id DESC', spriteId).map(rev); }
  async revision(id) { return rev(this.one('SELECT * FROM revisions WHERE id=?', id)); }
  async addRevision(r) {
    const x = this.one('INSERT INTO revisions(sprite_id,png,state,note,created_at) VALUES(?,?,?,?,?) RETURNING id', r.spriteId, ab(r.png), r.state, r.note, r.createdAt);
    return { ...r, id: x.id };
  }
  async removeRevision(id) { this.sql.exec('DELETE FROM revisions WHERE id=?', id); }

  async exports(libId) {
    return this.all('SELECT * FROM exports WHERE library_id=? ORDER BY id DESC LIMIT 6', libId).map((e) => ({ id: e.id, libraryId: e.library_id, kind: e.kind, complete: !!e.complete, humanized: e.humanized, total: e.total, createdAt: e.created_at }));
  }
  async addExport(e) {
    const x = this.one('INSERT INTO exports(library_id,kind,complete,humanized,total,created_at) VALUES(?,?,?,?,?,?) RETURNING id', e.libraryId, e.kind, e.complete ? 1 : 0, e.humanized, e.total, e.createdAt);
    return { ...e, id: x.id };
  }

  getMeta(k) { const r = this.one('SELECT v FROM meta WHERE k=?', k); return r ? r.v : null; }
  setMeta(k, v) { this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', k, String(v)); }
}
