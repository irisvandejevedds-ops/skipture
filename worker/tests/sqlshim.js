// Stands in for a Durable Object's ctx.storage.sql using node's built-in SQLite, so the room code can be tested without Cloudflare.
import { DatabaseSync } from 'node:sqlite';

export function makeSql() {
  const db = new DatabaseSync(':memory:');
  return {
    exec(q, ...binds) {
      const st = db.prepare(q), args = binds.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x === undefined ? null : x));
      const reads = /^\s*(select|with)\b/i.test(q) || /\breturning\b/i.test(q);
      const rows = reads ? st.all(...args).map((r) => ({ ...r })) : (st.run(...args), []);
      return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('expected exactly one row, got ' + rows.length); return rows[0]; } };
    },
  };
}
