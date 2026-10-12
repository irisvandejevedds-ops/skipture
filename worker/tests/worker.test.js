import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSql } from './sqlshim.js';
import { SqlStore } from '../sqlstore.js';
import { RoomCore, sha256hex } from '../roomcore.js';
import ops from '../../web/ops.js';
import L from '../../web/lib.js';

const px = (w, h, v) => L.encodePng(w, h, new Uint8Array(w * h * 4).fill(v));
const proofOf = (s) => sha256hex('proof:' + s);

test('the SQL store keeps sprites, versions and exports, and cleans up after itself', async () => {
  const S = new SqlStore(makeSql());
  const lib = await S.saveLibrary({ slug: 'frogs', name: 'Frogs', app: 'Tadpole', description: '', createdAt: 't', updatedAt: 't' });
  const png = await px(4, 4, 70);
  const sp = await S.saveSprite({ libraryId: lib.id, slot: 'a', name: 'A', kind: 'sprite', width: 4, height: 4, tile: true, bgMode: 'transparent', bgColor: '#FFFFFF', category: '', notes: 'n', png, originalPng: png, state: 'raw', origin: 'app', changedPx: 0, humanizedAt: null, sort: 1, createdAt: 't', updatedAt: 't' });
  const back = await S.sprite(sp.id);
  assert.deepEqual(Array.from(back.png), Array.from(png)); assert.equal(back.tile, true); assert.equal(back.libraryId, lib.id);
  assert.equal((await S.spritesMeta(lib.id))[0].pngSize, png.length); assert.equal((await S.spritesMeta(lib.id))[0].png, undefined);
  await S.addRevision({ spriteId: sp.id, png, state: 'raw', note: 'x', createdAt: 't' });
  await S.addExport({ libraryId: lib.id, kind: 'schema', complete: false, humanized: 0, total: 1, createdAt: 't' });
  assert.equal((await S.stats()).sprites, 1); assert.ok((await S.stats()).bytes > png.length * 2);
  back.name = 'Renamed'; await S.saveSprite(back);
  assert.equal((await S.sprites(lib.id)).length, 1); assert.equal((await S.sprite(sp.id)).name, 'Renamed');
  await S.removeLibrary(lib.id);
  assert.deepEqual(await S.stats(), { sprites: 0, libraries: 0, bytes: 0 });
  assert.equal((await S.revisions(sp.id)).length, 0);
});

test('the same rules run on the SQL store: guests submit, the artist takes over, import and export work', async () => {
  const S = new SqlStore(makeSql());
  const lib = (await ops.run(S, 'artist', 'createLibrary', { name: 'Frogs', app: 'Tadpole' })).id;
  const a = (await ops.run(S, 'guest', 'addSlot', { libraryId: lib, slot: 'a', width: 4, height: 4 })).id;
  assert.equal((await ops.run(S, 'guest', 'saveArt', { id: a, png: ops.b64enc(await px(4, 4, 80)) })).state, 'raw');
  assert.equal((await ops.run(S, 'guest', 'overview', {})).totals.submitted, 1);
  await ops.run(S, 'artist', 'saveArt', { id: a, png: ops.b64enc(await px(4, 4, 120)), changedPx: 6, edited: true });
  await assert.rejects(ops.run(S, 'guest', 'saveArt', { id: a, png: ops.b64enc(await px(4, 4, 7)) }), ops.Denied);
  await ops.run(S, 'artist', 'setState', { id: a, action: 'humanize' });
  assert.equal((await ops.run(S, 'artist', 'overview', {})).totals.humanized, 1);
  const out = await ops.exportZip(S, 'artist', lib, 'library');
  const T = new SqlStore(makeSql());
  const rep = await ops.importZip(T, 'artist', out.data);
  assert.equal(rep.created, true); assert.equal((await T.allSpritesMeta())[0].state, 'humanized');
  const hist = await ops.run(S, 'artist', 'history', { id: a });
  assert.ok(hist.revisions.length >= 1);
  assert.deepEqual(Array.from(await ops.png(S, 'artist', a, 'rev:' + hist.revisions[0].id)).slice(0, 4), [137, 80, 78, 71]);
});

test('rooms: a key alone is a guest, key plus passphrase is the artist, and a new key makes a room', async () => {
  const core = new RoomCore(makeSql());
  assert.equal(core.exists(), false);
  assert.equal((await core.enter('')).status, 404);                       // nothing there yet: the page offers to create
  assert.equal((await core.create('short')).status, 400);                  // not a real proof
  const made = await core.create(await proofOf('violet harbour')), art = made.body.token;
  assert.equal(made.status, 200); assert.equal(made.body.role, 'artist'); assert.equal(await core.who(art), 'artist');
  assert.equal((await core.create(await proofOf('someone else'))).status, 409);   // nobody can take over an existing room
  const g = await core.enter(''); assert.equal(g.body.role, 'guest'); assert.equal(await core.who(g.body.token), 'guest');
  const a2 = await core.enter(await proofOf('violet harbour')); assert.equal(a2.body.role, 'artist');
  const bad = await core.enter(await proofOf('guess')); assert.equal(bad.status, 401);
  assert.equal(await core.who('0'.repeat(64)), null); assert.equal(await core.who('nonsense'), null); assert.equal(await core.who(''), null);
  assert.equal(core.sql.exec('SELECT COUNT(*) n FROM sessions WHERE token_hash=?', art).one().n, 0, 'tokens are stored only as hashes');
  assert.equal(core.store.getMeta('artist_hash').includes('violet'), false);
});

test('too many wrong passphrases lock the artist door for a while, but not the guest door', async () => {
  let clock = 1_000_000;
  const core = new RoomCore(makeSql(), () => clock);
  await core.create(await proofOf('right one'));
  for (let i = 0; i < 7; i++) assert.equal((await core.enter(await proofOf('wrong ' + i))).status, 401);
  assert.equal((await core.enter(await proofOf('wrong 8'))).status, 401);
  const locked = await core.enter(await proofOf('right one'));
  assert.equal(locked.status, 429); assert.match(locked.body.error, /Try again in 10 minutes/);
  assert.equal((await core.enter('')).body.role, 'guest');
  clock += 11 * 60 * 1000;
  assert.equal((await core.enter(await proofOf('right one'))).body.role, 'artist');
});

test('sessions expire, and the room keeps only the newest 200', async () => {
  let clock = 5_000_000_000;
  const core = new RoomCore(makeSql(), () => clock);
  await core.create(await proofOf('p'));
  const old = (await core.enter('')).body.token;
  clock += 15 * 24 * 3600 * 1000;
  assert.equal(await core.who(old), null);
  for (let i = 0; i < 210; i++) { clock += 1; await core.enter(''); }
  assert.ok(core.sql.exec('SELECT COUNT(*) n FROM sessions').one().n <= 201);
});
