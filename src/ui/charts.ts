// Canvas renderers on one picture axis. Colours, fonts and sizes come from tokens. Labels live in their own
// bands and gutters, never over a data line. A gap (pictures that never arrived) breaks every line and is hatched.
import type { PhaseDef } from '../data/format';
import type { SessionStore } from '../data/store';
import { fmt, num, tok } from './dom';

export interface Axis { a: number; b: number; left: number; right: number; x(n: number): number; n(x: number): number }
export function axis(a: number, b: number, left: number, right: number): Axis {
  const span = Math.max(1, b - a); const w = Math.max(1, right - left);
  return { a, b, left, right, x: (n) => left + ((n - a) / span) * w, n: (x) => Math.round(a + ((x - left) / w) * span) };
}

export interface StripsOpts {
  phases: PhaseDef[];
  range: [number, number];
  playhead: number;
  hover: number | null;
  select?: [number, number] | null;
  showAxis?: boolean;
  slowN?: number;
}
export interface StripsLayout { ax: Axis; strips: { phase: PhaseDef; y0: number; y1: number }[] }

const font = () => tok('--chart-font');
const fontUi = () => tok('--chart-font-ui');

/** small multiples: one strip per phase, each with its own scale and budget line */
export function drawStrips(g: CanvasRenderingContext2D, w: number, h: number, st: SessionStore, o: StripsOpts): StripsLayout {
  const gut = num('--s-10'), padR = num('--s-2'), band = num('--lh-sm'), mark = num('--s-2'), axisH = o.showAxis === false ? 0 : num('--s-5'), gap = num('--s-2');
  g.clearRect(0, 0, w, h);
  const ax = axis(o.range[0], o.range[1], gut, w - padR);
  const k = o.phases.length; const sh = Math.max(10, (h - mark - axisH - gap * (k - 1)) / Math.max(1, k));
  const strips: StripsLayout['strips'] = [];
  const gaps = st.gaps();
  const win = st.meta?.window;
  const slow = st.slowestBusy(o.slowN ?? 5);
  o.phases.forEach((p, i) => {
    const top = mark + i * (sh + gap); const y0 = top + band, y1 = top + sh;
    strips.push({ phase: p, y0, y1 });
    const col = st.column(p.key);
    const color = tok(p.color || '--chart-draw');
    let max = 0; if (col) for (let n = Math.max(1, ax.a); n <= Math.min(ax.b, st.maxN); n++) { const v = col[n]; if (v > max) max = v; }
    max = niceMax(Math.max(max * 1.08, (p.budget || 0) * 1.25, 1));
    const y = (v: number) => y1 - (v / max) * (y1 - y0 - 2);
    // plot background, grid
    g.fillStyle = tok('--bg-canvas'); g.fillRect(ax.left, y0, ax.right - ax.left, y1 - y0);
    g.strokeStyle = tok('--chart-grid'); g.lineWidth = 1;
    const step = niceStep(max);
    for (let v = step; v < max; v += step) { const yy = Math.round(y(v)) + 0.5; g.beginPath(); g.moveTo(ax.left, yy); g.lineTo(ax.right, yy); g.stroke(); }
    if (win && win[0] > ax.a) { g.fillStyle = tok('--bg-inset'); g.fillRect(ax.left, y0, Math.max(0, Math.min(ax.right, ax.x(win[0])) - ax.left), y1 - y0); }
    hatchGaps(g, ax, gaps, y0, y1);
    if (col) series(g, ax, col, st.maxN, y, y1, color);
    if (p.budget) {
      g.fillStyle = tok('--chart-over');
      if (col) for (let n = Math.max(1, ax.a, win ? win[0] : 1); n <= Math.min(ax.b, st.maxN); n++) if (col[n] > p.budget) g.fillRect(Math.round(ax.x(n)) - 0.5, y1 - 2, Math.max(1, ax.x(n + 1) - ax.x(n)), 2);
      g.setLineDash([4, 3]); g.strokeStyle = tok('--chart-budget'); g.lineWidth = 1;
      const yb = Math.round(y(p.budget)) + 0.5; g.beginPath(); g.moveTo(ax.left, yb); g.lineTo(ax.right, yb); g.stroke(); g.setLineDash([]);
    }
    g.strokeStyle = tok('--border'); g.lineWidth = 1; g.strokeRect(ax.left + 0.5, y0 + 0.5, ax.right - ax.left - 1, y1 - y0 - 1);
    // gutter: scale labels; the budget label wins over max/0 when they would collide
    g.font = font(); g.textBaseline = 'middle'; g.textAlign = 'right';
    const lx = ax.left - num('--s-1');
    const yb = p.budget ? y(p.budget) : -99, near = (yy: number) => Math.abs(yy - yb) < num('--s-3');
    g.fillStyle = tok('--chart-axis');
    if (!near(y0 + 5)) g.fillText(fmt(max, max < 10 ? 1 : 0), lx, y0 + 5);
    if (!near(y1 - 4)) g.fillText('0', lx, y1 - 4);
    if (p.budget) { g.fillStyle = tok('--text'); g.fillText(fmt(p.budget, 1), lx, yb); }
    // label band above the plot: name, budget, value at the playhead (right)
    g.textAlign = 'left'; g.font = fontUi(); g.fillStyle = tok('--text');
    const by = top + band / 2;
    g.fillText(p.label, ax.left, by);
    const lw = g.measureText(p.label).width;
    if (p.budget) { g.fillStyle = tok('--text-muted'); g.fillText(`budget ${fmt(p.budget, 1)} ms`, ax.left + lw + num('--s-2'), by); }
    const at = o.hover ?? o.playhead; const v = col && at >= 1 ? col[at] : NaN;
    g.textAlign = 'right'; g.font = font(); g.fillStyle = p.budget && v > p.budget ? tok('--err') : tok('--text-strong');
    g.fillText(Number.isNaN(v) ? (at >= 1 && at <= st.maxN ? `${at}: gap` : '') : `${at}: ${fmt(v)} ms`, ax.right, by);
  });
  // slowest pictures: small markers in the top band
  g.fillStyle = tok('--chart-over');
  for (const n of slow) { if (n < ax.a || n > ax.b) continue; const xx = ax.x(n); g.beginPath(); g.moveTo(xx - 4, 0); g.lineTo(xx + 4, 0); g.lineTo(xx, mark - 2); g.closePath(); g.fill(); }
  const bottom = mark + k * (sh + gap) - gap;
  if (o.select) { g.fillStyle = tok('--chart-select'); const s0 = ax.x(Math.min(...o.select)), s1 = ax.x(Math.max(...o.select)); g.fillRect(s0, mark, s1 - s0, bottom - mark); }
  // playhead and hover lines run inside each plot only, never through a label band
  for (const s of strips) cursorLines(g, ax, o.playhead, o.hover, s.y0, s.y1);
  if (axisH) drawAxis(g, ax, bottom + 2);
  return { ax, strips };
}

function series(g: CanvasRenderingContext2D, ax: Axis, col: Float32Array, maxN: number, y: (v: number) => number, floor: number, color: string): void {
  const a = Math.max(1, Math.floor(ax.a)), b = Math.min(maxN, Math.ceil(ax.b));
  const perPx = (b - a) / Math.max(1, ax.right - ax.left);
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1.25;
  if (perPx > 1.5) {
    // envelope: min..max per pixel column, gaps left empty
    for (let x = Math.floor(ax.left); x < ax.right; x++) {
      const n0 = Math.max(a, ax.n(x)), n1 = Math.min(b, ax.n(x + 1));
      let lo = Infinity, hi = -Infinity;
      for (let n = n0; n <= n1; n++) { const v = col[n]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      if (hi < lo) continue;
      g.globalAlpha = 0.18; g.fillRect(x, y(hi), 1, floor - y(hi)); g.globalAlpha = 1;
      g.fillRect(x, y(hi), 1, Math.max(1, y(lo) - y(hi)));
    }
    return;
  }
  // runs of consecutive pictures; a NaN ends a run (a gap is never joined)
  let n = a;
  while (n <= b) {
    while (n <= b && Number.isNaN(col[n])) n++;
    if (n > b) break;
    const s = n; while (n <= b && !Number.isNaN(col[n])) n++;
    const e = n - 1;
    g.beginPath(); g.moveTo(ax.x(s), floor);
    for (let k = s; k <= e; k++) g.lineTo(ax.x(k), y(col[k]));
    g.lineTo(ax.x(e), floor); g.closePath(); g.globalAlpha = 0.18; g.fill(); g.globalAlpha = 1;
    g.beginPath(); g.moveTo(ax.x(s), y(col[s]));
    for (let k = s + 1; k <= e; k++) g.lineTo(ax.x(k), y(col[k]));
    if (s === e) g.lineTo(ax.x(s) + 1, y(col[s]));
    g.stroke();
  }
}

export function hatchGaps(g: CanvasRenderingContext2D, ax: Axis, gaps: [number, number][], y0: number, y1: number): void {
  for (const [a, b] of gaps) {
    if (b < ax.a || a > ax.b) continue;
    const x0 = Math.max(ax.left, ax.x(a - 0.5)), x1 = Math.min(ax.right, ax.x(b + 0.5)); const w = Math.max(2, x1 - x0);
    g.save(); g.beginPath(); g.rect(x0, y0, w, y1 - y0); g.clip();
    g.fillStyle = tok('--warn-soft'); g.fillRect(x0, y0, w, y1 - y0);
    g.strokeStyle = tok('--warn'); g.lineWidth = 1; g.globalAlpha = 0.6;
    for (let x = x0 - (y1 - y0); x < x0 + w; x += 4) { g.beginPath(); g.moveTo(x, y1); g.lineTo(x + (y1 - y0), y0); g.stroke(); }
    g.restore();
  }
}

export function cursorLines(g: CanvasRenderingContext2D, ax: Axis, playhead: number, hover: number | null, top: number, bottom: number): void {
  if (hover != null && hover !== playhead && hover >= ax.a && hover <= ax.b) {
    const xh = Math.round(ax.x(hover)) + 0.5; g.strokeStyle = tok('--text-faint'); g.setLineDash([2, 2]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(xh, top); g.lineTo(xh, bottom); g.stroke(); g.setLineDash([]);
  }
  if (playhead >= ax.a && playhead <= ax.b) {
    const xc = Math.round(ax.x(playhead)) + 0.5; g.strokeStyle = tok('--chart-cursor'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(xc, top); g.lineTo(xc, bottom); g.stroke();
  }
}

export function drawAxis(g: CanvasRenderingContext2D, ax: Axis, y: number): void {
  g.font = font(); g.fillStyle = tok('--chart-axis'); g.textAlign = 'center'; g.textBaseline = 'top';
  const step = niceTick(ax.b - ax.a, (ax.right - ax.left) / 56);
  for (let n = Math.ceil(ax.a / step) * step; n <= ax.b; n += step) {
    const xx = ax.x(n); if (xx < ax.left + 8 || xx > ax.right - 8) continue;
    g.fillRect(Math.round(xx), y - 2, 1, 3); g.fillText(String(n), xx, y + 2);
  }
  g.textBaseline = 'middle';
}

/** stacked picture time: phases (not the total) plus pacer wait, against the total's budget */
export function drawStacked(g: CanvasRenderingContext2D, w: number, h: number, st: SessionStore, range: [number, number], playhead: number, hover: number | null): Axis {
  g.clearRect(0, 0, w, h);
  const gut = num('--s-10'), padR = num('--s-2'), top = num('--s-2'), axisH = num('--s-5');
  const ax = axis(range[0], range[1], gut, w - padR);
  const total = st.phases.find((p) => p.total);
  const parts = st.phases.filter((p) => !p.total).map((p) => ({ key: p.key, color: tok(p.color || '--chart-draw') }));
  if (st.column('wait')) parts.push({ key: 'wait', color: tok('--chart-wait') });
  let max = (total?.budget ?? 33.3) * 1.5;
  const tc = total ? st.column(total.key) : undefined;
  if (tc) for (let n = Math.max(1, ax.a); n <= Math.min(ax.b, st.maxN); n++) if (tc[n] > max) max = tc[n];
  max = niceMax(max);
  const y1 = h - axisH, y = (v: number) => y1 - (v / max) * (y1 - top);
  g.fillStyle = tok('--bg-canvas'); g.fillRect(ax.left, top, ax.right - ax.left, y1 - top);
  g.font = font(); g.textBaseline = 'middle'; g.textAlign = 'right'; g.lineWidth = 1;
  const step = niceStep(max);
  for (let v = step; v <= max; v += step) { g.strokeStyle = tok('--chart-grid'); g.beginPath(); g.moveTo(ax.left, Math.round(y(v)) + 0.5); g.lineTo(ax.right, Math.round(y(v)) + 0.5); g.stroke(); }
  hatchGaps(g, ax, st.gaps(), top, y1);
  const cols = parts.map((p) => ({ ...p, c: st.column(p.key) }));
  const a = Math.max(1, Math.floor(ax.a)), b = Math.min(st.maxN, Math.ceil(ax.b));
  const bw = Math.max(1, ax.x(a + 1) - ax.x(a));
  const perPx = Math.max(1, Math.ceil(1 / bw));
  for (let n = a; n <= b; n += perPx) {
    if (!st.has(n)) continue;
    let acc = 0; const x0 = ax.x(n);
    for (const p of cols) { const v = p.c ? p.c[n] : NaN; if (!(v > 0)) continue; g.fillStyle = p.color; g.fillRect(x0, y(acc + v), Math.max(1, bw - (bw > 3 ? 0.5 : 0)), y(acc) - y(acc + v)); acc += v; }
  }
  if (total?.budget) {
    g.setLineDash([4, 3]); g.strokeStyle = tok('--chart-budget'); const yb = Math.round(y(total.budget)) + 0.5;
    g.beginPath(); g.moveTo(ax.left, yb); g.lineTo(ax.right, yb); g.stroke(); g.setLineDash([]);
  }
  g.strokeStyle = tok('--border'); g.strokeRect(ax.left + 0.5, top + 0.5, ax.right - ax.left - 1, y1 - top - 1);
  g.fillStyle = tok('--chart-axis'); g.textAlign = 'right';
  const yb = total?.budget ? y(total.budget) : -99;
  for (let v = step; v <= max; v += step) if (Math.abs(y(v) - yb) > num('--s-3')) g.fillText(String(Math.round(v)), ax.left - num('--s-1'), y(v));
  if (total?.budget) { g.fillStyle = tok('--text'); g.fillText(fmt(total.budget, 1), ax.left - num('--s-1'), yb); }
  cursorLines(g, ax, playhead, hover, top, y1);
  drawAxis(g, ax, y1 + 2);
  return ax;
}

export interface LaneOpts { range: [number, number]; playhead: number; hover: number | null; labelW: number; laneH?: number; labels?: boolean; select?: [number, number] | null }
export interface LaneRow { name: string; kind: 'trace' | 'over' | 'slow' | 'gaps' | 'log'; lane?: number }

export function laneRows(st: SessionStore): LaneRow[] {
  const rows: LaneRow[] = st.lanes.map((name, i) => ({ name, kind: 'trace' as const, lane: i }));
  rows.push({ name: 'Over budget', kind: 'over' }, { name: 'Slowest pictures', kind: 'slow' }, { name: 'Gaps', kind: 'gaps' }, { name: 'Log lines', kind: 'log' });
  return rows;
}

/** trace lanes on the picture axis; 100,000 events stay fast: each lane draws only what is in range, and when
 *  events are denser than pixels it draws a count per pixel column */
export function drawLanes(g: CanvasRenderingContext2D, w: number, h: number, st: SessionStore, o: LaneOpts): { ax: Axis; rows: LaneRow[]; lh: number } {
  g.clearRect(0, 0, w, h);
  const rows = laneRows(st);
  const lh = o.laneH ?? Math.max(num('--s-3'), h / rows.length);
  const ax = axis(o.range[0], o.range[1], o.labelW, w - num('--s-2'));
  const win = st.meta?.window;
  g.font = fontUi(); g.textBaseline = 'middle';
  const pad = Math.max(2, Math.round(lh * 0.18));
  rows.forEach((r, i) => {
    const y0 = i * lh;
    g.fillStyle = i % 2 ? tok('--bg-panel') : tok('--bg-canvas'); g.fillRect(0, y0, w, lh);
    g.fillStyle = tok('--text-muted'); g.textAlign = 'left'; g.fillText(r.name, num('--s-2'), y0 + lh / 2, o.labelW - num('--s-3'));
    g.save(); g.beginPath(); g.rect(ax.left, y0, ax.right - ax.left, lh); g.clip();
    if (r.kind === 'trace') traceLane(g, ax, st, r.lane!, y0 + pad, lh - pad * 2, o.labels !== false);
    else if (r.kind === 'over') {
      g.fillStyle = tok('--chart-over');
      const budgeted = st.phases.filter((p) => p.budget && !p.total);
      const a = Math.max(1, Math.floor(ax.a)), b = Math.min(st.maxN, Math.ceil(ax.b));
      for (let n = Math.max(a, win ? win[0] : 1); n <= b; n++) if (budgeted.some((p) => st.value(p.key, n) > p.budget!)) g.fillRect(Math.round(ax.x(n)), y0 + pad, Math.max(1, ax.x(n + 1) - ax.x(n)), lh - pad * 2);
    } else if (r.kind === 'slow') {
      g.fillStyle = tok('--chart-over');
      for (const n of st.slowestBusy(5)) { const xx = ax.x(n), m = lh / 2 - pad; g.beginPath(); g.moveTo(xx, y0 + pad); g.lineTo(xx + m, y0 + lh / 2); g.lineTo(xx, y0 + lh - pad); g.lineTo(xx - m, y0 + lh / 2); g.closePath(); g.fill(); }
    } else if (r.kind === 'gaps') {
      hatchGaps(g, ax, st.gaps(), y0 + pad, y0 + lh - pad);
    } else if (r.kind === 'log') {
      g.fillStyle = tok('--text-faint');
      const cols = new Map<number, number>();
      const from = Math.max(0, st.logIndexAt(ax.a - 1) + 1), to = st.logIndexAt(ax.b);
      for (let k = from; k <= to; k++) { const l = st.logs[k]; if (l.n == null) continue; const x = Math.round(ax.x(l.n)); cols.set(x, (cols.get(x) ?? 0) + (l.lv === 'warn' || l.lv === 'err' ? 10 : 1)); }
      for (const [x, c] of cols) { const hh = Math.min(lh - pad * 2, 3 + (c % 10) * 2); g.fillStyle = c >= 10 ? tok('--warn') : tok('--text-faint'); g.fillRect(x, y0 + lh - pad - hh, 1, hh); }
    }
    g.restore();
  });
  if (win && win[0] > ax.a) { g.fillStyle = tok('--scrim'); g.globalAlpha = 0.35; g.fillRect(ax.left, 0, Math.max(0, ax.x(win[0]) - ax.left), rows.length * lh); g.globalAlpha = 1; }
  g.strokeStyle = tok('--border'); g.lineWidth = 1; g.beginPath(); g.moveTo(ax.left - 0.5, 0); g.lineTo(ax.left - 0.5, rows.length * lh); g.stroke();
  if (o.select) { g.fillStyle = tok('--chart-select'); const s0 = ax.x(Math.min(...o.select)), s1 = ax.x(Math.max(...o.select)); g.fillRect(s0, 0, s1 - s0, rows.length * lh); }
  cursorLines(g, ax, o.playhead, o.hover, 0, rows.length * lh);
  return { ax, rows, lh };
}

function traceLane(g: CanvasRenderingContext2D, ax: Axis, st: SessionStore, lane: number, y: number, hh: number, labels: boolean): void {
  const L = st.trace[lane] ?? []; const { from, to } = st.traceIn(lane, ax.a, ax.b);
  const px = ax.right - ax.left;
  if (to - from > px * 2) {
    // density: events per pixel column
    const cnt = new Uint16Array(Math.ceil(px) + 1);
    for (let i = from; i < to; i++) { const e = L[i]; if (e.end < ax.a) continue; const x = Math.floor(ax.x(e.start) - ax.left); if (x >= 0 && x < cnt.length) cnt[x] = Math.min(65535, cnt[x] + 1); }
    let mx = 1; for (const c of cnt) if (c > mx) mx = c;
    g.fillStyle = tok('--accent');
    for (let x = 0; x < cnt.length; x++) if (cnt[x]) { const f = 0.25 + 0.75 * (cnt[x] / mx); g.globalAlpha = f; g.fillRect(ax.left + x, y, 1, hh); }
    g.globalAlpha = 1;
    return;
  }
  const minLabel = num('--s-10');
  for (let i = from; i < to; i++) {
    const e = L[i]; if (e.end < ax.a) continue;
    const x0 = ax.x(e.start), x1 = ax.x(e.end);
    if (e.end > e.start) {
      g.fillStyle = tok('--accent-soft'); g.fillRect(x0, y, Math.max(1, x1 - x0), hh);
      g.fillStyle = tok('--accent'); g.fillRect(x0, y, 2, hh);
      if (labels && x1 - x0 > minLabel) { g.save(); g.beginPath(); g.rect(x0, y, x1 - x0 - 2, hh); g.clip(); g.font = font(); g.fillStyle = tok('--text'); g.textAlign = 'left'; g.fillText(e.label, x0 + 5, y + hh / 2); g.restore(); }
    } else { g.fillStyle = tok('--warn'); g.fillRect(Math.round(x0), y, 2, hh); }
  }
}

export function drawRuler(g: CanvasRenderingContext2D, w: number, h: number, st: SessionStore, range: [number, number], playhead: number, labelW: number, dataEnd: number): Axis {
  g.clearRect(0, 0, w, h);
  const ax = axis(range[0], range[1], labelW, w - num('--s-2'));
  g.fillStyle = tok('--bg-raised'); g.fillRect(0, 0, w, h);
  // the part of the axis with no data yet (replay ahead of the clock, or not arrived)
  if (dataEnd < ax.b) { g.fillStyle = tok('--bg-inset'); g.fillRect(ax.x(Math.max(ax.a, dataEnd)), 0, ax.right - ax.x(Math.max(ax.a, dataEnd)), h); }
  g.font = font(); g.fillStyle = tok('--chart-axis'); g.textBaseline = 'middle'; g.textAlign = 'center';
  const major = niceTick(ax.b - ax.a, (ax.right - ax.left) / 64), minor = major / 5;
  for (let n = Math.ceil(ax.a / minor) * minor; n <= ax.b; n += minor) {
    const xx = Math.round(ax.x(n)); const big = Math.abs(n / major - Math.round(n / major)) < 1e-6;
    g.fillRect(xx, h - (big ? 8 : 4), 1, big ? 8 : 4); if (big && xx > ax.left + 12) g.fillText(String(Math.round(n)), xx, h / 2 - 2);
  }
  g.fillStyle = tok('--chart-over'); for (const n of st.slowestBusy(5)) if (n >= ax.a && n <= ax.b) g.fillRect(Math.round(ax.x(n)) - 1, 0, 2, 3);
  if (playhead >= ax.a && playhead <= ax.b) {
    const lbl = String(playhead); const tw = g.measureText(lbl).width + 10;
    const xc = Math.min(w - tw / 2 - 1, Math.max(ax.left + tw / 2, Math.round(ax.x(playhead)))); // the flag stays whole at either end
    g.fillStyle = tok('--accent-solid'); g.fillRect(xc - tw / 2, 2, tw, h - 4); g.fillStyle = tok('--on-accent'); g.fillText(lbl, xc, h / 2);
  }
  g.fillStyle = tok('--text-faint'); g.textAlign = 'left'; g.font = fontUi(); g.fillText('picture', num('--s-2'), h / 2);
  return ax;
}

export function niceMax(v: number): number {
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]; const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const s of steps) if (s * p >= v) return s * p;
  return 10 * p;
}
export function niceStep(max: number): number { return max > 40 ? 10 : max > 20 ? 5 : max > 8 ? 2 : max > 4 ? 1 : max > 2 ? 0.5 : 0.25; }
export function niceTick(span: number, maxTicks: number): number {
  const raw = span / Math.max(1, maxTicks); const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  for (const s of [1, 2, 5, 10]) if (s * p >= raw) return Math.max(1, s * p);
  return 10 * p;
}
