// Drives a running copy of the real Worker (wrangler dev) over HTTP. Skipped unless SKIPTURE_URL is set, e.g.  SKIPTURE_URL=http://localhost:8788 node --test tests/e2e.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import L from '../../web/lib.js';
import ops from '../../web/ops.js';

const BASE = process.env.SKIPTURE_URL, skip = !BASE && 'set SKIPTURE_URL to run against a live Worker';
const unique = () => 'room-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
const proof = async (key, pass) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  return [...new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('skipture-artist:' + key), iterations: 1000 }, k, 256))].map((b) => b.toString(16).padStart(2, '0')).join('');
};
async function post(path, body, who, raw) {
  const h = { 'Content-Type': raw ? 'application/zip' : 'application/json' };
  if (who) { h.Authorization = 'Bearer ' + who.token; h['X-Room'] = who.room; }
  const r = await fetch(BASE + '/api/' + path, { method: 'POST', headers: h, body: raw ? body : JSON.stringify(body) });
  return r;
}
const rpc = async (who, op, args) => { const r = await post('rpc', { op, args }, who); return { status: r.status, body: await r.json() }; };

test('rooms over HTTP: create, enter as guest and artist, and what each may do', { skip }, async () => {
  const key = unique(), pass = 'violet harbour 42';
  let r = await post('enter', { key }); assert.equal(r.status, 404);
  r = await post('create', { key: 'short', proof: await proof('short', pass) }); assert.equal(r.status, 400);
  r = await post('create', { key, proof: await proof(key, pass) }); assert.equal(r.status, 200);
  const artist = await r.json(); assert.equal(artist.role, 'artist'); assert.match(artist.room, /^[0-9a-f]{64}$/);
  r = await post('create', { key, proof: await proof(key, 'someone else') }); assert.equal(r.status, 409);
  r = await post('enter', { key }); const guest = await r.json(); assert.equal(guest.role, 'guest'); assert.equal(guest.room, artist.room);
  r = await post('enter', { key, proof: await proof(key, 'wrong') }); assert.equal(r.status, 401);
  r = await post('enter', { key, proof: await proof(key, pass) }); assert.equal((await r.json()).role, 'artist');

  const lib = (await rpc(artist, 'createLibrary', { name: 'Frogs', app: 'Tadpole' })).body.id;
  const a = (await rpc(guest, 'addSlot', { libraryId: lib, slot: 'a', width: 4, height: 4 })).body.id;
  const art = await L.encodePng(4, 4, new Uint8Array(64).fill(90));
  assert.equal((await rpc(guest, 'saveArt', { id: a, png: ops.b64enc(art) })).body.state, 'raw');
  assert.equal((await rpc(guest, 'setState', { id: a, action: 'humanize' })).status, 403);
  assert.equal((await rpc(guest, 'deleteLibrary', { id: lib, confirm: 'frogs' })).status, 403);
  assert.equal((await rpc(artist, 'overview', {})).body.totals.submitted, 1);
  await rpc(artist, 'saveArt', { id: a, png: ops.b64enc(art), changedPx: 3, edited: true });
  assert.equal((await rpc(guest, 'saveArt', { id: a, png: ops.b64enc(art) })).status, 403);

  const png = await fetch(`${BASE}/api/png?id=${a}&which=current`, { headers: { Authorization: 'Bearer ' + guest.token, 'X-Room': guest.room } });
  assert.equal(png.status, 200); assert.deepEqual(Array.from(new Uint8Array(await png.arrayBuffer())), Array.from(art));
  assert.equal((await fetch(`${BASE}/api/png?id=${a}&which=rev:1`, { headers: { Authorization: 'Bearer ' + guest.token, 'X-Room': guest.room } })).status, 403);

  assert.equal((await post('export', { id: lib, purpose: 'library' }, guest)).status, 403);
  const ex = await post('export', { id: lib, purpose: 'library' }, artist);
  assert.equal(ex.status, 200); const zip = new Uint8Array(await ex.arrayBuffer()); assert.match(ex.headers.get('X-Filename'), /frogs-/);
  const imp = await post('import', zip, guest, true); assert.equal(imp.status, 200);
  const report = await imp.json(); assert.equal(report.created, false); assert.equal(report.kept.length, 1);
  assert.equal((await post('import', zip, { room: artist.room, token: '0'.repeat(64) }, true)).status, 401);

  assert.equal((await post('destroy', {}, guest)).status, 403);
  assert.equal((await post('destroy', {}, artist)).status, 200);
  assert.equal((await post('enter', { key })).status, 404);
});

test('the door rejects nonsense and does not leak rooms', { skip }, async () => {
  assert.equal((await post('enter', { key: '' })).status, 400);
  assert.equal((await fetch(BASE + '/api/enter')).status, 405);
  assert.equal((await post('rpc', { op: 'overview' })).status, 401);
  assert.equal((await post('rpc', { op: 'overview' }, { room: 'f'.repeat(64), token: 'e'.repeat(64) })).status, 401);
  assert.equal((await fetch(BASE + '/api/whatever')).status, 404);
  const r = await post('enter', { key: unique() }); assert.equal(r.status, 404); assert.equal((await r.json()).none, true);
});
