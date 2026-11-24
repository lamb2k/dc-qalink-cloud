// The source is a hard boundary (owner 2026-11-23): the demo and a live build never mix. In the desktop app's test mode
// (offscreen, no window, no focus): open the demo, read every workspace; link to a mock bridge playing a synthetic
// session (its own port), read every workspace again and the store, and find no demo record anywhere; open the demo
// again and find it whole. The demo's markers are checked present first, so the check can fail.
// Usage: node tools/source-boundary.mjs [--port 52406] [--out <dir>]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('--port', 52406));
const OUT = resolve(opt('--out', join(root, 'out', 'source-boundary'))); mkdirSync(OUT, { recursive: true });
const ud = join(OUT, '.userdata'); rmSync(ud, { recursive: true, force: true }); mkdirSync(ud, { recursive: true });
writeFileSync(join(ud, 'settings.json'), JSON.stringify({ version: 1, bridgeAddress: `http://127.0.0.1:${PORT}`, connection: 'bba' }));

// a synthetic live session: nothing in it is the demo's
const rec = [{ t: 'meta', format: 'dc-qalink.session', version: 1, id: 'synthetic-0001', label: 'Synthetic build', program: { name: 'synthetic.elf' },
  device: { kind: 'console', name: 'Dreamcast', transport: 'bba' }, tier: 'synthetic test data', recorded: '2026-11-23T00:00:00Z', rate: 60, units: 'ms per picture',
  phases: [{ key: 'update', label: 'Update', budget: 4 }, { key: 'frame', label: 'Frame', budget: 16.7, total: true }], counters: [{ key: 'hits', name: 'Hits', group: 'Game' }] }];
for (let n = 1; n <= 600; n++) {
  rec.push({ t: 'row', n, ph: { update: 1 + (n % 7) / 10, frame: 16.7 }, x: { level: 2 } });
  if (n % 60 === 0) { rec.push({ t: 'ctr', n, v: { hits: n / 60 } }); rec.push({ t: 'log', n, lv: 'info', msg: `synthetic line ${n}` }); }
}
const sessionFile = join(OUT, 'synthetic.jsonl'); writeFileSync(sessionFile, rec.map((r) => JSON.stringify(r)).join('\n') + '\n');
const demoPresets = JSON.parse(readFileSync(join(root, 'public', 'example-presets.json'), 'utf8')).presets.map((p) => p.label);

const check = async (port, presets) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms) => { const t = performance.now(); while (!f()) { if (performance.now() - t > ms) return false; await sleep(100); } return true; };
  const out = { steps: [], ok: true }; const t0 = performance.now();
  const note = (name, ok, extra = {}) => { out.steps.push({ name, ok, at_s: Math.round(performance.now() - t0) / 1000, ...extra }); if (!ok) out.ok = false; };
  const MARKERS = ['example.elf', 'Spinning cubes', 'demo-0001', 'torus_checker', 'Flycast on this PC (demo)', 'example presets', ...presets.slice(0, 2)];
  const WS = ['link', 'performance', 'assets', 'capture', 'debug', 'commands'];
  const readAll = async (tag) => {
    const texts = {};
    for (const w of WS) { studio.setWorkspace(w); await sleep(900); texts[w] = (document.querySelector('.ws-main')?.innerText || ''); }
    texts.header = document.querySelector('.ws-top')?.innerText || ''; texts.status = document.querySelector('.ws-status')?.innerText || '';
    window.__qlShots.push(`${tag}`); await sleep(400);
    return texts;
  };
  const found = (texts) => { const hits = []; for (const [w, t] of Object.entries(texts)) for (const m of MARKERS) if (t.includes(m)) hits.push(`${w}: ${m}`); return hits; };
  const storeDemo = () => { const st = studio.store; const j = JSON.stringify({ meta: st.meta, logs: st.logs.slice(0, 50), grabs: st.grabs.map((g) => g.n), counters: st.counters.slice(0, 5) }); return MARKERS.filter((m) => j.includes(m)); };
  window.__qlShots = [];
  try {
    await until(() => studio.store.maxN > 30, 15000);
    const demo1 = await readAll('1-demo');
    const d1 = found(demo1);
    note('control: the demo shows its own records (markers found)', d1.length >= 4, { found: d1.length, sample: d1.slice(0, 6) });
    note('demo: the badge says Demo', /Demo/.test(demo1.header) && /Demo/.test(demo1.status));
    await studio.connect(`http://127.0.0.1:${port}`);
    await until(() => studio.source.state === 'linked' && studio.store.meta?.program?.name === 'synthetic.elf' && studio.store.maxN > 60, 20000);
    note('live: linked to the synthetic build', studio.store.meta?.program?.name === 'synthetic.elf', { maxN: studio.store.maxN });
    const live = await readAll('2-live');
    const l = found(live);
    note('live: no demo record in any workspace, header or status bar', l.length === 0, { found: l });
    note('live: no demo record in the store (meta, logs, grabs, counters)', storeDemo().length === 0, { found: storeDemo() });
    note('live: the badge says Live on Dreamcast', /Live on Dreamcast/.test(live.header) && /Live on Dreamcast/.test(live.status));
    note('live: Commands says the build declares no presets', /declares no presets/.test(live.commands));
    note('live: Assets says the build declares no assets', /declares no assets/.test(live.assets));
    await studio.openDemo();
    await until(() => studio.store.meta?.id === 'demo-0001' && studio.store.maxN > 30, 15000);
    const demo2 = await readAll('3-demo-again');
    const d2 = found(demo2);
    const syn = Object.entries(demo2).filter(([, t]) => /synthetic.elf|Synthetic build|synthetic line/.test(t)).map(([w, t]) => `${w}: ${t.slice(Math.max(0, t.search(/synthetic.elf|Synthetic build|synthetic line/) - 40), t.search(/synthetic.elf|Synthetic build|synthetic line/) + 40)}`);
    note('back to the demo: its records again, nothing of the live build', d2.length >= d1.length - 1 && !syn.length, { found: d2.length, before: d1.length, live_left: syn });
  } catch (e) { note('check error', false, { error: String(e && e.stack || e) }); }
  window.__qlDone = out;
};

const bridge = spawn(process.execPath, [join(root, 'tools', 'mock-bridge.mjs'), sessionFile, '--port', String(PORT), '--loop', '--no-presets'], { stdio: 'ignore', windowsHide: true });
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/v0/status`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
const evalSrc = `(${check.toString()})(${PORT}, ${JSON.stringify(demoPresets)}); undefined;`;
const electronExe = (await import('electron')).default;
const t = Date.now();
const p = spawn(electronExe, [join(root, 'desktop', 'main.mjs'), `--capture-and-exit=${join(OUT, 'last.png')}`, `--user-data=${ud}`, `--flow-shots=${OUT}`,
  '--limit=120000', '--wait=200', '--query=?theme=dark&ws=link', `--eval-b64=${Buffer.from(evalSrc).toString('base64')}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
const code = await new Promise((r) => p.on('exit', r));
bridge.kill();
writeFileSync(join(OUT, 'app.log'), log);
const res = existsSync(join(OUT, 'flow.json')) ? JSON.parse(readFileSync(join(OUT, 'flow.json'), 'utf8')) : null;
console.log(`exit ${code}, wall ${Date.now() - t} ms`);
if (res) for (const s of res.steps) console.log(`${s.ok ? 'ok    ' : 'FAILED'} ${s.at_s.toFixed(2).padStart(7)} s  ${s.name}${s.ok ? '' : '  ' + JSON.stringify(s)}`);
rmSync(ud, { recursive: true, force: true });
process.exit(code === 0 && res?.ok ? 0 : 1);
