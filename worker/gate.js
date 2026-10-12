/* One shared Durable Object that counts attempts, so nobody can hammer the door or make rooms in bulk. */
import { DurableObject } from 'cloudflare:workers';

const LIMITS = {
  enter: { per: 60, window: 600, global: 3000 },        // 60 tries per 10 minutes per address
  create: { per: 5, window: 3600, global: 100 },        // 5 new rooms per hour per address, 100 a day for everyone
};

export class Gate extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS hits(kind TEXT NOT NULL, ip TEXT NOT NULL, ts INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS ix_hits ON hits(kind, ip, ts)');
  }

  async fetch(request) {
    const u = new URL(request.url), kind = u.searchParams.get('kind'), ip = u.searchParams.get('ip') || 'unknown', lim = LIMITS[kind];
    if (!lim) return new Response('bad kind', { status: 400 });
    const sql = this.ctx.storage.sql, now = Math.floor(Date.now() / 1000);
    sql.exec('DELETE FROM hits WHERE ts<?', now - 86400);
    const mine = sql.exec('SELECT COUNT(*) n FROM hits WHERE kind=? AND ip=? AND ts>?', kind, ip, now - lim.window).one().n;
    const all = sql.exec('SELECT COUNT(*) n FROM hits WHERE kind=? AND ts>?', kind, now - 86400).one().n;
    if (mine >= lim.per || all >= lim.global) return new Response(JSON.stringify({ ok: false }), { status: 429 });
    sql.exec('INSERT INTO hits(kind, ip, ts) VALUES(?,?,?)', kind, ip, now);
    return new Response(JSON.stringify({ ok: true }));
  }
}
