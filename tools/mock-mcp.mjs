// Mock MCP server: the MCP tool list (src/data/mcp-tools.ts) served over stdio with the official TypeScript MCP SDK,
// each tool mapped onto the bridge API of a running bridge (the mock bridge today). It is the reference for the real
// bridge's MCP (Python, dc-qalink, the Python MCP SDK): same names, same schemas, same bridge calls, same answers.
// Usage: node tools/mock-mcp.mjs [--bridge http://127.0.0.1:5180] [--level read|control|run] [--who <name>]
// Claude Code on this PC:  claude mcp add qalink -- node <repo>/tools/mock-mcp.mjs --level control
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_TOOLS_VERSION, MCP_BRIDGE_API, checkArgs, toolsFor } from '../src/data/mcp-tools.ts';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BRIDGE = opt('--bridge', 'http://127.0.0.1:52080').replace(/\/$/, '');
const LEVEL = opt('--level', 'control');
const WHO = opt('--who', 'local stdio client');
if (!['read', 'control', 'run'].includes(LEVEL)) { console.error(`--level must be read, control or run`); process.exit(2); }
const tools = toolsFor(LEVEL);
const byName = new Map(tools.map((t) => [t.name, t]));
const note = (...a) => console.error(new Date().toISOString().slice(11, 19), '[qalink-mcp]', ...a); // stdout is the protocol

async function call(method, path, body, headers = {}) {
  const r = await fetch(BRIDGE + path, { method, body, headers: { ...(body && !(body instanceof Uint8Array) && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), 'X-By': `MCP: ${WHO}`, 'X-Contract': '1', ...headers } });
  const ct = r.headers.get('content-type') || '';
  const v = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(typeof v === 'object' && v?.error ? v.error : `bridge answered ${r.status}`);
  return v;
}
const cmd = (c) => call('POST', '/v0/command', JSON.stringify(c));
function bytesOf(a) {
  if (a.path) { const s = statSync(a.path); if (!s.isFile()) throw new Error(`${a.path} is not a file`); if (s.size > 64 * 1024 * 1024) throw new Error('larger than 64 MB'); return { bytes: readFileSync(a.path), name: a.name || basename(a.path) }; }
  if (a.base64) return { bytes: Buffer.from(a.base64, 'base64'), name: a.name || 'build.elf' };
  throw new Error('give path or base64');
}
async function push(a) {
  const { bytes, name } = bytesOf(a); const sha = createHash('sha256').update(bytes).digest('hex');
  const fd = new FormData(); fd.append('sha256', sha); fd.append('name', name); fd.append('program', new Blob([bytes]), name);
  return call('POST', '/v0/runs', fd);
}
async function waitRun(id, seconds) {
  const end = Date.now() + seconds * 1000; let r;
  do { r = await call('GET', `/v0/runs/${encodeURIComponent(id)}`); if (!['queued', 'sending', 'running'].includes(r.state)) return r; await new Promise((x) => setTimeout(x, 250)); } while (Date.now() < end);
  return r;
}
const q = (o) => { const s = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v)); const t = s.toString(); return t ? `?${t}` : ''; };

const prune = (v) => (Array.isArray(v) ? v.filter((x) => x !== null).map(prune) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, prune(x)])) : v);
const handlers = {
  link_status: () => call('GET', '/v0/status'),
  list_devices: () => call('GET', '/v0/devices'),
  push_build: (a) => push(a),
  run_and_wait: async (a) => waitRun((await push(a)).id, a.timeout_s ?? 60),
  get_run: async (a) => (a.id ? { runs: [await call('GET', `/v0/runs/${encodeURIComponent(a.id)}`)] } : call('GET', '/v0/runs')),
  self_test: async (a) => waitRun((await call('POST', '/v0/selftest', JSON.stringify({}))).id, a.timeout_s ?? 30),
  grab_screen: async () => { const s = await call('POST', '/v0/stills', JSON.stringify({})); const r = await fetch(`${BRIDGE}/v0/stills/${s.id}`); const png = Buffer.from(await r.arrayBuffer()).toString('base64'); return { _image: png, n: s.picture, w: s.width, h: s.height, label: `still ${s.id}`, bytes: Buffer.from(png, 'base64').length, tier: s.tier }; },
  live_summary: async () => { const s = await call('GET', '/v0/summary'); delete s.slowest; return s; },
  slowest_pictures: async (a) => { const s = await call('GET', `/v0/summary${q({ slowest: a.count ?? 10 })}`); return { tier: s.tier, slowest: s.slowest }; },
  query_trace: (a) => call('GET', `/v0/trace${q(a)}`),
  read_log: (a) => call('GET', `/v0/log${q(a)}`),
  list_presets: () => call('GET', '/v0/presets'),
  warp: (a) => cmd({ cmd: 'warp', preset: a.preset }),
  pause: () => cmd({ cmd: 'pause' }),
  resume: () => cmd({ cmd: 'resume' }),
  step: (a) => cmd({ cmd: 'step', count: a.count ?? 1 }),
  set_option: (a) => cmd({ cmd: 'option', name: a.name, value: a.value }),
  send_pad: (a) => { if (!a.state && !a.steps) throw new Error('give state or steps'); return cmd({ cmd: 'pad', state: a.state, steps: a.steps }); },
  reset: (a) => cmd({ cmd: 'reset', level: a.level }),
  read_memory: (a) => call('POST', '/v0/memory/read', JSON.stringify({ addr: parseInt(a.addr.replace(/^0x/i, ''), 16), len: a.len })),
  upload_asset: async (a) => { bytesOf(a); return call('POST', '/v0/assets', JSON.stringify({})); },
  list_sessions: () => call('GET', '/v0/sessions'),
  export_session: async (a) => { const text = await call('GET', `/v0/sessions/${encodeURIComponent(a.id)}`); const max = a.max_bytes ?? 1_000_000; const b = Buffer.byteLength(text); return { id: a.id, bytes: b, truncated: b > max, text: b > max ? Buffer.from(text).subarray(0, max).toString('utf8') : text }; },
};

const server = new Server({ name: 'qalink', title: 'QA Link (mock bridge)', version: MCP_TOOLS_VERSION }, { capabilities: { tools: {} }, instructions: `Tools for a Dreamcast or Flycast linked through dc-qalink's bridge (tool list ${MCP_TOOLS_VERSION}, bridge API ${MCP_BRIDGE_API}). This server is the MOCK: it drives the mock bridge at ${BRIDGE}, which replays a recording; numbers carry the tier "mock". Start with link_status.` });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({ name: t.name, title: t.title, description: `${t.description} [permission: ${t.level}; bridge: ${t.bridge}]`, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: { title: t.title, readOnlyHint: t.level === 'read', destructiveHint: t.name === 'reset', openWorldHint: false } })),
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name; const a = req.params.arguments ?? {};
  const t = byName.get(name);
  const fail = (text) => { note(`${WHO}: ${name} refused: ${text}`); return { isError: true, content: [{ type: 'text', text }] }; };
  if (!t) return fail(`no tool "${name}" at permission level "${LEVEL}"`);
  const problems = checkArgs(t.inputSchema, a); if (problems.length) return fail(`invalid arguments: ${problems.join('; ')}`);
  try {
    const v = prune(await handlers[name](a)); // an unknown value is left out, never sent as null (as the bridge's MCP)
    note(`${WHO}: ${name} ${JSON.stringify(a).slice(0, 120)} -> ok`);
    const img = v && v._image; if (img !== undefined) delete v._image;
    const content = [{ type: 'text', text: JSON.stringify(v) }];
    if (img) content.unshift({ type: 'image', data: img, mimeType: 'image/png' });
    return { content, structuredContent: v };
  } catch (e) { return fail(`${name} failed: ${e instanceof Error ? e.message : String(e)}`); }
});

// the bridge must speak the same API major.minor
try { const s = await call('GET', '/v0/status'); if (String(s.contract) !== MCP_BRIDGE_API.split('.')[0]) note(`warning: bridge contract ${s.contract}, tools made for ${MCP_BRIDGE_API}`); }
catch (e) { note(`bridge not reachable at ${BRIDGE} yet (${e.message}); tools answer with an error until it is`); }
await server.connect(new StdioServerTransport());
note(`serving ${tools.length} tools (level ${LEVEL}) over stdio, bridge ${BRIDGE}`);
