import hashlib
import secrets
import time
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from . import clock

COOKIE = "sk_session"
SESSION_DAYS = 90
MIN_PASSPHRASE = 10
_ph = PasswordHasher()
_fails = []
LOCK_WINDOW, LOCK_AFTER = 600, 5


def has_passphrase(db):
    return db.get_setting("passphrase_hash") is not None


def set_passphrase(db, pw):
    db.set_setting("passphrase_hash", _ph.hash(pw))


def check_passphrase(db, pw):
    h = db.get_setting("passphrase_hash")
    if not h:
        return False
    try:
        return _ph.verify(h, pw)
    except (VerifyMismatchError, InvalidHashError):
        return False


def locked():
    cutoff = time.monotonic() - LOCK_WINDOW
    _fails[:] = [t for t in _fails if t > cutoff]
    return len(_fails) >= LOCK_AFTER


def record_fail():
    _fails.append(time.monotonic())


def reset_fails():
    _fails.clear()


def _h(token):
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db, ua=""):
    token = secrets.token_urlsafe(32)
    now = clock.now()
    db.ex("INSERT INTO sessions(token_hash,created_at,last_seen,expires_at,user_agent) VALUES(?,?,?,?,?)",
          (_h(token), clock.iso(now), clock.iso(now), clock.iso(now + timedelta(days=SESSION_DAYS)), ua[:200]))
    return token


def lookup_session(db, token):
    if not token:
        return None
    r = db.one("SELECT * FROM sessions WHERE token_hash=?", (_h(token),))
    if not r or r["expires_at"] < clock.iso(clock.now()):
        return None
    db.ex("UPDATE sessions SET last_seen=? WHERE token_hash=?", (clock.iso(clock.now()), _h(token)))
    return r


def destroy_session(db, token):
    db.ex("DELETE FROM sessions WHERE token_hash=?", (_h(token or ""),))
