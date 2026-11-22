// Mock bridge: serves a session file over the bridge's contract 1 (dc-qalink docs/BRIDGE_API.md; src/data/bridge-api.ts)
// so the UI, the onboarding flow and the MCP server can be exercised with no console and no dc-qalink checkout. It plays
// the session on its own clock like a console (30 pictures a second), whether or not anyone is connected. This PC only.
// Nothing here talks to a console: commands are logged and answered, pushed builds are hash-checked and "done", and
// every number says tier "mock". The real bridge is dc-qalink's pc/qalink_bridge.py.
// Usage: node tools/mock-bridge.mjs [session.jsonl] [--port 52080] [--drop-after <s>] [--down <s>] [--loop]
//   --drop-after: close every live stream after s seconds and refuse new ones for --down seconds (default 6): link lost
//   --console-after <s>: discovery hears a (mock) console's loader beacon s seconds after it is first asked (default 3)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CONTRACT = 1;
const BRIDGE = 'dc-qalink mock bridge (contract 1)';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const defaultSession = [here('../public/demo-session.jsonl'), here('../dist/demo-session.jsonl'), here('../web/demo-session.jsonl')].find((f) => existsSync(f));
const file = args[0] && !args[0].startsWith('--') ? args[0] : defaultSession;
const PORT = Number(opt('--port', 52080)), DROP = Number(opt('--drop-after', 0)), DOWN = Number(opt('--down', 6)), LOOP = args.includes('--loop');
const CONSOLE_AFTER = Number(opt('--console-after', 3));

const recs = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const meta0 = recs.find((r) => r.t === 'meta');
const pic = (r) => (r.t === 'log' ? r.n ?? 0 : r.t === 'meta' ? -1 : r.n);
const body = recs.filter((r) => r.t !== 'meta').map((r, i) => ({ r, i, n: pic(r) })).sort((a, b) => a.n - b.n || a.i - b.i).map((x) => x.r);
const last = Math.max(...body.map(pic));
const rate = meta0.rate || 30;
const tier = 'mock';
let ip = '127.0.0.1', kind = meta0.device.kind;
const device = () => ({ id: `dc-${ip.replace(/\./g, '-')}`, kind, tier, name: kind === 'console' ? 'Dreamcast (mock)' : 'Flycast on this PC (mock)', transport: meta0.device.transport === 'modem' ? 'modem' : 'adapter', address: ip, console_ip: ip, link: Date.now() < downUntil ? 'lost' : 'up', state: 'running', loader: { build: 'mock loader', sha8: '0000000000000000', protocol: 2, stub_bytes: 2120, boot_count: 1, pushed: false }, program: { run: '00000001', linked: true } });

let session = `${meta0.id}-mock-${Date.now().toString(36)}`;
const meta = () => ({ ...meta0, id: session, tier, tierDetail: `${meta0.tier} (mock bridge replaying a recording)` });
let clock = 0, paused = false, stepTo = 0, sentBytes = 0, downUntil = 0, discoveryAsked = 0;
const t0 = Date.now();
const S = () => Math.round((Date.now() - t0) / 10) / 100;
const runs = [];
const stills = new Map();
const options = [
  { name: 'show_fps', label: 'Show picture time on screen', type: 'bool', value: false },
  { name: 'cubes', label: 'Cubes in the ring', type: 'int', min: 8, max: 96, value: 24 },
  { name: 'filter', label: 'Texture filter', type: 'enum', values: ['nearest', 'bilinear', 'trilinear'], value: 'bilinear' },
];
const registry = {
  program: meta0.program.name, linked: true,
  presets: [
    { id: 'start', label: 'Start of the scene', group: 'Scene', detail: 'camera at the ring, 24 cubes' },
    { id: 'burst', label: 'Burst: 60 cubes', group: 'Scene', detail: 'the heaviest picture in the demo' },
    { id: 'orbit-far', label: 'Orbit, far camera', group: 'Camera', detail: 'distance 6, slow orbit' },
    { id: 'floor-only', label: 'Floor only', group: 'Tests', detail: 'no cubes: the floor grid alone' },
  ],
  options,
  scripts: [{ name: 'orbit-left', text: '# orbit the camera left for 2 s\n60 stick -1 0\n10 -' }],
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- the console clock
setInterval(() => {
  if (stepTo > clock) clock = Math.min(stepTo, last);
  else if (!paused && clock < last) clock = Math.min(last, clock + 1);
  else if (!paused && clock >= last && LOOP) { clock = 0; session = `${meta0.id}-mock-${Date.now().toString(36)}`; for (const c of clients) c.newSession(); }
  for (const c of clients) c.push();
}, 1000 / rate);
setInterval(() => { const r = sentBytes; sentBytes = 0; for (const c of clients) c.send({ t: 'status', s: S(), link: 'up', rate_bps: r, paused: paused || clock >= last, n: clock, mode: 'full', session, active_run: null }); }, 1000);
if (DROP) setInterval(() => { log(`dropping ${clients.size} live stream(s), refusing for ${DOWN} s`); downUntil = Date.now() + DOWN * 1000; for (const c of clients) c.res.destroy(); }, DROP * 1000);

// ---- live streams (Server-Sent Events)
const clients = new Set();
function client(res, from, sess) {
  let idx = 0;
  const c = {
    res,
    send(m) { const id = m.t === 'row' ? `id: ${m.n}\n` : ''; const s = `${id}data: ${JSON.stringify(m)}\n\n`; sentBytes += s.length; res.write(s); },
    hello(resume) { c.send({ t: 'hello', contract: CONTRACT, bridge: BRIDGE, s: S(), session, device: device(), meta: meta(), resume_from: resume, link: 'up' }); },
    newSession() { idx = 0; c.send({ ...meta(), s: S() }); },
    push() { while (idx < body.length && pic(body[idx]) <= clock) c.send({ ...body[idx++], s: S() }); },
  };
  const resume = sess === session ? from : 0;
  c.hello(resume);
  while (idx < body.length && pic(body[idx]) <= resume) idx++;
  c.push();
  return c;
}

// ---- queries over what has "arrived" (pictures up to the clock)
const rows = () => body.filter((r) => r.t === 'row' && r.n <= clock);
function summary(k = 5) {
  const rs = rows(); const [w0, w1] = meta0.window ?? [1, last];
  const inWin = rs.filter((r) => r.n >= w0 && r.n <= w1);
  const have = new Set(rs.map((r) => r.n));
  let missing = 0; for (let n = 1; n <= clock; n++) if (!have.has(n)) missing++;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const phases = meta0.phases.map((p) => {
    const v = inWin.map((r) => r.ph[p.key]).filter((x) => typeof x === 'number');
    const s = [...v].sort((a, b) => a - b); const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1);
    let worst = -Infinity, at = 0; for (const r of inWin) if (r.ph[p.key] > worst) { worst = r.ph[p.key]; at = r.n; }
    return { key: p.key, label: p.label, budget: p.budget ?? null, mean: r3(mean), p95: r3(s[Math.floor(0.95 * (s.length - 1))] ?? 0), worst: r3(v.length ? worst : 0), worstAt: at, over: p.budget ? v.filter((x) => x > p.budget).length : 0, tier };
  });
  const ctr = {}; for (const r of body) if (r.t === 'ctr' && r.n <= clock) Object.assign(ctr, r.v);
  const guards = (meta0.counters ?? []).filter((c) => c.guard).map((c) => ({ key: c.key, name: c.name, value: ctr[c.key] ?? 0, tier }));
  const busy = (r) => meta0.phases.filter((p) => !p.total).reduce((a, p) => a + (r.ph[p.key] ?? 0), 0);
  const slowest = [...inWin].sort((a, b) => busy(b) - busy(a)).slice(0, Math.max(1, Math.min(50, k))).map((r) => ({ n: r.n, total: r3(busy(r)), phases: r.ph }));
  return { contract: CONTRACT, session, label: meta0.label, device: device().name, tier, pictures: clock, measured: inWin.length, missing, phases, guards, slowest };
}
const range = (url) => { const from = Math.max(0, Number(url.searchParams.get('from') ?? 0)); const to = Math.min(clock, Number(url.searchParams.get('to') ?? clock)); const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get('limit') ?? 500))); return { from, to, limit }; };

// ---- HTTP
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID, X-Contract, X-By', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Disposition' };
const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(Array.isArray(v) ? v : { ...v, contract: CONTRACT })); };
const readBody = (req) => new Promise((r) => { const b = []; req.on('data', (d) => b.push(d)); req.on('end', () => r(Buffer.concat(b))); });
function multipart(buf, ctype) {
  const m = /boundary="?([^";]+)"?/.exec(ctype || ''); if (!m) return null;
  const sep = Buffer.from(`--${m[1]}`); const out = {}; let at = buf.indexOf(sep);
  while (at >= 0) {
    const next = buf.indexOf(sep, at + sep.length); if (next < 0) break;
    const part = buf.subarray(at + sep.length + 2, next - 2); const hEnd = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, hEnd).toString('latin1'); const name = /name="([^"]*)"/.exec(head)?.[1]; const fn = /filename="([^"]*)"/.exec(head)?.[1];
    if (name) out[name] = { filename: fn ?? null, data: part.subarray(hEnd + 4) };
    at = next;
  }
  return out;
}
const runJson = (run) => ({ ...run });
function startRun(name, b, by, argsTxt = '') {
  const sha = createHash('sha256').update(b).digest('hex');
  const run = { id: randomBytes(4).toString('hex'), program: { name, sha256: sha, bytes: b.length }, args: argsTxt, state: 'queued', times: {}, way_back: null, by, queued_at: new Date().toISOString(), ended_at: null, device: device().name, tier, summary: null, error: null, stills: [], serial_lines: 0 };
  runs.unshift(run); log('run', run.id, name, b.length, 'B');
  setTimeout(() => { run.state = 'sending'; }, 400); setTimeout(() => { run.state = 'running'; run.times.push_s = 0.8; }, 1200);
  setTimeout(() => {
    const g = body.find((r) => r.t === 'grab' && r.kind !== 'reference');
    if (g) { const id = `${run.id}-1`; stills.set(id, { g, j: { id, run: run.id, picture: g.n, width: g.w, height: g.h, format: 'rgb565', crc_ok: true, bytes: g.w * g.h * 2, seconds: 0.7, tier, at: new Date().toISOString() } }); run.stills.push(id); }
    run.state = 'done'; run.ended_at = new Date().toISOString(); run.way_back = 'stub'; run.times.run_s = 1.4;
    run.summary = { exit: 0, state: 'done', seconds: 1.4, pictures: 90, tier, notes: ['Mock bridge: hash checked on receipt; nothing ran on a console.'], numbers: [{ label: 'Picture mean', value: 33.3, unit: 'ms', tier }, { label: 'Drawing mean', value: 13.4, unit: 'ms', tier }] };
    run.report = 'mock bridge: nothing ran\n';
  }, 2600);
  return run;
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname.replace(/\/$/, '');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const want = req.headers['x-contract']; if (want && String(want).split('.')[0] !== String(CONTRACT)) return json(res, 409, { error: `contract mismatch: this bridge speaks contract ${CONTRACT}`, theirs: want, ours: CONTRACT });
  try {
    if (p === '/v0/live') {
      if (Date.now() < downUntil) { res.writeHead(503, cors); res.end(); return; }
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const from = Number(url.searchParams.get('from') || req.headers['last-event-id'] || 0);
      const c = client(res, from, url.searchParams.get('session') || '');
      clients.add(c); log(`live stream open (from ${from}), ${clients.size} open`);
      req.on('close', () => { clients.delete(c); log(`live stream closed, ${clients.size} open`); });
      return;
    }
    if (p === '/v0/status') return json(res, 200, { bridge: BRIDGE, link: Date.now() < downUntil ? 'lost' : 'up', device: device(), session, rate_bps: 0, mode: 'full', paused, n: clock, level: 'run', tier, queue: [], active_run: null });
    if (p === '/v0/device') return json(res, 200, device());
    if (p === '/v0/devices') return json(res, 200, { devices: [device()] });
    if (p === '/v0/sessions') return json(res, 200, { sessions: [{ id: session, label: meta0.label, device: device().name, started: new Date(t0).toISOString(), recorded: new Date(t0).toISOString(), pictures: clock, tier, bytes: 0 }] });
    if (p.startsWith('/v0/sessions/')) {
      const id = decodeURIComponent(p.slice(13)); if (id !== session) return json(res, 404, { error: `no session ${id}` });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', ...cors }); res.end([meta(), ...body.filter((r) => pic(r) <= clock)].map((r) => JSON.stringify(r)).join('\n') + '\n'); return;
    }
    if (p === '/v0/summary') return json(res, 200, summary(Number(url.searchParams.get('slowest') ?? 5)));
    if (p === '/v0/trace') {
      const { from, to, limit } = range(url); const lane = url.searchParams.get('lane');
      const ev = body.filter((r) => r.t === 'trace' && r.n >= from && r.n <= to && (!lane || r.lane === lane)).map((r) => ({ lane: r.lane, n: r.n, d: r.d ?? 0, label: r.label }));
      return json(res, 200, { from, to, events: ev.slice(0, limit), truncated: ev.length > limit });
    }
    if (p === '/v0/log') {
      const { from, to, limit } = range(url); const lv = url.searchParams.get('level'); const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const ls = body.filter((r) => r.t === 'log' && (r.n ?? 0) >= from && (r.n ?? 0) <= to && (!lv || r.lv === lv || (lv === 'warn' && r.lv === 'err')) && (!q || r.msg.toLowerCase().includes(q))).map((r) => ({ n: r.n, lv: r.lv, msg: r.msg }));
      return json(res, 200, { from, to, lines: ls.slice(-limit), truncated: ls.length > limit });
    }
    if (p === '/v0/presets') return json(res, 200, registry);
    if (p === '/v0/command' && req.method === 'POST') {
      const c = JSON.parse((await readBody(req)).toString() || '{}'); const id = `c${Date.now()}`;
      log('command', JSON.stringify(c).slice(0, 200));
      if (c.cmd === 'pause') { paused = true; return json(res, 200, { ok: true, id, n: clock }); }
      if (c.cmd === 'resume') { paused = false; stepTo = 0; return json(res, 200, { ok: true, id, n: clock }); }
      if (c.cmd === 'step') { paused = true; stepTo = clock + (c.count || 1); return json(res, 200, { ok: true, id, n: stepTo }); }
      if (c.cmd === 'warp') return json(res, 200, registry.presets.some((x) => x.id === c.preset) ? { ok: true, id, n: clock } : { ok: false, id, n: clock, error: `no preset ${c.preset}` });
      if (c.cmd === 'option') { const o = options.find((x) => x.name === c.name); if (!o) return json(res, 200, { ok: false, id, error: `no option ${c.name}` }); o.value = c.value; return json(res, 200, { ok: true, id, n: clock }); }
      if (c.cmd === 'reset') { if (!['return', 'watchdog', 'power'].includes(c.level)) return json(res, 400, { ok: false, id, error: 'level must be return, watchdog or power' }); if (c.level === 'power') return json(res, 200, { ok: false, id: 'power', done: false, say: 'power cycle needed (mock)' }); clock = 0; return json(res, 200, { ok: true, id: 'reset', rung: 'stub', n: 0 }); }
      if (c.cmd === 'pad') return json(res, 200, { ok: true, id, n: clock });
      return json(res, 400, { ok: false, id, error: `unknown command ${c.cmd}` });
    }
    if (p === '/v0/stills' && req.method === 'POST') {
      let g = null; for (const r of body) if (r.t === 'grab' && r.kind !== 'reference' && r.n <= Math.max(clock, 1)) g = r;
      if (!g) g = body.find((r) => r.t === 'grab' && r.kind !== 'reference');
      if (!g) return json(res, 404, { error: 'no picture yet' });
      const id = `00000001-${stills.size + 1}`; const j = { id, run: '00000001', picture: clock, width: g.w, height: g.h, format: 'rgb565', crc_ok: true, bytes: g.w * g.h * 2, seconds: 0.7, tier, at: new Date().toISOString() };
      stills.set(id, { g, j }); return json(res, 200, j);
    }
    const sm = /^\/v0\/stills\/([0-9a-f]{8}-\d+)(\.json)?$/.exec(p);
    if (sm) { const s = stills.get(sm[1]); if (!s) return json(res, 404, { error: 'no still' }); if (sm[2]) return json(res, 200, s.j); res.writeHead(200, { 'Content-Type': 'image/png', ...cors }); res.end(Buffer.from(s.g.data, 'base64')); return; }
    if (p === '/v0/runs' && req.method === 'GET') return json(res, 200, { runs: runs.map(runJson) });
    if (p === '/v0/runs' && req.method === 'POST') {
      const b = await readBody(req); const f = multipart(b, req.headers['content-type']);
      if (!f?.program) return json(res, 400, { error: 'multipart needs a "program" file' });
      const sha = createHash('sha256').update(f.program.data).digest('hex'); const declared = f.sha256?.data.toString();
      if (!declared) return json(res, 400, { error: 'a push needs the sha256 of the program' });
      if (declared !== sha) return json(res, 400, { error: 'sha256 does not match the bytes received', received: sha, declared });
      return json(res, 202, startRun(f.name?.data.toString() || f.program.filename || 'build.elf', f.program.data, String(req.headers['x-by'] || 'Studio (mock bridge)'), f.args?.data.toString() ?? ''));
    }
    const rm = /^\/v0\/runs\/([0-9a-f]{8})(\/report|\/serial)?$/.exec(p);
    if (rm) { const r = runs.find((x) => x.id === rm[1]); if (!r) return json(res, 404, { error: 'no such run' }); if (rm[2]) { res.writeHead(200, { 'Content-Type': 'text/plain', ...cors }); res.end(rm[2] === '/report' ? r.report ?? '' : ''); return; } return json(res, 200, runJson(r)); }
    if (p === '/v0/selftest' && req.method === 'POST') { const b = Buffer.from('dc-qalink test program (mock bytes)\n'.repeat(512)); return json(res, 202, startRun('testprog.elf', b, 'self test')); }
    if (p === '/v0/memory/read' || p === '/v0/assets') return json(res, 501, { error: `${p}: not in this loader yet (mock answers as the real bridge does)` });
    if (p === '/v0/discovery') {
      if (!discoveryAsked) discoveryAsked = Date.now();
      const at = new Date().toISOString();
      const seen = [{ id: 'dc-127-0-0-1', console_ip: '127.0.0.1', address: '127.0.0.1', port: 52062, kind: 'flycast', transport: 'adapter', loader: 'mock loader', beacons: 3, last_s_ago: 0.4, chosen: ip === '127.0.0.1', at }];
      if (Date.now() - discoveryAsked > CONSOLE_AFTER * 1000) seen.push({ id: 'dc-192-0-2-50', console_ip: '192.0.2.50', address: '192.0.2.50', port: 52060, kind: 'console', transport: 'adapter', loader: 'mock loader', beacons: 2, last_s_ago: 0.7, chosen: ip === '192.0.2.50', at });
      return json(res, 200, { listening: true, port: 52060, seen });
    }
    if (p === '/v0/link' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString() || '{}'); const want = b.console_ip ?? String(b.device ?? '').replace(/^dc-/, '').replace(/-/g, '.');
      if (want !== '127.0.0.1' && want !== '192.0.2.50') return json(res, 404, { error: `no loader heard at ${want}` });
      ip = want; kind = want === '127.0.0.1' ? 'flycast' : 'console';
      return json(res, 200, { bridge: BRIDGE, link: 'up', device: device(), session, rate_bps: 0, mode: 'full', paused, n: clock, level: 'run', tier, queue: [], active_run: null });
    }
    if (p === '/v0/loader') return json(res, 501, { error: 'the mock bridge has no loader disc; dc-qalink\'s bridge serves it (--loader-disc)' });
    json(res, 404, { error: `no route ${p}` });
  } catch (e) { json(res, 500, { error: String(e) }); }
});
server.listen(PORT, '127.0.0.1', () => log(`mock bridge (contract ${CONTRACT}) on http://127.0.0.1:${PORT}, session ${meta0.label} (${last} pictures)${DROP ? `, drops every ${DROP} s` : ''}`));
