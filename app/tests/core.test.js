const test = require('node:test');
const assert = require('node:assert');
const C = require('../skipture/static/core.js');
const { Doc, pack } = C;

const RED = pack(255, 0, 0, 255), BLUE = pack(0, 0, 255, 255), WHITE = pack(255, 255, 255, 255);

function stroke(d, pts, color) {
  d.beginStroke();
  let last = null;
  for (const [x, y] of pts) { if (last) d.line(last[0], last[1], x, y, color); else d.paint(x, y, color); last = [x, y]; }
  return d.endStroke();
}

test('pen paints single pixels and undo/redo restore them exactly', () => {
  const d = new Doc(4, 4);
  stroke(d, [[1, 1]], RED);
  assert.equal(d.get(1, 1), RED);
  assert.equal(d.get(2, 1), 0);
  d.undo();
  assert.equal(d.get(1, 1), 0);
  assert.ok(d.canRedo());
  d.redo();
  assert.equal(d.get(1, 1), RED);
  assert.ok(!d.canRedo());
});

test('a drag leaves no gaps: every column of a shallow line is painted and neighbours touch', () => {
  const d = new Doc(8, 8);
  d.beginStroke();
  const changed = d.line(0, 0, 7, 3, RED);
  d.endStroke();
  assert.equal(changed.length, 8);
  for (let x = 0; x < 8; x++) assert.ok(changed.some((i) => i % 8 === x), 'column ' + x + ' is painted');
  for (let k = 1; k < changed.length; k++) {
    const dx = Math.abs((changed[k] % 8) - (changed[k - 1] % 8)), dy = Math.abs(Math.floor(changed[k] / 8) - Math.floor(changed[k - 1] / 8));
    assert.ok(dx <= 1 && dy <= 1, 'consecutive pixels are neighbours');
  }
});

test('a stroke is one undo step, and revisiting a pixel keeps its first before-colour', () => {
  const d = new Doc(8, 8);
  d.beginStroke();
  d.paint(2, 2, RED);
  d.paint(2, 2, BLUE);
  d.line(0, 0, 7, 3, RED);
  d.endStroke();
  assert.notEqual(d.get(2, 2), 0);
  d.undo();
  assert.ok(d.px.every((c) => c === 0), 'one undo clears the whole stroke, including the repainted pixel');
  assert.ok(!d.canUndo());
  d.redo();
  assert.equal(d.get(0, 0), RED);
});

test('painting a pixel the colour it already is changes nothing and records nothing', () => {
  const d = new Doc(2, 2);
  d.beginStroke();
  assert.equal(d.paint(0, 0, 0), false);
  assert.equal(d.endStroke(), null);
  assert.ok(!d.canUndo());
});

test('a new stroke after an undo throws the redo history away', () => {
  const d = new Doc(3, 3);
  stroke(d, [[0, 0]], RED);
  d.undo();
  stroke(d, [[1, 1]], BLUE);
  assert.ok(!d.canRedo());
});

test('fill replaces exactly the connected region, never leaks through diagonals, and undoes in one step', () => {
  const d = new Doc(5, 5);
  // a diagonal wall of red from top-right to bottom-left, plus a plain region
  for (let i = 0; i < 5; i++) { d.beginStroke(); d.paint(4 - i, i, RED); d.endStroke(); }
  const before = Array.from(d.px);
  const changed = d.fill(0, 0, BLUE);
  assert.equal(changed.length, 10, 'the 10 cells on the top-left side of the wall');
  assert.equal(d.get(0, 0), BLUE);
  assert.equal(d.get(4, 4), 0, 'the far side is not reached');
  assert.equal(d.get(4, 0), RED);
  d.undo();
  assert.deepEqual(Array.from(d.px), before);
});

test('fill with the colour already there does nothing; fill on a whole blank canvas fills it all', () => {
  const d = new Doc(3, 3);
  assert.deepEqual(d.fill(1, 1, 0), []);
  assert.equal(d.fill(1, 1, RED).length, 9);
  assert.ok(d.px.every((c) => c === RED));
});

test('out-of-bounds pen and fill are ignored', () => {
  const d = new Doc(2, 2);
  d.beginStroke();
  assert.equal(d.paint(-1, 0, RED), false);
  assert.equal(d.paint(2, 0, RED), false);
  d.endStroke();
  assert.deepEqual(d.fill(5, 5, RED), []);
});

test('the eraser paints transparency, or the background colour on an opaque sprite', () => {
  assert.equal(Doc.eraseValue('transparent', WHITE), 0);
  assert.equal(Doc.eraseValue('opaque', WHITE), WHITE);
});

test('going opaque lays transparent pixels over the background and undoes as one step; going back restores transparency', () => {
  const d = new Doc(3, 1);
  stroke(d, [[0, 0]], RED);
  const op = d.flatten(WHITE, { mode: 'transparent', color: '#FFFFFF' });
  assert.deepEqual(Array.from(d.px), [RED, WHITE, WHITE]);
  assert.equal(op.meta.next.mode, 'opaque');
  assert.equal(op.meta.prev.mode, 'transparent');
  const back = d.unflatten(WHITE, { mode: 'opaque', color: '#FFFFFF' });
  assert.deepEqual(Array.from(d.px), [RED, 0, 0]);
  assert.equal(back.meta.next.mode, 'transparent');
  d.undo();
  assert.deepEqual(Array.from(d.px), [RED, WHITE, WHITE]);
  d.undo();
  assert.deepEqual(Array.from(d.px), [RED, 0, 0]);
});

test('flatten works even when nothing is transparent, so the mode change itself is undoable', () => {
  const d = new Doc(1, 1);
  d.beginStroke(); d.paint(0, 0, RED); d.endStroke();
  const op = d.flatten(WHITE, { mode: 'transparent', color: '#FFFFFF' });
  assert.ok(op && op.idx.length === 0 && op.meta.next.mode === 'opaque');
  assert.ok(d.canUndo());
});

test('flatten blends half-transparent pixels over the background', () => {
  const d = Doc.fromRGBA(1, 1, [0, 0, 0, 128]);
  d.flatten(WHITE, {});
  const c = d.px[0];
  assert.equal(C.alpha(c), 255);
  assert.ok(Math.abs(C.red(c) - 127) <= 1);
});

test('fully transparent pixels all compare equal whatever colour they remember', () => {
  const d = Doc.fromRGBA(2, 1, [10, 20, 30, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(d.px), [0, 0]);
  assert.ok(d.isBlank());
});

test('changedFrom counts pixels that differ from the original, and edited tracks the last save', () => {
  const orig = Doc.fromRGBA(2, 2, [255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const d = new Doc(2, 2, new Uint32Array(orig.px));
  d.markSaved();
  assert.equal(d.changedFrom(orig.px), 0);
  assert.ok(!d.isEdited());
  stroke(d, [[1, 1]], BLUE);
  assert.equal(d.changedFrom(orig.px), 1);
  assert.ok(d.isEdited());
  d.undo();
  assert.ok(!d.isEdited(), 'undoing back to the saved picture is not an edit');
  stroke(d, [[0, 0]], BLUE);
  d.markSaved();
  assert.ok(!d.isEdited());
  assert.equal(d.changedFrom(orig.px), 1);
});

test('colours in use are counted most-common first and exclude transparency', () => {
  const d = new Doc(3, 1);
  stroke(d, [[0, 0]], RED); stroke(d, [[1, 0]], BLUE); stroke(d, [[2, 0]], BLUE);
  assert.deepEqual(d.colors(), [[BLUE, 2], [RED, 1]]);
});

test('hex and hsv conversions round-trip', () => {
  assert.equal(C.colorToHex(C.hexToColor('#3a7bd5')), '#3A7BD5');
  assert.equal(C.hexToColor('nope'), null);
  for (const hex of ['#FF0000', '#00FF00', '#0000FF', '#808080', '#FFFFFF', '#000000', '#C8402A', '#12AB9F']) {
    const c = C.hexToColor(hex), h = C.colorToHsv(c);
    assert.equal(C.colorToHex(C.hsvToColor(h.h, h.s, h.v)), hex);
  }
});

test('RGBA conversion round-trips', () => {
  const src = [1, 2, 3, 255, 0, 0, 0, 0, 200, 100, 50, 255, 9, 9, 9, 255];
  const d = Doc.fromRGBA(2, 2, src);
  const out = Array.from(d.toRGBA());
  assert.deepEqual(out, src);
});

test('undo history is capped', () => {
  const d = new Doc(40, 40);
  for (let i = 0; i < 350; i++) { d.beginStroke(); d.paint(i % 40, Math.floor(i / 40), RED); d.endStroke(); }
  let n = 0; while (d.undo()) n++;
  assert.equal(n, 300);
});
