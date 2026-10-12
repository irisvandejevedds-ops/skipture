const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('../lib.js');
const { MemoryStore } = require('../store.js');

const checkerPx = (w, h) => { const p = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) if (i % 2) { p[i * 4] = 200; p[i * 4 + 1] = 60; p[i * 4 + 2] = 40; p[i * 4 + 3] = 255; } return p; };
const png = (w, h) => L.encodePng(w, h, checkerPx(w, h));
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function lib(S, name = 'Frogs') { return L.createLibrary(S, { name, app: 'Tadpole' }); }

test('slugs and ids', async () => {
  assert.equal(L.slugify('Tadpole Frogs!'), 'tadpole-frogs');
  assert.equal(L.slugify('???'), 'library');
  const S = new MemoryStore();
  await lib(S); await lib(S);
  assert.deepEqual((await S.libraries()).map(l => l.slug), ['frogs', 'frogs-2']);
  await assert.rejects(L.createLibrary(S, { name: '  ' }), /name/);
});

test('slots: validation, size, blank art starts empty', async () => {
  const S = new MemoryStore(), id = await lib(S);
  const sid = await L.addSlot(S, id, { slot: 'Frog-0', name: 'Frog', width: 8, height: 6 });
  const s = await S.sprite(sid);
  assert.equal(s.slot, 'frog-0'); assert.equal(s.state, 'empty'); assert.deepEqual(L.pngInfo(s.png), [8, 6]);
  await assert.rejects(L.addSlot(S, id, { slot: 'frog-0', width: 4, height: 4 }), /already exists/);
  await assert.rejects(L.addSlot(S, id, { slot: 'bad id', width: 4, height: 4 }), /not a usable slot id/);
  await assert.rejects(L.addSlot(S, id, { slot: 'big', width: 513, height: 4 }), /between 1 and 512/);
  await assert.rejects(L.addSlot(S, id, { slot: 'wrong', width: 5, height: 5, art: await png(4, 4) }), /4x4, but the slot is 5x5/);
});

test('the PNGs we write are real PNGs, and the zips we write are real zips (checked by the server\'s own Python)', async () => {
  const S = new MemoryStore(), id = await lib(S);
  await L.addSlot(S, id, { slot: 'frog', width: 8, height: 6, art: await png(8, 6), origin: 'app' });
  await L.addSlot(S, id, { slot: 'grass', width: 4, height: 4, kind: 'texture', tile: true, bgMode: 'opaque', bgColor: '#336633' });
  for (const purpose of ['schema', 'library']) {
    const out = await L.exportZip(S, id, purpose);
    const f = path.join(os.tmpdir(), `skip-${process.pid}-${purpose}.zip`);
    fs.writeFileSync(f, out.data);
    const r = spawnSync('python3', [path.join(__dirname, 'check_zip.py'), f], { encoding: 'utf8' });
    fs.unlinkSync(f);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  assert.match((await L.exportZip(S, id, 'library')).name, /frogs-partial\.zip/);
  assert.match((await L.exportZip(S, id, 'schema')).name, /frogs-schema\.zip/);
});

test('reads a zip the Python server made (compressed entries) and creates the library', async () => {
  const S = new MemoryStore();
  const r = await L.importZip(S, new Uint8Array(fs.readFileSync(path.join(__dirname, 'server-export.zip'))));
  assert.equal(r.created, true); assert.deepEqual(r.added.sort(), ['frog', 'grass']); assert.deepEqual(r.problems, []);
  const sprites = await S.sprites(r.library.id);
  assert.equal(sprites.length, 2);
  const grass = sprites.find(s => s.slot === 'grass');
  assert.equal(grass.bgMode, 'opaque'); assert.equal(grass.bgColor, '#336633'); assert.equal(grass.tile, true); assert.equal(grass.state, 'raw');
});

test('merging: new art goes only where it is safe', async () => {
  const S = new MemoryStore(), id = await lib(S);
  for (const slot of ['a', 'b', 'c', 'd']) await L.addSlot(S, id, { slot, width: 4, height: 4 });
  const by = async slot => (await S.sprites(id)).find(s => s.slot === slot);
  const art = await png(4, 4), other = await L.encodePng(4, 4, new Uint8Array(64).fill(90));
  await L.saveArt(S, (await by('b')).id, art, 3, false, true);                                  // b: redrawn by hand
  await L.saveArt(S, (await by('c')).id, art, 3, false, true); await L.setState(S, (await by('c')).id, 'humanize');   // c: signed off
  const schema = slot => ({ slot, name: slot, kind: 'sprite', width: 4, height: 4, tile: false, background: 'transparent' });
  const zip = L.writeZip([{ name: 'schema.json', data: new TextEncoder().encode(JSON.stringify({ format: 'skipture-library', version: 1, library: { slug: 'frogs', name: 'Frogs' },
    sprites: ['a', 'b', 'c', 'd', 'zz'].map(schema) })) }, { name: 'sprites/a.png', data: other }, { name: 'sprites/b.png', data: other }, { name: 'sprites/c.png', data: other }, { name: 'sprites/zz.png', data: other }]);
  const r = await L.importZip(S, zip);
  assert.equal(r.created, false);
  assert.deepEqual(r.updated, ['a']);
  assert.equal(r.kept.length, 2);
  assert.ok(r.skipped.some(s => /^d: no sprites\/d\.png/.test(s)) && r.skipped.some(s => /^zz: not a slot/.test(s)));
  assert.equal((await by('a')).state, 'raw'); assert.equal((await by('b')).state, 'touched'); assert.equal((await by('c')).state, 'humanized');
  assert.ok(eq((await by('a')).png, other));
});

test('a wrong-sized picture is a problem, not a crash', async () => {
  const S = new MemoryStore(), id = await lib(S);
  await L.addSlot(S, id, { slot: 'a', width: 4, height: 4 });
  const zip = L.writeZip([{ name: 'schema.json', data: new TextEncoder().encode(JSON.stringify({ format: 'skipture-library', library: { slug: 'frogs' }, sprites: [{ slot: 'a', width: 4, height: 4 }] })) }, { name: 'sprites/a.png', data: await png(6, 6) }]);
  const r = await L.importZip(S, zip);
  assert.equal(r.problems.length, 1); assert.match(r.problems[0], /6x6 but the slot is 4x4/);
});

test('bad zips are refused in plain words', async () => {
  const S = new MemoryStore();
  await assert.rejects(L.importZip(S, new TextEncoder().encode('hello')), /not a zip/);
  await assert.rejects(L.importZip(S, L.writeZip([{ name: 'x.txt', data: new Uint8Array(3) }])), /no schema\.json/);
  await assert.rejects(L.importZip(S, L.writeZip([{ name: 'schema.json', data: new TextEncoder().encode('{') }])), /not valid JSON/);
  await assert.rejects(L.importZip(S, L.writeZip([{ name: 'schema.json', data: new TextEncoder().encode('{"format":"other"}') }])), /not a Skipture library schema/);
  assert.equal((await S.libraries()).length, 0);
});

test('a zip that lies about its size is stopped', async () => {
  const body = new TextEncoder().encode('x'.repeat(100));
  const zip = L.writeZip([{ name: 'schema.json', data: body }]);
  const dv = new DataView(zip.buffer);
  dv.setUint32(22, 3, true); // local header says 3 bytes... the central directory is what we trust
  const z = L.readZip(zip);
  assert.ok((await z.read('schema.json', 1000)).length === 100);
});

test('progress, sign-off and history', async () => {
  const S = new MemoryStore(), id = await lib(S);
  const ids = []; for (const slot of ['a', 'b', 'c']) ids.push(await L.addSlot(S, id, { slot, width: 4, height: 4, art: await png(4, 4) }));
  assert.equal(L.progress(await S.sprites(id)).pct, 0);
  await assert.rejects(L.setState(S, await L.addSlot(S, id, { slot: 'e', width: 4, height: 4 }), 'humanize'), /no art/);
  const edited = await L.encodePng(4, 4, new Uint8Array(64).fill(7));
  assert.equal(await L.saveArt(S, ids[0], edited, 5, false, true), 'touched');
  await L.setState(S, ids[0], 'humanize');
  let p = L.progress(await S.sprites(id));
  assert.equal(p.humanized, 1); assert.equal(p.pct, 25); assert.equal(p.counts.empty, 1);
  assert.equal(await L.saveArt(S, ids[0], edited, 6, false, true), 'touched');        // editing humanized work drops it back
  assert.equal((await S.sprite(ids[0])).humanizedAt, null);
  assert.equal((await S.revisions(ids[0])).length, 2);
  await L.setState(S, ids[0], 'reset');
  assert.equal((await S.sprite(ids[0])).state, 'raw');
  const revs = await S.revisions(ids[0]);
  await L.restoreRevision(S, ids[0], revs[revs.length - 1].id);
  assert.equal((await S.sprite(ids[0])).state, 'raw');                                 // the oldest revision is the original art
  await assert.rejects(L.saveArt(S, ids[1], await png(5, 5), 0, false, true), /different size/);
});

test('only the newest 25 versions are kept', async () => {
  const S = new MemoryStore(), id = await lib(S), sid = await L.addSlot(S, id, { slot: 'a', width: 2, height: 2, art: await png(2, 2) });
  for (let i = 0; i < 30; i++) await L.saveArt(S, sid, await L.encodePng(2, 2, new Uint8Array(16).fill(i)), 1, false, true);
  assert.equal((await S.revisions(sid)).length, 25);
});

test('a finished library exported then imported on a fresh browser keeps its progress (backup)', async () => {
  const A = new MemoryStore(), id = await lib(A);
  const a = await L.addSlot(A, id, { slot: 'a', width: 4, height: 4, art: await png(4, 4) });
  await L.addSlot(A, id, { slot: 'b', width: 4, height: 4, art: await png(4, 4) });
  await L.saveArt(A, a, await L.encodePng(4, 4, new Uint8Array(64).fill(9)), 4, false, true); await L.setState(A, a, 'humanize');
  const out = await L.exportZip(A, id, 'library');
  const B = new MemoryStore(), r = await L.importZip(B, out.data, 'backup');
  const got = await B.sprites(r.library.id);
  assert.deepEqual(got.map(s => s.state), ['humanized', 'raw']);
  assert.ok(got[0].humanizedAt);
});

test('web/core.js is the very same file the server serves', () => {
  assert.ok(fs.readFileSync(path.join(__dirname, '../core.js')).equals(fs.readFileSync(path.join(__dirname, '../../app/skipture/static/core.js'))));
});
