// The session store: everything the UI reads. Append-only while a session runs; truncate() for replay seeks.
// Pictures are indexed by number n (1-based). A picture that never arrived is a gap: its values read NaN and
// gaps() lists it, so charts break the line instead of joining across it.
import type { CounterRecord, GrabRecord, LogRecord, MetaRecord, PhaseDef, RowRecord, SessionRecord, TraceRecord, XValue } from './format';

export interface TraceEvent { lane: number; start: number; end: number; label: string }
export interface Stats { mean: number; p95: number; worst: number; at: number; over: number; n: number }

const NONE = Number.NaN;
/** The log keeps at most LOG_MAX lines (structured and printed); past it the oldest tenth goes. A printed line is cut
 *  to LINE_MAX characters. */
export const LOG_MAX = 50000, LINE_MAX = 500;
/** Row fields the meta does not declare are kept too, within bounds: at most X_KEYS keys; numbers get a column like a
 *  declared extra (so they can be plotted); strings (cut to X_STR characters) and arrays (numbers only, the first
 *  X_ARR) are kept as changes, at most X_CHANGES per key (the oldest go first). */
export const X_KEYS = 32, X_STR = 64, X_ARR = 16, X_CHANGES = 4096;
export interface XField { key: string; kind: 'num' | 'val' }
type XChange = { n: number; v: XValue };
const xClean = (v: unknown): XValue | undefined =>
  typeof v === 'number' ? v : typeof v === 'string' ? v.slice(0, X_STR)
    : Array.isArray(v) ? v.slice(0, X_ARR).map((e) => (typeof e === 'number' ? e : Number.NaN)) : undefined;
const xSame = (a: XValue, b: XValue): boolean => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((e, i) => Object.is(e, b[i])) : a === b);

export class SessionStore {
  meta: MetaRecord | null = null;
  /** bumps on every change; views redraw when it moves */
  version = 0;
  /** highest picture number received */
  maxN = 0;
  /** pictures received */
  count = 0;
  ended = false;

  private cap = 0;
  private cols = new Map<string, Float32Array>();
  private fields = new Uint8Array(0);
  private have = new Uint8Array(0);

  logs: LogRecord[] = [];
  /** for each log line, its picture (or 0 for lines with no picture) - parallel to logs */
  private logN: number[] = [];
  lanes: string[] = [];
  /** trace events by lane, each sorted by start */
  trace: TraceEvent[][] = [];
  private laneMaxDur: number[] = [];
  traceCount = 0;
  grabs: GrabRecord[] = [];
  counters: CounterRecord[] = [];
  /** undeclared row fields in the order first seen, and the changes of the non-numeric ones */
  private xs: XField[] = [];
  private xNum = new Set<string>();
  private xChanges = new Map<string, XChange[]>();
  /** values not kept: keys past X_KEYS, objects, a different kind than the key's first value */
  xDropped = 0;

  reset(meta: MetaRecord | null = null): void {
    this.meta = meta; this.maxN = 0; this.count = 0; this.ended = false; this.logsDropped = 0;
    this.cap = 0; this.cols.clear(); this.fields = new Uint8Array(0); this.have = new Uint8Array(0);
    this.logs = []; this.logN = []; this.trace = []; this.laneMaxDur = []; this.traceCount = 0;
    this.lanes = meta?.lanes ? [...meta.lanes] : [];
    for (let i = 0; i < this.lanes.length; i++) { this.trace.push([]); this.laneMaxDur.push(0); }
    this.grabs = []; this.counters = [];
    this.xs = []; this.xNum.clear(); this.xChanges.clear(); this.xDropped = 0;
    this.version++;
  }

  get phases(): PhaseDef[] { return this.meta?.phases ?? []; }
  get rate(): number { return this.meta?.rate ?? 30; }

  private keys(): string[] {
    const k = this.phases.map((p) => p.key);
    for (const e of this.meta?.extras ?? []) k.push(e.key);
    for (const x of this.xNum) k.push(x);
    return k;
  }

  private grow(n: number): void {
    if (n < this.cap) return;
    let cap = Math.max(1024, this.cap);
    while (cap <= n) cap *= 2;
    for (const k of this.keys()) {
      const a = new Float32Array(cap).fill(NONE);
      const old = this.cols.get(k);
      if (old) a.set(old);
      this.cols.set(k, a);
    }
    const f = new Uint8Array(cap); f.set(this.fields); this.fields = f;
    const h = new Uint8Array(cap); h.set(this.have); this.have = h;
    this.cap = cap;
  }

  append(r: SessionRecord): void {
    switch (r.t) {
      case 'meta': this.reset(r); return;
      case 'row': this.addRow(r); break;
      case 'log': this.addLog(r, r.n ?? 0); break;
      // what the program printed: a log line at the latest picture (0 before the first row)
      case 'line': this.addLog({ t: 'log', n: this.maxN, lv: 'serial', msg: String(r.text ?? '').replace(/\r?\n$/, '').slice(0, LINE_MAX) }, this.maxN); break;
      case 'trace': this.addTrace(r); break;
      case 'grab': this.addSorted(this.grabs, r); break;
      case 'ctr': this.addSorted(this.counters, r); break;
      case 'end': this.ended = true; break;
    }
    this.version++;
  }
  appendMany(rs: Iterable<SessionRecord>): void { for (const r of rs) this.append(r); }

  private addRow(r: RowRecord): void {
    if (!(r.n >= 1)) return;
    this.grow(r.n);
    if (!this.have[r.n]) this.count++;
    this.have[r.n] = 1;
    for (const [k, v] of Object.entries(r.ph)) this.cols.get(k)?.set([v], r.n);
    if (r.x) for (const [k, v] of Object.entries(r.x)) this.addX(k, v, r.n);
    this.fields[r.n] = r.f ?? 0;
    if (r.n > this.maxN) this.maxN = r.n;
  }
  private addX(k: string, raw: unknown, n: number): void {
    const col = this.cols.get(k);
    if (col) { if (typeof raw === 'number') col[n] = raw; else this.xDropped++; return; }
    const v = xClean(raw); if (v === undefined) { this.xDropped++; return; }
    let ch = this.xChanges.get(k);
    if (!ch) {
      if (this.xs.length >= X_KEYS) { this.xDropped++; return; }
      if (typeof v === 'number') {   // a new numeric field: a column, like a declared extra
        const a = new Float32Array(this.cap).fill(NONE); a[n] = v;
        this.cols.set(k, a); this.xNum.add(k); this.xs.push({ key: k, kind: 'num' }); return;
      }
      ch = []; this.xChanges.set(k, ch); this.xs.push({ key: k, kind: 'val' });
    }
    if (ch.length && ch[ch.length - 1].n > n) { this.addSorted(ch, { n, v }); }
    else if (!ch.length || !xSame(ch[ch.length - 1].v, v)) ch.push({ n, v });
    if (ch.length > X_CHANGES) ch.splice(0, ch.length - X_CHANGES);
  }
  /** the undeclared row fields seen so far */
  xFields(): XField[] { return this.xs; }
  /** an undeclared field's value at picture n: a number (NaN for a gap), or the last string or array sent at or before n */
  xAt(key: string, n: number): XValue | undefined {
    if (this.xNum.has(key)) return this.value(key, n);
    const ch = this.xChanges.get(key); if (!ch) return undefined;
    let lo = 0, hi = ch.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ch[m].n <= n) lo = m + 1; else hi = m; }
    return lo ? ch[lo - 1].v : undefined;
  }
  /** log lines dropped from the front to stay under LOG_MAX */
  logsDropped = 0;
  private addLog(r: LogRecord, n: number): void {
    this.logs.push(r); this.logN.push(n);
    if (this.logs.length > LOG_MAX) { const k = Math.ceil(LOG_MAX / 10); this.logs.splice(0, k); this.logN.splice(0, k); this.logsDropped += k; }
  }
  private addTrace(r: TraceRecord): void {
    let li = this.lanes.indexOf(r.lane);
    if (li < 0) { li = this.lanes.length; this.lanes.push(r.lane); this.trace.push([]); this.laneMaxDur.push(0); }
    const ev: TraceEvent = { lane: li, start: r.n, end: r.n + (r.d ?? 0), label: r.label };
    const lane = this.trace[li];
    if (lane.length && lane[lane.length - 1].start > ev.start) {
      lane.splice(lowerBound(lane, ev.start), 0, ev);
    } else lane.push(ev);
    if (ev.end - ev.start > this.laneMaxDur[li]) this.laneMaxDur[li] = ev.end - ev.start;
    this.traceCount++;
  }
  private addSorted<T extends { n: number }>(arr: T[], r: T): void {
    if (arr.length && arr[arr.length - 1].n > r.n) {
      let i = arr.length; while (i > 0 && arr[i - 1].n > r.n) i--;
      arr.splice(i, 0, r);
    } else arr.push(r);
  }

  /** Drops everything after picture n (replay seeks backwards). Lines with no picture (loading) stay. */
  truncate(n: number): void {
    if (n >= this.maxN && !this.ended) return;
    for (let i = n + 1; i <= this.maxN; i++) {
      if (this.have[i]) { this.have[i] = 0; this.count--; }
      for (const a of this.cols.values()) a[i] = NONE;
      this.fields[i] = 0;
    }
    let m = Math.min(this.maxN, n); while (m > 0 && !this.have[m]) m--; this.maxN = m;
    let k = this.logs.length; while (k > 0 && this.logN[k - 1] > n) k--;
    this.logs.length = k; this.logN.length = k;
    this.traceCount = 0;
    this.trace = this.trace.map((lane) => { const keep = lane.slice(0, lowerBound(lane, n + 1)); this.traceCount += keep.length; return keep; });
    this.grabs = this.grabs.filter((g) => g.n <= n);
    this.counters = this.counters.filter((c) => c.n <= n);
    for (const ch of this.xChanges.values()) { let k2 = ch.length; while (k2 > 0 && ch[k2 - 1].n > n) k2--; ch.length = k2; }
    this.ended = false;
    this.version++;
  }

  has(n: number): boolean { return n >= 1 && n <= this.maxN && this.have[n] === 1; }
  /** a phase or extra value at picture n; NaN for a gap or unknown key */
  value(key: string, n: number): number {
    const a = this.cols.get(key);
    return a && n >= 1 && n < this.cap ? a[n] : NONE;
  }
  column(key: string): Float32Array | undefined { return this.cols.get(key); }
  fieldsAt(n: number): number { return n < this.cap ? this.fields[n] : 0; }

  /** missing picture ranges [a, b] (inclusive) between 1 and maxN */
  gaps(): [number, number][] {
    const out: [number, number][] = [];
    let a = 0;
    for (let n = 1; n <= this.maxN; n++) {
      if (!this.have[n]) { if (!a) a = n; } else if (a) { out.push([a, n - 1]); a = 0; }
    }
    return out;
  }

  /** statistics of a key over [a, b] (default: the measured window clipped to the data); gaps are skipped */
  stats(key: string, budget = 0, range?: [number, number]): Stats {
    const [a, b] = range ?? this.windowRange();
    const col = this.cols.get(key); const v: number[] = [];
    let worst = -Infinity, at = 0, over = 0, sum = 0;
    if (col) for (let n = Math.max(1, a); n <= Math.min(b, this.maxN); n++) {
      const x = col[n]; if (Number.isNaN(x)) continue;
      v.push(x); sum += x; if (x > worst) { worst = x; at = n; } if (budget && x > budget) over++;
    }
    v.sort((p, q) => p - q);
    return { mean: v.length ? sum / v.length : NONE, p95: v.length ? v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] : NONE, worst: v.length ? worst : NONE, at, over, n: v.length };
  }
  windowRange(): [number, number] {
    const w = this.meta?.window;
    return w ? [w[0], Math.min(w[1], this.maxN)] : [1, this.maxN];
  }
  /** the k slowest pictures by key inside the measured window */
  slowest(key: string, k = 5): number[] {
    const col = this.cols.get(key); if (!col) return [];
    const [a, b] = this.windowRange(); const idx: number[] = [];
    for (let n = Math.max(1, a); n <= b; n++) if (!Number.isNaN(col[n])) idx.push(n);
    idx.sort((p, q) => col[q] - col[p]);
    return idx.slice(0, k);
  }
  /** busy time of a picture: the sum of its phases other than the total (what the program spent, before the pacer) */
  busy(n: number): number {
    let s = 0, any = false;
    for (const p of this.phases) if (!p.total) { const v = this.value(p.key, n); if (!Number.isNaN(v)) { s += v; any = true; } }
    return any ? s : NONE;
  }
  /** the k busiest pictures inside the measured window (the pacer makes picture totals tie, busy time does not) */
  slowestBusy(k = 5): number[] {
    const [a, b] = this.windowRange(); const idx: { n: number; v: number }[] = [];
    for (let n = Math.max(1, a); n <= b; n++) { const v = this.busy(n); if (!Number.isNaN(v)) idx.push({ n, v }); }
    idx.sort((p, q) => q.v - p.v);
    return idx.slice(0, k).map((x) => x.n);
  }
  totalKey(): string { return this.phases.find((p) => p.total)?.key ?? this.phases[0]?.key ?? ''; }

  /** latest grab at or before picture n */
  grabAt(n: number): GrabRecord | null {
    let lo = 0, hi = this.grabs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.grabs[m].n <= n) lo = m + 1; else hi = m; }
    for (let i = lo - 1; i >= 0; i--) if (this.grabs[i].kind !== 'reference') return this.grabs[i];
    return null;
  }
  /** counter values in effect at picture n (latest snapshot at or before n) */
  countersAt(n: number): Record<string, number> {
    let lo = 0, hi = this.counters.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.counters[m].n <= n) lo = m + 1; else hi = m; }
    return lo ? this.counters[lo - 1].v : {};
  }
  /** index of the last log line whose picture is at or before n (-1: none) */
  logIndexAt(n: number): number {
    let lo = 0, hi = this.logs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.logN[m] <= n) lo = m + 1; else hi = m; }
    return lo - 1;
  }
  /** trace events of one lane that overlap [a, b] */
  traceIn(lane: number, a: number, b: number): { from: number; to: number } {
    const L = this.trace[lane] ?? [];
    return { from: lowerBound(L, a - (this.laneMaxDur[lane] ?? 0)), to: lowerBound(L, b + 1) };
  }
}

function lowerBound(L: TraceEvent[], start: number): number {
  let lo = 0, hi = L.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (L[m].start < start) lo = m + 1; else hi = m; }
  return lo;
}
