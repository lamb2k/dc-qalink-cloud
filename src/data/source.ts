// A Source fills a SessionStore and controls where the data comes from. The UI talks only to this interface.
import type { CommandRequest, CommandResult, MemoryReadResult, RunRecord } from './bridge-api';
import type { GrabRecord, SessionRecord } from './format';
import { parseSession } from './format';
import { SessionStore } from './store';

/** linked: live data arriving; replay: a recording playing; lost: link dropped, data kept, retrying; unlinked: nothing */
export type SourceState = 'unlinked' | 'connecting' | 'linked' | 'lost' | 'replay';

export interface SourceInfo {
  /** where the data comes from, for the top bar ("Flycast on this PC, broadband adapter") */
  device: string;
  transport: string;
  /** bytes a second arriving (live) or the recording's equivalent rate (replay) */
  rateBps: number;
  /** link lost: picture at which it dropped, seconds to the next retry, attempt number */
  lostAt?: number;
  retryIn?: number;
  attempt?: number;
  error?: string;
  /** replay: the session's label */
  label?: string;
}

export interface Source {
  readonly kind: 'replay' | 'live' | 'idle';
  readonly store: SessionStore;
  state: SourceState;
  info: SourceInfo;
  /** replay clock or console run state */
  playing: boolean;
  speed: number;
  on(ev: 'state' | 'data', fn: () => void): () => void;
  start(): Promise<void>;
  stop(): void;
  /** advance clocks; called once a picture by the app loop with performance.now() */
  tick(now: number): void;
  play(): void;
  pause(): void;
  step(count?: number): void;
  /** replay: move the clock to picture n (data after n is dropped, data up to n arrives). live: no-op */
  seek(n: number): void;
  setSpeed(x: number): void;
  retryNow(): void;
  grab(atN: number): Promise<GrabRecord | null>;
  command(c: CommandRequest): Promise<CommandResult>;
  runs(): Promise<RunRecord[]>;
  /** push a build; `args` reach the program through the loader (the same field as the MCP push's args) */
  pushBuild(file: File | { name: string; bytes: Uint8Array }, opts?: { args?: string }): Promise<RunRecord>;
  readMemory(addr: number, len: number, atN: number): Promise<MemoryReadResult>;
}

export class Emitter {
  private fns = new Map<string, Set<() => void>>();
  on(ev: string, fn: () => void): () => void {
    let s = this.fns.get(ev); if (!s) this.fns.set(ev, (s = new Set()));
    s.add(fn); return () => s!.delete(fn);
  }
  emit(ev: string): void { this.fns.get(ev)?.forEach((f) => f()); }
}

// ---------------------------------------------------------------- replay
export interface ReplayOptions {
  /** clock for tests; defaults to performance.now */
  now?: () => number;
  /** start position: the clock begins here with data up to it */
  startAt?: number;
  /** simulate a link loss at this picture (demo of the lost state): data stops, retries fail until retryNow() */
  lossAt?: number;
  label?: string;
}

/** Plays a session file on a clock: records with picture <= clock are in the store. */
export class ReplaySource extends Emitter implements Source {
  readonly kind = 'replay';
  readonly store = new SessionStore();
  state: SourceState = 'replay';
  info: SourceInfo = { device: '', transport: '', rateBps: 0 };
  playing = false;
  speed = 1;
  /** the replay clock in pictures (fractional); data is revealed up to floor(clock) */
  clock = 0;
  private recs: SessionRecord[] = [];
  /** index of the first record not yet revealed (records sorted by picture) */
  private next = 0;
  private recN: number[] = [];
  private last = -1;
  private lossAt = 0;
  private lostSince = 0;
  readonly runsMock = new MockRunner();
  private now: () => number;

  constructor(records: SessionRecord[], private opt: ReplayOptions = {}) {
    super();
    this.now = opt.now ?? (() => performance.now());
    this.load(records);
    this.lossAt = opt.lossAt ?? 0;
  }
  static async fromUrl(url: string, opt: ReplayOptions = {}): Promise<ReplaySource> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return new ReplaySource(parseSession(await res.text()), opt);
  }

  private load(records: SessionRecord[]): void {
    const meta = records.find((r) => r.t === 'meta');
    if (!meta || meta.t !== 'meta') throw new Error('session has no meta record');
    // order by picture; records with no picture (loading log lines) come first; stable within a picture
    // a printed line (t "line") has no picture: it belongs to the latest row before it in the file
    let lastRow = 0;
    const keyed = records.filter((r) => r.t !== 'meta').map((r, i) => { if (r.t === 'row') lastRow = Math.max(lastRow, r.n); return { r, i, n: r.t === 'line' ? lastRow : recPicture(r) }; });
    keyed.sort((a, b) => a.n - b.n || a.i - b.i);
    this.recs = keyed.map((k) => k.r); this.recN = keyed.map((k) => k.n);
    this.store.reset(meta);
    const rowBytes = 160;
    this.info = { device: deviceLabel(meta.device), transport: meta.device.transport === 'bba' ? 'Broadband adapter' : 'Modem', rateBps: rowBytes * meta.rate, label: this.opt.label ?? meta.label };
    this.next = 0; this.clock = 0;
    this.reveal(0);
  }
  /** last picture in the recording */
  get length(): number { return this.recN.length ? Math.max(0, this.recN[this.recN.length - 1]) : 0; }

  private reveal(n: number): void {
    let changed = false;
    while (this.next < this.recs.length && this.recN[this.next] <= n) { this.store.append(this.recs[this.next++]); changed = true; }
    if (changed) this.emit('data');
  }

  async start(): Promise<void> {
    const s = this.opt.startAt ?? this.length;
    this.seek(s);
  }
  stop(): void { this.playing = false; }

  tick(now: number): void {
    if (this.state === 'lost') {
      const left = Math.max(0, 4 - ((now - this.lostSince) / 1000) % 4);
      const attempt = 1 + Math.floor((now - this.lostSince) / 4000);
      if (attempt !== this.info.attempt || Math.ceil(left) !== this.info.retryIn) { this.info.retryIn = Math.ceil(left); this.info.attempt = attempt; this.emit('state'); }
      return;
    }
    if (!this.playing) { this.last = now; return; }
    if (this.last < 0) this.last = now;
    const dt = Math.min(250, now - this.last); this.last = now;
    const rate = this.store.rate * this.speed;
    let c = this.clock + (dt / 1000) * rate;
    if (this.lossAt && this.clock < this.lossAt && c >= this.lossAt) c = this.lossAt;
    if (c >= this.length) { c = this.length; this.playing = false; this.emit('state'); }
    this.clock = c;
    this.reveal(Math.floor(c + 1e-6)); // a second of 1/60 s ticks sums to 29.99999 pictures, not 30
    if (this.lossAt && Math.floor(c + 1e-6) >= this.lossAt) this.loseLink(now);
  }
  private loseLink(now: number): void {
    this.state = 'lost'; this.lostSince = now; this.info.lostAt = Math.floor(this.clock); this.info.retryIn = 4; this.info.attempt = 1;
    this.emit('state');
  }
  retryNow(): void {
    if (this.state !== 'lost') return;
    this.state = 'replay'; this.lossAt = 0; this.info.lostAt = undefined; this.last = this.now();
    this.emit('state');
  }
  play(): void {
    if (this.state === 'lost') return;
    if (this.clock >= this.length) this.seek(1);
    this.playing = true; this.last = this.now(); this.emit('state');
  }
  pause(): void { this.playing = false; this.emit('state'); }
  step(count = 1): void { this.playing = false; this.seek(Math.floor(this.clock) + count); this.emit('state'); }
  seek(n: number): void {
    n = Math.max(0, Math.min(this.length, Math.round(n)));
    if (this.lossAt && n >= this.lossAt) { n = this.lossAt; }
    if (n < Math.floor(this.clock) || this.store.ended) {
      this.store.truncate(n);
      // rewind the cursor to the first record after n
      let lo = 0, hi = this.recN.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.recN[m] <= n) lo = m + 1; else hi = m; }
      this.next = lo;
      this.emit('data');
    }
    this.clock = n;
    this.reveal(n);
    if (this.lossAt && n >= this.lossAt && this.state !== 'lost') this.loseLink(this.now());
    this.emit('state');
  }
  setSpeed(x: number): void { this.speed = x; this.emit('state'); }

  async grab(atN: number): Promise<GrabRecord | null> { return this.store.grabAt(atN); }
  async command(c: CommandRequest): Promise<CommandResult> {
    if (c.cmd === 'pause') this.pause(); else if (c.cmd === 'resume') this.play(); else if (c.cmd === 'step') this.step(c.count ?? 1);
    return { ok: c.cmd === 'pause' || c.cmd === 'resume' || c.cmd === 'step', id: `replay-${Date.now()}`, error: c.cmd === 'warp' ? 'replay: a recording cannot warp' : undefined };
  }
  runs(): Promise<RunRecord[]> { return this.runsMock.list(); }
  pushBuild(file: File | { name: string; bytes: Uint8Array }, opts: { args?: string } = {}): Promise<RunRecord> { return this.runsMock.push(file, () => this.emit('state'), opts.args ?? ''); }
  async readMemory(addr: number, len: number, atN: number): Promise<MemoryReadResult> { return mockMemory(addr, len, atN); }
}

export function recPicture(r: SessionRecord): number {
  switch (r.t) {
    case 'row': case 'ctr': case 'grab': case 'trace': case 'end': return r.n;
    case 'log': return r.n ?? 0;
    default: return 0;
  }
}
export function deviceLabel(d: { kind: string; name: string }): string { return d.name || (d.kind === 'flycast' ? 'Flycast' : 'Dreamcast'); }

// ---------------------------------------------------------------- idle (no console linked)
/** The calm home: nothing linked. Holds the last session (if any) so the home can show it. */
export class IdleSource extends Emitter implements Source {
  readonly kind = 'idle';
  readonly store = new SessionStore();
  state: SourceState = 'unlinked';
  info: SourceInfo = { device: '', transport: '', rateBps: 0 };
  playing = false;
  speed = 1;
  constructor(readonly last: ReplaySource | null) { super(); }
  async start(): Promise<void> { /* nothing to start */ }
  stop(): void { /* nothing */ }
  tick(): void { /* nothing */ }
  play(): void { /* nothing */ }
  pause(): void { /* nothing */ }
  step(): void { /* nothing */ }
  seek(): void { /* nothing */ }
  setSpeed(): void { /* nothing */ }
  retryNow(): void { /* nothing */ }
  async grab(): Promise<GrabRecord | null> { return null; }
  async command(): Promise<CommandResult> { return { ok: false, id: '', error: 'no console linked' }; }
  runs(): Promise<RunRecord[]> { return Promise.resolve(MockRunner.history()); }
  pushBuild(): Promise<RunRecord> { return Promise.reject(new Error('no console linked')); }
  async readMemory(addr: number, len: number): Promise<MemoryReadResult> { return { addr, data: '', n: len * 0 }; }
}

// ---------------------------------------------------------------- mocks used until the bridge sends these
/** Runs on mock data: a pushed build goes queued -> pushing -> running -> passed with a report. */
export class MockRunner {
  private list_: RunRecord[] = MockRunner.history();
  static history(): RunRecord[] {
    return [
      { id: 'r-0007', file: 'example.elf', bytes: 412_880, sha256: '5e1c9a0d4b7f2e88a13c6d0f9b2e4a7c1d3f5b6a8c9e0f1a2b3c4d5e6f7a8b9c', device: 'Flycast, this PC', state: 'passed', queuedAt: '2026-11-22T10:42:10Z', endedAt: '2026-11-22T10:42:41Z', by: 'owner',
        report: { exit: 0, seconds: 31, pictures: 900, tier: 'Flycast, calibrated model (mock)', numbers: [{ label: 'Drawing mean', value: 9.84, unit: 'ms' }, { label: 'Picture worst', value: 21.07, unit: 'ms' }], notes: ['Returned to the loader after 900 pictures.', 'Guards: all 0.'] } },
      { id: 'r-0006', file: 'example.elf', bytes: 412_604, sha256: 'b07d3e2a9f1c4e6d8a0b2c4e6f8a1b3d5c7e9f0a2b4c6d8e0f1a3b5c7d9e1f2a', device: 'Flycast, this PC', state: 'crashed', queuedAt: '2026-11-22T10:31:55Z', endedAt: '2026-11-22T10:32:03Z', by: 'agent: cloud-ci',
        report: { exit: null, seconds: 8, pictures: 212, tier: 'Flycast, calibrated model (mock)', numbers: [], notes: ['Address error on read; the loader caught it and came back.'],
          crash: { pc: '0x8C01A3F4', pr: '0x8C01A2E0', symbol: 'cube_update + 0x54', source: { file: 'example/cubes.c', line: 88, at: 3, text: ['for (i = 0; i < n; i++) {', '    cube_t *c = &cubes[i];', '    c->spin += c->rate;', '    c->mesh->verts[0].y += lift; /* mesh is NULL for i >= 12 */', '}'] } } } },
      { id: 'r-0005', file: 'example.elf', bytes: 411_976, sha256: '0c4f6a8e2b1d3f5a7c9e0b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a', device: 'Dreamcast, living room', state: 'failed', queuedAt: '2026-11-21T21:05:12Z', endedAt: '2026-11-21T21:05:20Z', by: 'owner',
        report: { exit: 3, seconds: 8, pictures: 0, tier: 'console (mock)', numbers: [], notes: ['Hash did not match after sending (sent 411,976 B, verified 409,600 B).', 'Nothing ran; the loader kept the previous program.'] } },
    ];
  }
  async list(): Promise<RunRecord[]> { return this.list_.slice(); }
  async push(file: File | { name: string; bytes: Uint8Array }, changed: () => void, args = ''): Promise<RunRecord> {
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
    const sha = await sha256Hex(bytes);
    const id = `r-${String(8 + this.list_.length - 3).padStart(4, '0')}`;
    const run: RunRecord = { id, file: file.name, bytes: bytes.length, sha256: sha, device: 'Flycast, this PC', state: 'queued', queuedAt: new Date().toISOString(), by: 'you', args };
    this.list_.unshift(run);
    const steps: [number, RunRecord['state']][] = [[600, 'pushing'], [1600, 'running'], [4200, 'passed']];
    for (const [t, st] of steps) setTimeout(() => {
      run.state = st;
      if (st === 'passed') { run.endedAt = new Date().toISOString(); run.report = { exit: 0, seconds: 3, pictures: 90, tier: 'mock runner, not a device', numbers: [], notes: ['Mock run: the bridge does not take builds yet. Hash and size are real.'] }; }
      changed();
    }, t);
    return run;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic mock memory: a header, strings and counters that change with the picture. */
export function mockMemory(addr: number, len: number, atN: number): MemoryReadResult {
  const out = new Uint8Array(len);
  const text = 'QALINK01example.elf\0cube_update\0cube_draw\0heap\0';
  for (let i = 0; i < len; i++) {
    const a = addr + i; const off = a - 0x8c010000;
    let b: number;
    if (off >= 0 && off < text.length) b = text.charCodeAt(off);
    else if (off >= 0x100 && off < 0x110) { const w = (off - 0x100) >> 2; const v = [atN, atN * 3 + 7, 0x8c0a0000 + atN * 16, 12][w]; b = (v >>> ((off & 3) * 8)) & 255; }
    else b = ((a * 2654435761) >>> 24) & (off % 64 < 40 ? 255 : 0);
    out[i] = b;
  }
  let s = ''; for (const b of out) s += String.fromCharCode(b);
  return { addr, data: btoa(s), n: atN };
}
