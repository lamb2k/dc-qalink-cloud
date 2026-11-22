// The session store: everything the UI reads. Append-only while a session runs; truncate() for replay seeks.
// Pictures are indexed by number n (1-based). A picture that never arrived is a gap: its values read NaN and
// gaps() lists it, so charts break the line instead of joining across it.
import type { CounterRecord, GrabRecord, LogRecord, MetaRecord, PhaseDef, RowRecord, SessionRecord, TraceRecord } from './format';

export interface TraceEvent { lane: number; start: number; end: number; label: string }
export interface Stats { mean: number; p95: number; worst: number; at: number; over: number; n: number }

const NONE = Number.NaN;

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

  reset(meta: MetaRecord | null = null): void {
    this.meta = meta; this.maxN = 0; this.count = 0; this.ended = false;
    this.cap = 0; this.cols.clear(); this.fields = new Uint8Array(0); this.have = new Uint8Array(0);
    this.logs = []; this.logN = []; this.trace = []; this.laneMaxDur = []; this.traceCount = 0;
    this.lanes = meta?.lanes ? [...meta.lanes] : [];
    for (let i = 0; i < this.lanes.length; i++) { this.trace.push([]); this.laneMaxDur.push(0); }
    this.grabs = []; this.counters = [];
    this.version++;
  }

  get phases(): PhaseDef[] { return this.meta?.phases ?? []; }
  get rate(): number { return this.meta?.rate ?? 30; }

  private keys(): string[] {
    const k = this.phases.map((p) => p.key);
    for (const e of this.meta?.extras ?? []) k.push(e.key);
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
      case 'log': this.logs.push(r); this.logN.push(r.n ?? 0); break;
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
    if (r.x) for (const [k, v] of Object.entries(r.x)) this.cols.get(k)?.set([v], r.n);
    this.fields[r.n] = r.f ?? 0;
    if (r.n > this.maxN) this.maxN = r.n;
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
