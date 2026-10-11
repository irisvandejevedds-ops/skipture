CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT NOT NULL DEFAULT '');

-- a library is a set of sprite and texture slots that belong to one app (or one outside developer)
CREATE TABLE libraries(
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, app TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

-- one slot. png is the current art, original_png is the art as it first arrived (what "humanizing" is measured against).
-- state: empty (no art yet) | raw (as received) | touched (redrawn but not signed off) | humanized (signed off by hand)
CREATE TABLE sprites(
  id INTEGER PRIMARY KEY AUTOINCREMENT, library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  slot TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'sprite',      -- sprite | texture
  width INTEGER NOT NULL, height INTEGER NOT NULL, tile INTEGER NOT NULL DEFAULT 0,
  bg_mode TEXT NOT NULL DEFAULT 'transparent', bg_color TEXT NOT NULL DEFAULT '#FFFFFF',
  category TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  png BLOB NOT NULL, original_png BLOB NOT NULL, state TEXT NOT NULL DEFAULT 'empty',
  changed_px INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'blank',      -- blank | app | developer | drawn
  humanized_at TEXT, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(library_id, slot));
CREATE INDEX ix_sprites_lib ON sprites(library_id, sort);

-- earlier versions of a sprite, newest kept: a safety net for hand-drawn work
CREATE TABLE revisions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, sprite_id INTEGER NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  png BLOB NOT NULL, state TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX ix_revisions_sprite ON revisions(sprite_id, id);

-- a record of what was sent out: schemas for developers, finished libraries going back
CREATE TABLE exports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, complete INTEGER NOT NULL DEFAULT 0, humanized INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
