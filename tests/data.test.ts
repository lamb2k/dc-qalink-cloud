import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSession, SessionFormatError, toJsonl, type MetaRecord, type SessionRecord } from '../src/data/format';
import { ReplaySource } from '../src/data/source';
import { SessionStore } from '../src/data/store';
import { apiCompatible, BRIDGE_API_VERSION, contractCompatible, uiRun, uiRunState } from '../src/data/bridge-api';

const meta: MetaRecord = {
  t: 'meta', format: 'dc-qalink.session', version: 1, id: 't', label: 'test', program: { name: 'example.elf' },
  device: { kind: 'flycast', name: 'Flycast', transport: 'bba' }, tier: 'test', recorded: '2026-11-22', rate: 30, units: 'ms',
  phases: [{ key: 'draw', label: 'Drawing', budget: 10 }, { key: 'frame', label: 'Picture', budget: 33.3, total: true }],
  window: [1, 100], lanes: ['Pad script'],
};
function session(n: number, missing: number[] = []): SessionRecord[] {
  const r: SessionRecord[] = [meta, { t: 'log', n: null, lv: 'info', ph: 'load', msg: 'loading' }];
  for (let i = 1; i <= n; i++) {
    if (missing.includes(i)) continue;
    r.push({ t: 'row', n: i, ph: { draw: i % 10 === 0 ? 12 : 5, frame: 33.3 } });
    if (i % 10 === 0) r.push({ t: 'log', n: i, lv: 'info', msg: `line ${i}` });
    if (i % 25 === 0) r.push({ t: 'grab', n: i, w: 640, h: 480, fmt: 'png', data: '' });
  }
  r.push({ t: 'trace', lane: 'Pad script', n: 5, d: 20, label: 'a' });
  return r;
}

describe('session format', () => {
  it('round-trips JSON lines', () => {
    const s = session(30);
    expect(parseSession(toJsonl(s))).toEqual(s);
  });
  it('refuses a newer version and a bad line', () => {
    expect(() => parseSession(JSON.stringify({ ...meta, version: 3 }))).toThrow(SessionFormatError);
    expect(() => parseSession(JSON.stringify(meta) + '\n{oops')).toThrow(/line 2/);
    expect(() => parseSession('{"t":"row","n":1,"ph":{}}')).toThrow(/first record must be meta/);
  });
  it('version 2 carries the build; version 1 files still open (ql-disc)', () => {
    const build = { id: 'b0123456789ab', program: { name: 'netdisc.elf', sha256: 'ab'.repeat(32), bytes: 10, commit: 'abc1234' }, disc: { manifest: 'cd'.repeat(32), mode: 'overlay' as const, files: 13, served: 5 }, loader: null, args: '', tier: 'flycast', created: 'x' };
    const v2 = parseSession(toJsonl([{ ...meta, version: 2, build }, { t: 'log', n: 1, lv: 'info', msg: 'x', build: build.id } as SessionRecord]));
    expect((v2[0] as MetaRecord).build?.id).toBe('b0123456789ab');
    expect(parseSession(toJsonl(session(5)))[0]).toMatchObject({ version: 1 });
  });
  it('decodes a twiddled RGB565 PVR with mip maps and a VQ one (generated)', async () => {
    const { decodePvr, twiddle } = await import('../src/data/assetdec');
    const pvr = (pix: number, df: number, w: number, hh: number, data: Uint8Array) => { const b = new Uint8Array(16 + data.length); b.set([80, 86, 82, 84]); new DataView(b.buffer).setUint32(4, 8 + data.length, true); b[8] = pix; b[9] = df; new DataView(b.buffer).setUint16(12, w, true); new DataView(b.buffer).setUint16(14, hh, true); b.set(data, 16); return b; };
    // 4x4 RGB565 twiddled + mips: 6 bytes pad, 1x1, 2x2, 4x4; the 4x4 level holds x + 4y at each texel's twiddled place
    const lvl = new Uint8Array(32); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const i = twiddle(x, y); lvl[i * 2] = x + 4 * y; }   // the blue bits
    const t = decodePvr(pvr(1, 2, 4, 4, new Uint8Array([...new Array(6 + 2 + 8).fill(0), ...lvl])), 'a.pvr');
    expect(t.mips.map((m) => m.w)).toEqual([4, 2, 1]);
    expect(t.format).toBe('RGB565');
    const blue = (x: number, y: number) => t.mips[0].rgba[(y * 4 + x) * 4 + 2];
    expect([blue(1, 0), blue(0, 1), blue(3, 3)]).toEqual([Math.round(1 * 255 / 31), Math.round(4 * 255 / 31), Math.round(15 * 255 / 31)]);
    // VQ 4x4: codebook entry 1 = four white texels; the 2x2 index map points the top-left block at it
    const code = new Uint8Array(2048); code.fill(0xff, 8, 16);
    const v = decodePvr(pvr(1, 3, 4, 4, new Uint8Array([...code, 1, 0, 0, 0])), 'v.pvr');
    expect([v.mips[0].rgba[0], v.mips[0].rgba[(1 * 4 + 1) * 4], v.mips[0].rgba[(2 * 4 + 2) * 4]]).toEqual([255, 255, 0]);
    // CONTROL: a file without PVRT is refused
    expect(() => decodePvr(new Uint8Array(32), 'bad.pvr')).toThrow(/PVRT/);
  });
  it('bridge API: major.minor must match', () => {
    expect(apiCompatible(BRIDGE_API_VERSION)).toBe(true);
    expect(apiCompatible('1.0.3')).toBe(true);
    expect(apiCompatible('0.2.0')).toBe(false); // contract 1 (ql-data) replaced the app's own 0.2.0 draft
    expect(contractCompatible(1)).toBe(true);
    expect(contractCompatible(0)).toBe(false); // control: ql-core's contract 0 is refused
    expect(uiRun({ id: 'a1b2c3d4', program: { name: 'p.elf', sha256: 'x', bytes: 4 }, args: '', state: 'done', times: {}, way_back: 'stub', by: 't', queued_at: '', ended_at: null, device: 'Flycast', tier: 'flycast', summary: { exit: 0, state: 'done', seconds: 1, pictures: 2, numbers: [], notes: [], tier: 'flycast' }, error: null, stills: [], serial_lines: 0 }).state).toBe('passed');
    expect(uiRunState('done', 3)).toBe('failed');
    expect(uiRunState('timeout', null)).toBe('failed');
    expect(uiRunState('sending', null)).toBe('pushing');
  });
});

describe('replay timing', () => {
  it('reveals records on the clock: 30 pictures a second at speed 1', () => {
    let t = 0;
    const src = new ReplaySource(session(300), { now: () => t, startAt: 0 });
    src.seek(0);
    expect(src.store.maxN).toBe(0);
    expect(src.store.logs.length).toBe(1); // loading line, no picture
    src.play(); t = 0; src.tick(t);
    for (let k = 0; k < 60; k++) { t += 1000 / 60; src.tick(t); } // one second at 60 Hz
    expect(src.store.maxN).toBe(30);
    expect(src.store.count).toBe(30);
    src.setSpeed(2);
    for (let k = 0; k < 60; k++) { t += 1000 / 60; src.tick(t); }
    expect(src.store.maxN).toBe(90);
  });
  it('pause stops the clock; step moves one picture', () => {
    let t = 0;
    const src = new ReplaySource(session(100), { now: () => t, startAt: 0 });
    src.seek(10); src.pause();
    t += 5000; src.tick(t);
    expect(src.store.maxN).toBe(10);
    src.step(); expect(src.store.maxN).toBe(11);
    src.step(5); expect(src.store.maxN).toBe(16);
    expect(src.playing).toBe(false);
  });
  it('stops at the end of the recording', () => {
    let t = 0;
    const src = new ReplaySource(session(40), { now: () => t, startAt: 0 });
    src.seek(0); src.play();
    for (let k = 0; k < 200; k++) { t += 50; src.tick(t); }
    expect(src.store.maxN).toBe(40);
    expect(src.playing).toBe(false);
  });
  it('a long stall does not jump more than a quarter second', () => {
    let t = 0;
    const src = new ReplaySource(session(300), { now: () => t, startAt: 0 });
    src.seek(0); src.play(); src.tick(t);
    t += 10_000; src.tick(t);
    expect(src.store.maxN).toBeLessThanOrEqual(8);
  });
});

describe('seek', () => {
  it('backwards drops later data, forwards brings it back, identical to a straight play', () => {
    const src = new ReplaySource(session(100), { startAt: 100 });
    src.seek(100);
    const full = { n: src.store.count, logs: src.store.logs.length, grabs: src.store.grabs.length, mean: src.store.stats('draw').mean };
    src.seek(42);
    expect(src.store.maxN).toBe(42);
    expect(src.store.logs.every((l) => (l.n ?? 0) <= 42)).toBe(true);
    expect(src.store.grabs.map((g) => g.n)).toEqual([25]);
    expect(Number.isNaN(src.store.value('draw', 43))).toBe(true);
    expect(src.store.trace[0].length).toBe(1);
    src.seek(100);
    expect({ n: src.store.count, logs: src.store.logs.length, grabs: src.store.grabs.length, mean: src.store.stats('draw').mean }).toEqual(full);
  });
  it('clamps to the recording', () => {
    const src = new ReplaySource(session(50), { startAt: 0 });
    src.seek(999); expect(src.store.maxN).toBe(50);
    src.seek(-5); expect(src.store.maxN).toBe(0);
  });
  it('lookups follow the playhead', () => {
    const src = new ReplaySource(session(100), { startAt: 100 }); src.seek(100);
    expect(src.store.grabAt(49)?.n).toBe(25);
    expect(src.store.grabAt(24)).toBeNull();
    expect(src.store.logs[src.store.logIndexAt(35)].msg).toBe('line 30');
    expect(src.store.logIndexAt(0)).toBe(0); // only the loading line
  });
});

describe('gaps shown as gaps', () => {
  it('missing pictures read NaN and are listed, never interpolated', () => {
    const st = new SessionStore();
    st.appendMany(session(20, [5, 6, 7, 15]));
    expect(st.gaps()).toEqual([[5, 7], [15, 15]]);
    expect(Number.isNaN(st.value('draw', 6))).toBe(true);
    expect(st.has(6)).toBe(false);
    expect(st.value('draw', 4)).toBe(5);
    expect(st.count).toBe(16);
    expect(st.stats('draw').n).toBe(16); // stats skip gaps
  });
  it('a gap survives replay seeks', () => {
    const src = new ReplaySource(session(60, [30, 31]), { startAt: 60 }); src.seek(60);
    expect(src.store.gaps()).toEqual([[30, 31]]);
    src.seek(20); expect(src.store.gaps()).toEqual([]);
    src.seek(60); expect(src.store.gaps()).toEqual([[30, 31]]);
  });
  it('the public demo session has its dropped pictures as a gap', () => {
    const recs = parseSession(readFileSync(new URL('../public/demo-session.jsonl', import.meta.url), 'utf8'));
    const st = new SessionStore(); st.appendMany(recs);
    expect(st.gaps()).toEqual([[611, 614]]);
    expect(st.meta?.synthetic).toBe(true);
  });
});

describe('statistics', () => {
  it('mean, worst, over budget and slowest inside the window', () => {
    const st = new SessionStore(); st.appendMany(session(100));
    const s = st.stats('draw', 10);
    expect(s.n).toBe(100); expect(s.over).toBe(10); expect(s.worst).toBe(12); expect(s.at).toBe(10);
    expect(s.mean).toBeCloseTo((90 * 5 + 10 * 12) / 100, 5);
    expect(st.slowest('draw', 3)).toEqual([10, 20, 30]);
  });
});

describe('link loss (simulated in replay)', () => {
  it('stops data at the loss, keeps it, and resumes on retry', () => {
    let t = 0;
    const src = new ReplaySource(session(100), { now: () => t, startAt: 0, lossAt: 40 });
    src.seek(0); src.play();
    for (let k = 0; k < 200; k++) { t += 50; src.tick(t); }
    expect(src.state).toBe('lost');
    expect(src.store.maxN).toBe(40);
    expect(src.info.lostAt).toBe(40);
    src.retryNow(); src.play();
    for (let k = 0; k < 200; k++) { t += 50; src.tick(t); }
    expect(src.state).toBe('replay');
    expect(src.store.maxN).toBe(100);
  });
});
