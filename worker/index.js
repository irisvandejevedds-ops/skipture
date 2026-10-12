/* The front door: /api/* goes to the right room (found from the key, never stored), everything else is the static app. */
import { Room } from './room.js';
import { Gate } from './gate.js';
import { sha256hex } from './roomcore.js';

export { Room, Gate };

const HEAD = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (error, status) => new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', ...HEAD } });
const MAX_JSON = 3_000_000, MAX_ZIP = 17_000_000;

async function gate(env, kind, ip) {
  const r = await env.GATE.get(env.GATE.idFromName('gate')).fetch(`https://gate/check?kind=${kind}&ip=${encodeURIComponent(ip)}`);
  return r.ok;
}

async function handle(request, env) {
  const url = new URL(request.url), route = url.pathname.slice(5), ip = request.headers.get('CF-Connecting-IP') || 'local';
  const post = request.method === 'POST';

  if (route === 'enter' || route === 'create') {
    if (!post) return fail('Use POST.', 405);
    if (Number(request.headers.get('Content-Length') || 0) > 2000) return fail('That request is too large.', 413);
    let body;
    try { body = await request.json(); } catch { return fail('That request was not understood.', 400); }
    const key = String(body.key ?? '').trim();
    if (key.length < 1 || key.length > 80) return fail('Enter the room key.', 400);
    if (route === 'create' && (key.length < 8 || key.toLowerCase() === 'demo')) return fail('Choose a longer key: at least 8 characters.', 400);
    if (!(await gate(env, route, ip))) return fail(route === 'enter' ? 'Too many tries. Wait a few minutes.' : 'Too many new rooms from your address. Try again later.', 429);
    const id = await sha256hex('skipture-room:' + key);
    const res = await env.ROOM.get(env.ROOM.idFromName(id)).fetch(`https://room/${route}`, { method: 'POST', body: JSON.stringify({ proof: body.proof || '' }) });
    const out = await res.json();
    if (res.ok) out.room = id;
    return new Response(JSON.stringify(out), { status: res.status, headers: { 'Content-Type': 'application/json', ...HEAD } });
  }

  if (['rpc', 'png', 'export', 'import', 'destroy'].includes(route)) {
    const room = request.headers.get('X-Room') || '';
    if (!/^[0-9a-f]{64}$/.test(room)) return fail('Enter the room first.', 401);
    if ((route === 'png') === post) return fail(route === 'png' ? 'Use GET.' : 'Use POST.', 405);
    const size = Number(request.headers.get('Content-Length') || 0);
    if (size > (route === 'import' ? MAX_ZIP : MAX_JSON)) return fail('That is too large.', 413);
    const stub = env.ROOM.get(env.ROOM.idFromName(room));
    const payload = post ? await request.arrayBuffer() : undefined;      // read it all first: the room may answer (say, refuse) before it has read a large upload
    if (payload && payload.byteLength > (route === 'import' ? MAX_ZIP : MAX_JSON)) return fail('That is too large.', 413);
    const res = await stub.fetch(`https://room/${route}${url.search}`, { method: request.method, headers: { Authorization: request.headers.get('Authorization') || '', 'Content-Type': request.headers.get('Content-Type') || '' }, body: payload });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(HEAD)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  }
  return fail('Not found.', 404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await handle(request, env); } catch (e) { console.error('front door error', e && e.stack || e); return fail('Something went wrong on the server.', 500); }
  },
};
