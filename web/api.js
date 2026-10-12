/* How the page talks to a room. A real room is on the server (Remote); the demo runs the same rules in memory in this tab (Local). Both give the same calls. */
(function (root) {
  'use strict';
  var L = root.SkipLib, O = root.SkipOps;
  var SESSION = 'skipture.session';

  function Ended(message) { this.message = message || 'Your visit has ended. Enter the room again.'; this.name = 'Ended'; }
  Ended.prototype = Object.create(Error.prototype);

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }

  /** What the browser sends instead of the passphrase: a slow, salted hash, so the server never sees the passphrase itself. */
  function proofFor(key, passphrase) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('skipture-artist:' + key), iterations: 600000 }, k, 256);
    }).then(hex);
  }

  function readError(res) { return res.json().then(function (j) { return j.error || 'That did not work.'; }, function () { return 'That did not work.'; }); }

  // ---------------- a room on the server ----------------
  function Remote(s) { this.room = s.room; this.token = s.token; this.role = s.role; this.demo = false; }
  Remote.prototype._fetch = function (path, init) {
    var self = this;
    init = init || {}; init.headers = Object.assign({ Authorization: 'Bearer ' + this.token, 'X-Room': this.room }, init.headers || {});
    return fetch('/api/' + path, init).then(function (res) {
      if (res.status === 401) return res.json().then(function (j) { if (j.ended || /Enter the room/.test(j.error || '')) throw new Ended(j.error); throw new Error(j.error); });
      if (!res.ok) return readError(res).then(function (m) { throw new Error(m); });
      return res;
    });
  };
  Remote.prototype.call = function (op, args) {
    return this._fetch('rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: op, args: args || {} }) }).then(function (r) { return r.json(); });
  };
  Remote.prototype.png = function (id, which) {
    return this._fetch('png?id=' + encodeURIComponent(id) + '&which=' + encodeURIComponent(which || 'current')).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); });
  };
  Remote.prototype.exportZip = function (id, purpose) {
    return this._fetch('export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, purpose: purpose }) }).then(function (r) {
      var name = r.headers.get('X-Filename') || 'library.zip';
      return r.arrayBuffer().then(function (b) { return { data: new Uint8Array(b), name: name }; });
    });
  };
  Remote.prototype.importZip = function (bytes) {
    return this._fetch('import', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: bytes }).then(function (r) { return r.json(); });
  };
  Remote.prototype.destroy = function () { return this._fetch('destroy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function () { return {}; }); };
  Remote.prototype.remember = function () { try { sessionStorage.setItem(SESSION, JSON.stringify({ room: this.room, token: this.token, role: this.role })); } catch (e) { /* private mode */ } };

  // ---------------- the demo: the same rules, in memory ----------------
  function Local(store, role) { this.S = store; this.role = role || 'artist'; this.demo = true; }
  Local.prototype.call = function (op, args) { return O.run(this.S, this.role, op, JSON.parse(JSON.stringify(args || {}))); };
  Local.prototype.png = function (id, which) { return O.png(this.S, this.role, id, which || 'current'); };
  Local.prototype.exportZip = function (id, purpose) { return O.exportZip(this.S, this.role, id, purpose); };
  Local.prototype.importZip = function (bytes) { return O.importZip(this.S, this.role, bytes); };
  Local.prototype.destroy = function () { return Promise.resolve({}); };
  Local.prototype.remember = function () { try { sessionStorage.setItem(SESSION, JSON.stringify({ demo: true })); } catch (e) { /* private mode */ } };

  // ---------------- getting in ----------------
  function post(path, body) {
    return fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      return res.json().then(function (j) { return { status: res.status, body: j }; }, function () { return { status: res.status, body: { error: 'That did not work.' } }; });
    });
  }

  /** key alone: guest. key and passphrase: artist. -> {api} or {none:true} (no such room) */
  function enter(key, passphrase) {
    key = String(key || '').trim();
    var proof = passphrase ? proofFor(key, passphrase) : Promise.resolve('');
    return proof.then(function (p) { return post('enter', { key: key, proof: p }); }).then(function (r) {
      if (r.status === 404 && r.body.none) return { none: true };
      if (r.status !== 200) throw new Error(r.body.error || 'That did not work.');
      var api = new Remote(r.body); api.remember(); return { api: api };
    });
  }
  function create(key, passphrase) {
    key = String(key || '').trim();
    return proofFor(key, passphrase).then(function (p) { return post('create', { key: key, proof: p }); }).then(function (r) {
      if (r.status !== 200) throw new Error(r.body.error || 'That did not work.');
      var api = new Remote(r.body); api.remember(); return api;
    });
  }
  function demo(seed) {
    var store = new root.SkipStore.MemoryStore(), api = new Local(store, 'artist');
    return seed(store).then(function () { api.remember(); return api; });
  }
  /** a visit in this tab that is still going (the demo does not survive a reload: it is made fresh each time) */
  function resume() {
    var s; try { s = JSON.parse(sessionStorage.getItem(SESSION) || 'null'); } catch (e) { s = null; }
    return s && s.token && s.room ? new Remote(s) : null;
  }
  function leave() { try { sessionStorage.removeItem(SESSION); } catch (e) { /* ignore */ } }

  root.SkipApi = { Ended: Ended, proofFor: proofFor, enter: enter, create: create, demo: demo, resume: resume, leave: leave, wasDemo: function () { try { return !!(JSON.parse(sessionStorage.getItem(SESSION) || 'null') || {}).demo; } catch (e) { return false; } } };
})(window);
