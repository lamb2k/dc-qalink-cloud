// Speed test: the real app, fed 30 records a second (rows, counters, log, grabs) with 100,000 trace rows loaded.
// Reports frames a second and the app's own work per frame. Result: window.speedResult and #speed-result.
import './styles/tokens.css';
import './styles/components.css';
import './styles/shell.css';
import { App } from './ui/app';
import { ReplaySource } from './data/source';
import type { MetaRecord, SessionRecord } from './data/format';
import type { Workspace } from './ui/layout';

const Q = new URLSearchParams(location.search);
const SECONDS = Number(Q.get('seconds') ?? 10);
const TRACE = Number(Q.get('trace') ?? 100000);
const PICTURES = 30 * 120;

function synth(): SessionRecord[] {
  const meta: MetaRecord = {
    t: 'meta', format: 'dc-qalink.session', version: 1, id: 'speed', label: 'Speed test', program: { name: 'example.elf' },
    device: { kind: 'flycast', name: 'Synthetic feed', transport: 'bba' }, tier: 'synthetic speed test', recorded: '2026-11-22', rate: 30, units: 'ms per picture', synthetic: true,
    phases: [{ key: 'draw', label: 'Drawing', budget: 14, color: '--chart-draw' }, { key: 'logic', label: 'Game logic', budget: 9, color: '--chart-svc' }, { key: 'audio', label: 'Sound', budget: 2, color: '--chart-behav' }, { key: 'frame', label: 'Picture', budget: 33.3, color: '--chart-wait', total: true }],
    extras: [{ key: 'wait', label: 'Pacer wait' }], window: [1, PICTURES], lanes: ['Pad script', 'Scene', 'Loads', 'Sound'],
    counters: [{ key: 'a', name: 'Guard A', group: 'G', guard: true }, { key: 'b', name: 'Count B', group: 'G', guard: false }],
  };
  const r: SessionRecord[] = [meta];
  let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let n = 1; n <= PICTURES; n++) {
    const d = 9 + rnd() * 6, l = 3 + rnd() * 3, a = 0.6 + rnd() * 0.4; const busy = d + l + a;
    r.push({ t: 'row', n, ph: { draw: d, logic: l, audio: a, frame: Math.max(33.33, busy) }, f: 2, x: { wait: Math.max(0, 33.33 - busy) } });
    r.push({ t: 'ctr', n, v: { a: 0, b: n } });
    if (n % 3 === 0) r.push({ t: 'log', n, lv: n % 90 === 0 ? 'warn' : 'info', msg: `feed line at picture ${n}, value ${(rnd() * 1000).toFixed(1)}` });
  }
  return r;
}

async function run(): Promise<void> {
  const recs = synth();
  const src = new ReplaySource(recs, { startAt: 0 });
  await src.start(); src.seek(0);
  // 100,000 trace rows over the whole run, loaded up front
  const lanes = ['Pad script', 'Scene', 'Loads', 'Sound'];
  const t0 = performance.now();
  for (let i = 0; i < TRACE; i++) src.store.append({ t: 'trace', lane: lanes[i % 4], n: Math.floor((i / TRACE) * PICTURES) + 1, d: i % 7 === 0 ? 3 : 0, label: `ev ${i}` });
  const loadMs = performance.now() - t0;
  const app = new App(document.getElementById('app')!, src, { ws: (Q.get('ws') as Workspace) || 'perf', theme: 'dark', demoUrl: '' });
  src.play();
  const out = document.getElementById('speed-result')!;
  await new Promise((r) => setTimeout(r, 1500)); // settle
  app.perf.work.length = 0; app.perf.gaps.length = 0;
  const startN = src.store.maxN; const start = performance.now();
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  const secs = (performance.now() - start) / 1000;
  const gaps = app.perf.gaps.slice().sort((a, b) => a - b); const work = app.perf.work.slice().sort((a, b) => a - b);
  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? NaN;
  const res = {
    seconds: +secs.toFixed(2), frames: gaps.length, fps: +(gaps.length / secs).toFixed(1),
    frameMsP50: +q(gaps, 0.5).toFixed(2), frameMsP95: +q(gaps, 0.95).toFixed(2), frameMsMax: +(gaps[gaps.length - 1] ?? NaN).toFixed(2),
    workMsMean: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workMsP95: +q(work, 0.95).toFixed(2), workMsMax: +(work[work.length - 1] ?? NaN).toFixed(2),
    recordsPerSecond: +(((src.store.maxN - startN) * (1 + 1 + 1 / 3)) / secs).toFixed(1), picturesPerSecond: +((src.store.maxN - startN) / secs).toFixed(1),
    framesOver16ms: gaps.filter((g) => g > 1000 / 60).length, workOver16ms: work.filter((w) => w > 1000 / 60).length,
    traceRows: src.store.traceCount, traceLoadMs: +loadMs.toFixed(1), workspace: app.ws, logLines: src.store.logs.length,
  };
  (window as unknown as { speedResult: unknown }).speedResult = res;
  out.textContent = JSON.stringify(res);
}
void run();
