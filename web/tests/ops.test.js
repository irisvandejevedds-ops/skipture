const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib.js');
const O = require('../ops.js');
const { MemoryStore } = require('../store.js');

const px = (w, h, v) => L.encodePng(w, h, new Uint8Array(w * h * 4).fill(v));
const b = bytes => O.b64enc(bytes);
async function room() {
  const S = new MemoryStore();
  const lib = (await O.run(S, 'artist', 'createLibrary', { name: 'Frogs', app: 'Tadpole' })).id;
  const a = (await O.run(S, 'artist', 'addSlot', { libraryId: lib, slot: 'a', width: 4, height: 4 })).id;
  const c = (await O.run(S, 'artist', 'addSlot', { libraryId: lib, slot: 'c', width: 4, height: 4 })).id;
  return { S, lib, a, c };
}

test('every operation is labelled guest or artist, and the artist ones refuse a guest', async () => {
  const { S, lib, a } = await room();
  const artistOnly = Object.keys(O.OPS).filter(k => O.OPS[k] === 'artist');
  assert.deepEqual(artistOnly.sort(), ['bulkLibraries', 'bulkSprites', 'deleteLibrary', 'deleteSprite', 'editLibrary', 'editMeta', 'history', 'restore', 'setState']);
  const args = { id: a, libraryId: lib, ids: [a], action: 'delete', confirm: 'frogs', revision: 1 };
  for (const op of artistOnly) await assert.rejects(O.run(S, 'guest', op, args), O.Denied, op);
  await assert.rejects(O.exportZip(S, 'guest', lib, 'library'), O.Denied);
  await assert.rejects(O.png(S, 'guest', a, 'rev:1'), O.Denied);
  assert.equal((await S.sprites(lib)).length, 2, 'nothing was touched');
});

test('guests can look around and build', async () => {
  const { S, lib, a } = await room();
  const ov = await O.run(S, 'guest', 'overview', {});
  assert.equal(ov.libraries.length, 1); assert.equal(ov.totals.sprites, 2); assert.equal(ov.totals.submitted, 0); assert.equal(ov.libraries[0].rep.id, a);
  const lp = await O.run(S, 'guest', 'library', { id: lib });
  assert.equal(lp.sprites.length, 2); assert.deepEqual(lp.exports, []); assert.ok(lp.sprites[0].png);
  const g = (await O.run(S, 'guest', 'createLibrary', { name: 'Guest set' })).id;
  await O.run(S, 'guest', 'addSlot', { libraryId: g, slot: 'x', width: 2, height: 2 });
  assert.equal((await S.libraries()).length, 2);
});

test('a guest\'s art arrives as received (submitted), never as redrawn or humanized', async () => {
  const { S, a } = await room();
  const r = await O.run(S, 'guest', 'saveArt', { id: a, png: b(await px(4, 4, 80)), changedPx: 16, edited: true });
  assert.equal(r.state, 'raw'); assert.equal(r.word, 'as received');
  const s = await S.sprite(a);
  assert.equal(s.state, 'raw'); assert.equal(s.origin, 'guest'); assert.equal(s.changedPx, 0); assert.deepEqual(Array.from(s.png), Array.from(s.originalPng));
  const ov = await O.run(S, 'guest', 'overview', {});
  assert.equal(ov.totals.submitted, 1); assert.equal(ov.totals.humanized, 0);
  await O.run(S, 'guest', 'saveArt', { id: a, png: b(await px(4, 4, 99)) });          // a second submission replaces the first; the first goes to history
  assert.equal((await S.revisions(a)).length, 1);
  await assert.rejects(O.run(S, 'guest', 'saveArt', { id: a, png: b(await px(5, 5, 1)) }), /different size/);
});

test('once the artist has taken a slot over, a guest can no longer change it', async () => {
  const { S, a } = await room();
  await O.run(S, 'guest', 'saveArt', { id: a, png: b(await px(4, 4, 80)) });
  await O.run(S, 'artist', 'saveArt', { id: a, png: b(await px(4, 4, 120)), changedPx: 5, edited: true });
  assert.equal((await S.sprite(a)).state, 'touched');
  await assert.rejects(O.run(S, 'guest', 'saveArt', { id: a, png: b(await px(4, 4, 7)) }), O.Denied);
  assert.equal((await O.run(S, 'guest', 'sprite', { id: a })).locked, true);
  assert.equal((await O.run(S, 'artist', 'sprite', { id: a })).locked, false);
  await O.run(S, 'artist', 'setState', { id: a, action: 'humanize' });
  await assert.rejects(O.run(S, 'guest', 'saveArt', { id: a, png: b(await px(4, 4, 7)) }), O.Denied);
  assert.equal((await S.sprite(a)).state, 'humanized');
});

test('a guest cannot smuggle a sign-off in through an import, an artist can restore a backup', async () => {
  const A = await room();
  const id = A.a;
  await O.run(A.S, 'artist', 'saveArt', { id, png: b(await px(4, 4, 90)), changedPx: 4, edited: true });
  await O.run(A.S, 'artist', 'setState', { id, action: 'humanize' });
  const out = await O.exportZip(A.S, 'artist', A.lib, 'library');
  const asGuest = new MemoryStore(), asArtist = new MemoryStore();
  await O.importZip(asGuest, 'guest', out.data); await O.importZip(asArtist, 'artist', out.data);
  assert.equal((await asGuest.allSpritesMeta())[0].state, 'raw');
  assert.equal((await asArtist.allSpritesMeta())[0].state, 'humanized');
});

test('a guest import fills empty or untouched slots only', async () => {
  const { S, lib, a, c } = await room();
  await O.run(S, 'artist', 'saveArt', { id: c, png: b(await px(4, 4, 33)), changedPx: 3, edited: true });
  const schema = { format: 'skipture-library', library: { slug: 'frogs' }, sprites: [{ slot: 'a', width: 4, height: 4 }, { slot: 'c', width: 4, height: 4 }] };
  const zip = L.writeZip([{ name: 'schema.json', data: new TextEncoder().encode(JSON.stringify(schema)) }, { name: 'sprites/a.png', data: await px(4, 4, 50) }, { name: 'sprites/c.png', data: await px(4, 4, 51) }]);
  const r = await O.importZip(S, 'guest', zip);
  assert.deepEqual(r.updated, ['a']); assert.equal(r.kept.length, 1);
  assert.equal((await S.sprite(c)).state, 'touched');
});

test('bulk edits and deletes', async () => {
  const { S, lib, a, c } = await room();
  const g = (await O.run(S, 'artist', 'createLibrary', { name: 'Second' })).id;
  await assert.rejects(O.run(S, 'artist', 'bulkSprites', { ids: [a, c], action: 'meta', fields: {} }), /Choose something/);
  await O.run(S, 'artist', 'bulkSprites', { ids: [a, c], action: 'meta', fields: { kind: 'texture', tile: true, category: 'ground' } });
  const [sa, sc] = [await S.sprite(a), await S.sprite(c)];
  assert.equal(sa.kind, 'texture'); assert.equal(sc.tile, true); assert.equal(sc.category, 'ground'); assert.equal(sa.notes, '');
  await O.run(S, 'artist', 'bulkSprites', { ids: [a], action: 'meta', fields: { notes: 'hi' } });
  assert.equal((await S.sprite(a)).category, 'ground', 'fields not given are left alone');
  assert.equal((await O.run(S, 'artist', 'bulkSprites', { ids: [a, 9999], action: 'delete' })).count, 1);
  assert.equal((await S.sprites(lib)).length, 1);
  await assert.rejects(O.run(S, 'artist', 'bulkLibraries', { ids: [g], action: 'delete' }), /Confirm/);
  await O.run(S, 'artist', 'bulkLibraries', { ids: [lib, g], action: 'edit', fields: { app: 'Tadpole' } });
  assert.deepEqual((await S.libraries()).map(l => l.app), ['Tadpole', 'Tadpole']);
  await O.run(S, 'artist', 'bulkLibraries', { ids: [g], action: 'delete', confirm: true });
  assert.equal((await S.libraries()).length, 1);
  await assert.rejects(O.run(S, 'artist', 'deleteLibrary', { id: lib, confirm: 'nope' }), /exactly/);
  await O.run(S, 'artist', 'deleteLibrary', { id: lib, confirm: 'frogs' });
  assert.equal((await S.libraries()).length, 0); assert.equal((await S.stats()).sprites, 0);
});

test('the room has a size limit', async () => {
  const S = new MemoryStore();
  const lib = (await O.run(S, 'guest', 'createLibrary', { name: 'x' })).id;
  const real = S.stats.bind(S); S.stats = async () => Object.assign(await real(), { sprites: O.CAP.sprites });
  await assert.rejects(O.run(S, 'guest', 'addSlot', { libraryId: lib, slot: 'a', width: 1, height: 1 }), /room is full/);
  S.stats = async () => ({ sprites: 0, libraries: O.CAP.libraries, bytes: 0 });
  await assert.rejects(O.run(S, 'guest', 'createLibrary', { name: 'y' }), /up to 60 libraries/);
});

test('duplicate: a new slot with the same details and art; an artist keeps their redrawing but never a sign-off', async () => {
  const { S, lib, a } = await room();
  const other = (await O.run(S, 'artist', 'createLibrary', { name: 'Other' })).id;
  await O.run(S, 'artist', 'editMeta', { id: a, name: 'Frog', kind: 'texture', tile: true, category: 'ground', notes: 'hop' });
  // an empty source gives an empty copy
  let r = await O.run(S, 'guest', 'duplicate', { id: a });
  let d = await S.sprite(r.id);
  assert.equal(d.slot, 'a-copy'); assert.equal(d.name, 'Frog copy'); assert.equal(d.state, 'empty');
  assert.equal(d.kind, 'texture'); assert.equal(d.tile, true); assert.equal(d.category, 'ground'); assert.equal(d.notes, 'hop'); assert.equal(d.width, 4);
  // art comes across; the slot id is made unique
  await O.run(S, 'guest', 'saveArt', { id: a, png: b(await px(4, 4, 80)) });
  d = await S.sprite((await O.run(S, 'guest', 'duplicate', { id: a })).id);
  assert.equal(d.slot, 'a-copy-2'); assert.equal(d.state, 'raw'); assert.deepEqual(Array.from(d.png), Array.from((await S.sprite(a)).png));
  // named, into another library
  d = await S.sprite((await O.run(S, 'guest', 'duplicate', { id: a, slot: 'Moved', name: 'Elsewhere', libraryId: other })).id);
  assert.equal(d.slot, 'moved'); assert.equal(d.libraryId, other); assert.equal(d.name, 'Elsewhere');
  await assert.rejects(O.run(S, 'guest', 'duplicate', { id: a, slot: 'moved', libraryId: other }), /already exists/);
  // the artist's redrawing is kept, as redrawn; a sign-off is not copied
  await O.run(S, 'artist', 'saveArt', { id: a, png: b(await px(4, 4, 120)), changedPx: 6, edited: true });
  await O.run(S, 'artist', 'setState', { id: a, action: 'humanize' });
  d = await S.sprite((await O.run(S, 'artist', 'duplicate', { id: a })).id);
  assert.equal(d.state, 'touched'); assert.equal(d.changedPx, 6); assert.equal(d.humanizedAt, null);
  assert.deepEqual(Array.from(d.png), Array.from((await S.sprite(a)).png)); assert.deepEqual(Array.from(d.originalPng), Array.from((await S.sprite(a)).originalPng));
  // a guest copying it gets the picture as received, not as the artist's work
  d = await S.sprite((await O.run(S, 'guest', 'duplicate', { id: a })).id);
  assert.equal(d.state, 'raw'); assert.equal(d.changedPx, 0);
});

test('copy over: the art moves, the target keeps its details, sizes must match, guests cannot overwrite the artist\'s work', async () => {
  const { S, lib, a, c } = await room();
  const big = (await O.run(S, 'artist', 'addSlot', { libraryId: lib, slot: 'big', width: 8, height: 8 })).id;
  await O.run(S, 'artist', 'editMeta', { id: c, name: 'Keep me', kind: 'texture', tile: true, category: 'keep', notes: 'n' });
  await O.run(S, 'guest', 'saveArt', { id: a, png: b(await px(4, 4, 70)) });
  const same = await O.run(S, 'guest', 'sameSize', { id: a });
  assert.deepEqual(same.sprites.map(x => x.slot).sort(), ['c']);                 // not itself, not the 8x8
  await assert.rejects(O.run(S, 'guest', 'copyOver', { from: a, to: big }), /same size/);
  await assert.rejects(O.run(S, 'guest', 'copyOver', { from: a, to: a }), /different sprite/);
  const r = await O.run(S, 'guest', 'copyOver', { from: a, to: c });
  assert.equal(r.state, 'raw');
  let t = await S.sprite(c);
  assert.deepEqual(Array.from(t.png), Array.from((await S.sprite(a)).png));
  assert.equal(t.name, 'Keep me'); assert.equal(t.slot, 'c'); assert.equal(t.kind, 'texture'); assert.equal(t.tile, true); assert.equal(t.category, 'keep'); assert.equal(t.notes, 'n');
  // the artist copying makes it redrawn (as a save would), and a guest can no longer copy onto it
  await O.run(S, 'artist', 'copyOver', { from: a, to: c, changedPx: 9 });
  t = await S.sprite(c); assert.equal(t.state, 'touched'); assert.equal(t.changedPx, 9); assert.equal(t.name, 'Keep me');
  await assert.rejects(O.run(S, 'guest', 'copyOver', { from: a, to: c }), O.Denied);
  assert.deepEqual((await O.run(S, 'guest', 'sameSize', { id: a })).sprites, []);   // locked slots are not even offered
  assert.deepEqual((await O.run(S, 'artist', 'sameSize', { id: a })).sprites.map(x => x.slot), ['c']);
  // an empty source empties the target
  const e = (await O.run(S, 'artist', 'addSlot', { libraryId: lib, slot: 'e', width: 4, height: 4 })).id;
  await O.run(S, 'artist', 'copyOver', { from: e, to: c });
  assert.equal((await S.sprite(c)).state, 'empty');
});
