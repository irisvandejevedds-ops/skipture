/* The demo room: made-up libraries in a mix of states, so the dashboard and the editor have something to show. Lives in memory; gone when the tab is closed. */
(function (root) {
  'use strict';
  var L = root.SkipLib, O = root.SkipOps;

  function rng(seed) { var t = seed >>> 0; return function () { t = (t + 0x6D2B79F5) >>> 0; var x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  function set(px, w, x, y, c) { if (x < 0 || y < 0 || x >= w) return; var o = (y * w + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; }

  /** a little symmetrical creature or gem, different for every seed */
  function creature(w, h, seed, palette) {
    var r = rng(seed), px = new Uint8Array(w * h * 4), half = Math.ceil(w / 2);
    for (var y = 2; y < h - 2; y++) for (var x = 2; x < half; x++) {
      var d = Math.hypot((x - w / 2 + .5) / (w / 2.4), (y - h / 2 + .5) / (h / 2.4));
      if (d < 0.95 && r() > d * 0.55) { var c = palette[Math.floor(r() * palette.length)]; set(px, w, x, y, c); set(px, w, w - 1 - x, y, c); }
    }
    var eye = [250, 250, 240], ey = Math.floor(h * 0.4);
    set(px, w, Math.floor(w * 0.34), ey, eye); set(px, w, w - 1 - Math.floor(w * 0.34), ey, eye);
    return px;
  }
  function tile(w, h, seed, a, b) {
    var r = rng(seed), px = new Uint8Array(w * h * 4);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) set(px, w, x, y, ((x >> 2) + (y >> 2)) % 2 ? a : b);
    for (var i = 0; i < w; i++) set(px, w, Math.floor(r() * w), Math.floor(r() * h), [255, 255, 255]);
    return px;
  }

  var LIBS = [
    { name: 'Pocket Frogs', app: 'Tadpole', description: 'The frog at each stage of growing up.', w: 16, h: 16, kind: 'sprite', pal: [[63, 160, 90], [92, 196, 120], [34, 110, 66], [200, 232, 150]],
      slots: [['frog-0', 'Tadpole', 'humanized'], ['frog-1', 'Legs', 'touched'], ['frog-2', 'Froglet', 'raw'], ['frog-3', 'Young frog', 'raw'], ['frog-4', 'Frog', 'empty'], ['frog-5', 'Elder frog', 'empty']] },
    { name: 'Hall Characters', app: 'Alberich', description: 'The dwarf lord in his moods.', w: 24, h: 24, kind: 'sprite', pal: [[110, 80, 160], [200, 170, 90], [150, 150, 170], [70, 50, 110]],
      slots: [['neutral', 'Neutral', 'humanized'], ['happy', 'Happy', 'humanized'], ['annoyed', 'Annoyed', 'humanized'], ['sick', 'Sick', 'touched'], ['evil', 'Evil', 'raw']] },
    { name: 'Dungeon Tiles', app: 'Alberich', description: 'Floor and wall textures that repeat.', w: 16, h: 16, kind: 'texture', tile: true, pal: null,
      slots: [['stone', 'Stone floor', 'humanized'], ['moss', 'Mossy stone', 'raw'], ['planks', 'Planks', 'raw'], ['brick', 'Brick wall', 'raw']] },
  ];

  /** Fills a MemoryStore with the demo room. */
  async function seed(S) {
    var n = 0;
    for (var i = 0; i < LIBS.length; i++) {
      var d = LIBS[i], lib = (await O.run(S, 'artist', 'createLibrary', { name: d.name, app: d.app, description: d.description })).id;
      for (var j = 0; j < d.slots.length; j++) {
        var s = d.slots[j], st = s[2], seedN = ++n;
        var px = d.kind === 'texture' ? tile(d.w, d.h, seedN, [120 + j * 12, 118, 112], [96 + j * 10, 98, 96]) : creature(d.w, d.h, seedN, d.pal);
        var args = { slot: s[0], name: s[1], width: d.w, height: d.h, kind: d.kind, tile: !!d.tile, art: st === 'empty' ? null : await L.encodePng(d.w, d.h, px), origin: 'developer' };
        var id = await L.addSlot(S, lib, args);
        if (st === 'touched' || st === 'humanized') {
          var edited = px.slice(); set(edited, d.w, 3, 3, [250, 220, 90]); set(edited, d.w, d.w - 4, 3, [250, 220, 90]);
          await L.saveArt(S, id, await L.encodePng(d.w, d.h, edited), 2, false, true);
          if (st === 'humanized') await L.setState(S, id, 'humanize');
        }
      }
    }
  }

  root.SkipDemo = { seed: seed };
})(window);
