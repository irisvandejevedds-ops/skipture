import pathlib
import sqlite3
from contextlib import contextmanager

from . import clock

MIGRATIONS = pathlib.Path(__file__).parent / "migrations"


class DB:
    """Thin sqlite wrapper: autocommit by default, `with db.tx():` for atomic groups."""

    def __init__(self, path):
        self.conn = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False, timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA busy_timeout=30000")
        self._depth = 0

    def ex(self, sql, p=()):
        return self.conn.execute(sql, p)

    def q(self, sql, p=()):
        return self.conn.execute(sql, p).fetchall()

    def one(self, sql, p=()):
        return self.conn.execute(sql, p).fetchone()

    def val(self, sql, p=(), default=None):
        r = self.one(sql, p)
        return default if r is None or r[0] is None else r[0]

    @contextmanager
    def tx(self):
        if self._depth == 0:
            self.conn.execute("BEGIN IMMEDIATE")
        self._depth += 1
        try:
            yield self
        except BaseException:
            self._depth -= 1
            if self._depth == 0:
                self.conn.execute("ROLLBACK")
            raise
        else:
            self._depth -= 1
            if self._depth == 0:
                self.conn.execute("COMMIT")

    def close(self):
        self.conn.close()

    # settings helpers
    def get_setting(self, key, default=None):
        r = self.one("SELECT value FROM settings WHERE key=?", (key,))
        return default if r is None else r[0]

    def set_setting(self, key, value):
        self.ex("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, str(value)))


def migrate(db: DB):
    db.ex("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    done = {r[0] for r in db.q("SELECT version FROM schema_migrations")}
    for f in sorted(MIGRATIONS.glob("*.sql")):
        if f.name in done:
            continue
        db.conn.executescript(f.read_text())
        db.ex("INSERT INTO schema_migrations(version, applied_at) VALUES(?,?)", (f.name, clock.iso(clock.now())))


def open_db(path) -> DB:
    pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = DB(path)
    migrate(db)
    return db
