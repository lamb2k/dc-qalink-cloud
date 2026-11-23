// Round "console 1" (the first real-console session): what the window opens on, the silent firewall check and the
// rule it would add, no run deadline by default, memory reads not in this version, the header's device, and pictures
// held by a grab left out of the statistics. Nothing here runs an elevated command.
import { describe, expect, it } from 'vitest';
import { launchQuery, probeBridge } from '../desktop/launch.mjs';
import { elevatedRuleCommand, firewallRule, RULE_NAME, ruleCheckCommand } from '../desktop/firewall.mjs';
import { firewallSuspect } from '../src/data/firewall';
import { pushProgram } from '../src/data/bridge-client';
import { LiveSource } from '../src/data/live';
import { MemoryUnsupportedError } from '../src/data/source';
import { SessionStore } from '../src/data/store';
import type { MetaRecord, SessionRecord } from '../src/data/format';

const A = 'http://127.0.0.1:52409';   // never the bridge a person may be running
const LIVE = `src=live&bridge=${encodeURIComponent(A)}`;

describe('launch: live when a bridge answers, the demo only when none does', () => {
  it('a bridge already listening (the app does not start one) opens live', async () => {
    expect(await launchQuery('', { startBridge: false, bridgeAddress: A, capture: false }, async () => true)).toBe('?' + LIVE);
    expect(await launchQuery('?ws=link', { startBridge: false, bridgeAddress: A, capture: false }, async () => true)).toBe('?ws=link&' + LIVE);
  });
  it('control: no bridge answers, the demo replay', async () => {
    expect(await launchQuery('', { startBridge: false, bridgeAddress: A, capture: false }, async () => false)).toBe('');
  });
  it('the app starting its own bridge opens live without asking; a named source and test captures are left alone', async () => {
    let asked = 0; const probe = async () => { asked++; return true; };
    expect(await launchQuery('', { startBridge: true, bridgeAddress: A, capture: false }, probe)).toBe('?' + LIVE);
    expect(await launchQuery('?src=live&bridge=x', { startBridge: false, bridgeAddress: A, capture: false }, probe)).toBe('?src=live&bridge=x');
    expect(await launchQuery('?flow=1', { startBridge: false, bridgeAddress: A, capture: true }, probe)).toBe('?flow=1');
    expect(asked).toBe(0);
  });
  it('the probe asks /v0/status with the contract header and reads a refusal or a timeout as no bridge', async () => {
    const seen: string[] = [];
    const ok = (async (u: string, init: RequestInit) => { seen.push(`${u} ${(init.headers as Record<string, string>)['X-Contract']}`); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    expect(await probeBridge(A + '/', ok)).toBe(true); expect(seen).toEqual([`${A}/v0/status 1`]);
    expect(await probeBridge(A, (async () => { throw new Error('refused'); }) as unknown as typeof fetch)).toBe(false);
    expect(await probeBridge(A, (async () => new Response('', { status: 409 })) as unknown as typeof fetch)).toBe(false);
  });
});

describe('Windows Firewall: the silent drop', () => {
  const base = { connection: 'bba', lanAllowed: true, listeningS: 25, consolesHeard: 0, linkedToConsole: false };
  it('suspected after 20 s of listening with no console heard, over the broadband adapter with the network allowed', () => {
    expect(firewallSuspect(base)).toBe(true);
  });
  it('controls: too early, a console heard, linked, the network not allowed, Flycast or the modem, a rule known', () => {
    expect(firewallSuspect({ ...base, listeningS: 10 })).toBe(false);
    expect(firewallSuspect({ ...base, consolesHeard: 1 })).toBe(false);
    expect(firewallSuspect({ ...base, linkedToConsole: true })).toBe(false);
    expect(firewallSuspect({ ...base, lanAllowed: false })).toBe(false);
    expect(firewallSuspect({ ...base, connection: 'flycast' })).toBe(false);
    expect(firewallSuspect({ ...base, connection: 'modem' })).toBe(false);
    expect(firewallSuspect({ ...base, ruleKnown: true })).toBe(false);
  });
  it('the rule: inbound UDP, Private profile, for that Python only, run elevated through Windows\' own prompt', () => {
    const exe = 'C:\\Tools\\DC QA Link Cloud\\resources\\bridge\\python\\python.exe';
    const rule = firewallRule(exe);
    expect(rule).toContain('-Direction Inbound'); expect(rule).toContain('-Protocol UDP'); expect(rule).toContain('-Profile Private');
    expect(rule).toContain(`-Program '${exe}'`); expect(rule).toContain(RULE_NAME); expect(rule).not.toMatch(/Public|Domain|-Profile Any/);
    const c = elevatedRuleCommand(exe);
    expect(c.file).toBe('powershell.exe'); expect(c.args.join(' ')).toContain('-Verb RunAs');
    const enc = /'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(c.args[3])![1];
    expect(Buffer.from(enc, 'base64').toString('utf16le')).toBe(rule);   // what runs elevated is exactly the rule
    expect(ruleCheckCommand(exe).args.join(' ')).not.toContain('RunAs');  // looking needs no elevation
  });
  it('a quote in the path is escaped; a bare name or a non-exe is refused', () => {
    expect(firewallRule("C:\\O'Brien\\python.exe")).toContain("-Program 'C:\\O''Brien\\python.exe'");
    expect(() => firewallRule('python')).toThrow(/full path/);
    expect(() => firewallRule('C:\\x\\python.bat')).toThrow(/full path/);
  });
});

describe('runs played by hand: no deadline unless one is set', () => {
  async function fields(opts: { deadline_s?: number }): Promise<Record<string, string>> {
    const got: Record<string, string> = {};
    const f = (async (_u: string, init: RequestInit) => {
      for (const [k, v] of (init.body as FormData).entries()) if (typeof v === 'string') got[k] = v;
      return new Response(JSON.stringify({ id: 'r1', program: { name: 'a.elf', sha256: '', bytes: 1 }, args: '', state: 'queued', times: {}, way_back: null, by: 't', queued_at: '', ended_at: null, device: 'd', tier: 'mock', summary: null }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const old = globalThis.fetch; globalThis.fetch = f;
    try { await pushProgram(A, 'a.elf', new Uint8Array([1]), opts); } finally { globalThis.fetch = old; }
    return got;
  }
  it('no deadline field by default; a set deadline is sent', async () => {
    expect('deadline_s' in await fields({})).toBe(false);
    expect((await fields({ deadline_s: 600 })).deadline_s).toBe('600');
  });
});

// a live source on a hand-made stream: hello, then records, then the stream stays open
function sse(records: object[]): typeof fetch {
  return (async (u: string) => {
    if (!u.includes('/v0/live')) return new Response(JSON.stringify({ error: 'memory reads are not in this loader yet' }), { status: 501 });
    const body = new ReadableStream({ start(c) { for (const r of records) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(r)}\n\n`)); } });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}
const meta: MetaRecord = {
  t: 'meta', format: 'dc-qalink.session', version: 1, id: 's1', label: 'sample on Dreamcast', program: { name: 'sample.elf' },
  device: { kind: 'console', name: 'Dreamcast', transport: 'bba' }, tier: 'console', recorded: '2026-11-23', rate: 60, units: 'ms',
  phases: [{ key: 'draw', label: 'Drawing', budget: 8 }, { key: 'frame', label: 'Picture', budget: 16.7, total: true }],
};
const until = async (f: () => boolean, ms = 2000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };

describe('the header follows the device; memory reads not in this version', () => {
  it('"no console heard yet" at connect, then the session and the link name the Dreamcast', async () => {
    const hello = { t: 'hello', contract: 1, bridge: 'b', s: 0, session: null, device: { kind: 'console', name: '', transport: 'bba' }, meta: null, resume_from: 0, link: 'searching' };
    const src = new LiveSource(A, sse([hello, meta, { t: 'link', state: 'up', role: 'program', run: 'r', console_ip: '192.0.2.10', transport: 'adapter' }]));
    await src.start(); await until(() => src.store.meta != null);
    expect(src.info.device).toBe('Dreamcast'); expect(src.info.transport).toBe('Broadband adapter');
    src.stop();
  });
  it('control: a hello with no console and nothing after keeps "no console heard yet"', async () => {
    const hello = { t: 'hello', contract: 1, bridge: 'b', s: 0, session: null, device: { kind: 'console', name: '', transport: 'bba' }, meta: null, resume_from: 0, link: 'searching' };
    const src = new LiveSource(A, sse([hello])); await src.start(); await until(() => src.state === 'linked');
    expect(src.info.device).toMatch(/no console heard yet/); src.stop();
  });
  it('the bridge\'s 501 is "not supported", not an error to pop up', async () => {
    const src = new LiveSource(A, sse([]));
    await expect(src.readMemory(0x8c010000, 16)).rejects.toBeInstanceOf(MemoryUnsupportedError);
    expect(src.memorySupported).toBe(false);
  });
});

describe('pictures held by a grab or a pause', () => {
  const row = (n: number, frame: number): SessionRecord => ({ t: 'row', n, ph: { draw: 1, frame } });
  it('the picture after a resume or a console grab is held and left out of the statistics and the slowest list', () => {
    const st = new SessionStore();
    st.appendMany([meta, row(1, 16.7), row(2, 16.7), { t: 'trace', lane: 'Commands', n: 2, d: 0, label: 'pause ' }, row(3, 16.9),
      { t: 'grab', n: 3, w: 640, h: 480, fmt: 'png', kind: 'console' }, { t: 'trace', lane: 'Commands', n: 3, d: 0, label: 'resume ' }, row(4, 269.9), row(5, 16.7)]);
    expect(st.isHeld(4)).toBe(true); expect(st.isHeld(3)).toBe(false); expect(st.heldCount).toBe(1);
    expect(st.stats('frame').worst).toBeCloseTo(16.9, 1); expect(st.slowest('frame', 1)).toEqual([3]);
    st.truncate(3); expect(st.heldCount).toBe(0);
  });
  it('control: the same slow picture with no grab or pause counts', () => {
    const st = new SessionStore(); st.appendMany([meta, row(1, 16.7), row(2, 269.9), row(3, 16.7)]);
    expect(st.isHeld(2)).toBe(false); expect(st.stats('frame').worst).toBeCloseTo(269.9, 1);
  });
});

describe('the source is a boundary (data/scope.ts)', () => {
  it('each source has its own panel state; a hook swaps it; going back finds the first source\'s own', async () => {
    const { perSource, onSourceChange, sourceChanged, sourceBadge, isDemo } = await import('../src/data/scope');
    const { ReplaySource } = await import('../src/data/source');
    const demo = new ReplaySource([meta], { demo: true, now: () => 0 }); const live = new LiveSource(A, sse([]));
    let list: string[] = [];
    onSourceChange((s) => { list = perSource(s, 'assets', () => (isDemo(s) ? ['torus_checker.gltf'] : [])); });
    sourceChanged(demo); expect(list).toEqual(['torus_checker.gltf']); list.push('dropped.png');
    sourceChanged(live); expect(list).toEqual([]);                                   // nothing carried to the live build
    sourceChanged(demo); expect(list).toEqual(['torus_checker.gltf', 'dropped.png']); // the demo's own, whole
    expect(sourceBadge(demo).text).toBe('Demo'); expect(sourceBadge(new ReplaySource([meta], { label: 'x.jsonl' })).kind).toBe('recording');
    expect(sourceBadge(live).kind).toBe('live');
  });
});
