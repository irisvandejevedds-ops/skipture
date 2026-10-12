/* One room's rules about who is in: the key (which only picks the room), the artist passphrase (stored only as a hash of a hash), and sessions.
   No Cloudflare imports, so it runs under node's tests too. The Durable Object in room.js wraps it. */
import { SqlStore } from './sqlstore.js';

const MAX_WRONG = 8, LOCK_MS = 10 * 60 * 1000, SESSION_MS = 14 * 24 * 3600 * 1000, MAX_SESSIONS = 200;

export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
const PROOF = /^[0-9a-f]{64}$/;

export class RoomCore {
  constructor(sql, now = () => Date.now()) { this.store = new SqlStore(sql); this.sql = sql; this.now = now; }

  exists() { return this.store.getMeta('artist_hash') !== null; }

  async session(role) {
    const raw = crypto.getRandomValues(new Uint8Array(32)), token = [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
    const t = this.now();
    this.sql.exec('DELETE FROM sessions WHERE created_at<?', t - SESSION_MS);
    this.sql.exec('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT -1 OFFSET ?)', MAX_SESSIONS);
    this.sql.exec('INSERT INTO sessions(token_hash, role, created_at) VALUES(?,?,?)', await sha256hex(token), role, t);
    return { role, token };
  }

  /** who is this? -> 'guest' | 'artist' | null */
  async who(token) {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const r = this.sql.exec('SELECT role, created_at FROM sessions WHERE token_hash=?', await sha256hex(token)).toArray()[0];
    return r && r.created_at > this.now() - SESSION_MS ? r.role : null;
  }

  /** a key alone gets guest access; a key and the passphrase's proof gets artist access. -> {status, body} */
  async enter(proof) {
    if (!this.exists()) return { status: 404, body: { none: true, error: 'No room has that key.' } };
    if (!proof) return { status: 200, body: await this.session('guest') };
    if (!PROOF.test(proof)) return { status: 400, body: { error: 'That passphrase did not arrive intact.' } };
    const lock = Number(this.store.getMeta('lock_until') || 0);
    if (lock > this.now()) return { status: 429, body: { error: `Too many wrong passphrases. Try again in ${Math.ceil((lock - this.now()) / 60000)} minutes.` } };
    if (same(await sha256hex(proof), this.store.getMeta('artist_hash'))) { this.store.setMeta('wrong', 0); return { status: 200, body: await this.session('artist') }; }
    const wrong = Number(this.store.getMeta('wrong') || 0) + 1;
    if (wrong >= MAX_WRONG) { this.store.setMeta('lock_until', this.now() + LOCK_MS); this.store.setMeta('wrong', 0); } else this.store.setMeta('wrong', wrong);
    return { status: 401, body: { error: 'That passphrase is not right for this room.' } };
  }

  /** a new key with a passphrase makes a new room, and its maker is the artist. */
  async create(proof) {
    if (!PROOF.test(proof || '')) return { status: 400, body: { error: 'That passphrase did not arrive intact.' } };
    if (this.exists()) return { status: 409, body: { error: 'A room with that key already exists.' } };
    this.store.setMeta('artist_hash', await sha256hex(proof));
    this.store.setMeta('created_at', new Date(this.now()).toISOString());
    return { status: 200, body: await this.session('artist') };
  }
}
