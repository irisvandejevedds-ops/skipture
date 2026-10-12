/* A room: one Durable Object per key, holding that room's libraries, passphrase hash and sessions in its own SQLite database. */
import { DurableObject } from 'cloudflare:workers';
import ops from '../web/ops.js';
import lib from '../web/lib.js';
import { RoomCore } from './roomcore.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const bin = (bytes, type, extra = {}) => new Response(bytes, { headers: { 'Content-Type': type, ...extra } });

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RoomCore(ctx.storage.sql);
  }

  async fetch(request) {
    const url = new URL(request.url), path = url.pathname, core = this.core, S = core.store;
    try {
      if (path === '/enter' || path === '/create') {
        const { proof } = await request.json();
        const r = path === '/enter' ? await core.enter(proof) : await core.create(proof);
        return json(r.body, r.status);
      }
      const auth = request.headers.get('Authorization') || '', role = await core.who(auth.startsWith('Bearer ') ? auth.slice(7) : '');
      if (!role) return json({ error: 'Your visit has ended. Enter the room again.', ended: true }, 401);

      if (path === '/rpc') {
        const { op, args } = await request.json();
        return json(await ops.run(S, role, op, args));
      }
      if (path === '/png') return bin(await ops.png(S, role, Number(url.searchParams.get('id')), url.searchParams.get('which') || 'current'), 'image/png', { 'Cache-Control': 'private, no-store' });
      if (path === '/export') {
        const { id, purpose } = await request.json();
        const r = await ops.exportZip(S, role, Number(id), purpose);
        return bin(r.data, 'application/zip', { 'X-Filename': r.name, 'X-Complete': r.complete ? '1' : '0' });
      }
      if (path === '/import') return json(await ops.importZip(S, role, new Uint8Array(await request.arrayBuffer())));
      if (path === '/destroy') {
        if (role !== 'artist') throw new ops.Denied('Only the artist can do that.');
        await this.ctx.storage.deleteAll();
        this.core = new RoomCore(this.ctx.storage.sql);      // the tables went with it: start again empty, so the key is free to use for a new room
        return json({ ok: true });
      }
      return json({ error: 'Not found.' }, 404);
    } catch (e) {
      if (e instanceof ops.Denied) return json({ error: e.message }, 403);
      if (e instanceof lib.LibError) return json({ error: e.message }, 400);
      console.error('room error', e && e.stack || e);
      return json({ error: 'Something went wrong on the server. Nothing was changed that you can see.' }, 500);
    }
  }
}
