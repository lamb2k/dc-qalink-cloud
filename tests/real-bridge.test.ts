// The app's data layer against dc-qalink's real bridge (contract 1) with its simulated console (tests/rig.py: a bridge
// and a console on free ports on this PC; numbers carry tier "mock"). Skipped when no dc-qalink checkout is named:
// QALINK_DCQALINK=<dc-qalink> (and QALINK_PYTHON, default "python").
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveSource } from '../src/data/live';
import { bget, discovery, getRun, registry } from '../src/data/bridge-client';
import { ENDPOINTS, type LiveSummary } from '../src/data/bridge-api';

const DIR = process.env.QALINK_DCQALINK ?? '';
const RIG = join(DIR, 'tests', 'rig.py');
const have = !!DIR && existsSync(RIG);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean | Promise<boolean>, ms: number): Promise<void> { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return; await sleep(100); } throw new Error('timed out'); }

describe.skipIf(!have)('the app on the real bridge (simulated console)', () => {
  let proc: ChildProcess; let base = '';
  beforeAll(async () => {
    proc = spawn(process.env.QALINK_PYTHON ?? 'python', ['-I', RIG, '--out', join(DIR, '..', 'ev', 'app-rig')], { stdio: ['pipe', 'pipe', 'inherit'] });
    base = await new Promise<string>((res, rej) => { proc.stdout!.on('data', (b: Buffer) => { const m = /bridge (http\S+)/.exec(b.toString()); if (m) res(m[1]); }); proc.on('exit', () => rej(new Error('rig ended'))); });
  }, 30000);
  afterAll(() => { proc?.stdin?.end(); });

  it('links, sees the loader, pushes a build, gets live rows, a grab, commands and the report', async () => {
    const d = await discovery(base);
    expect(d.seen.length).toBe(1); expect(d.seen[0].chosen).toBe(true);
    const src = new LiveSource(base);
    await src.start(); await until(() => src.state === 'linked', 5000);
    const bytes = new TextEncoder().encode('a raw image for the simulated console\n'.repeat(1000));
    const run = await src.pushBuild({ name: 'sim.bin', bytes });
    expect(run.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(['queued', 'pushing']).toContain(run.state);
    await until(() => src.store.maxN > 40, 20000);                       // rows arrive on the stream
    expect(src.store.meta?.phases.map((p) => p.key)).toEqual(['draw', 'logic', 'wait', 'frame']);
    expect(src.store.meta?.tier).toBe('mock');
    const g = await src.grab(); expect(g?.w).toBe(160); expect(g?.data?.length).toBeGreaterThan(100);
    const p = await src.command({ cmd: 'pause' }); expect(p.ok).toBe(true);
    const w = await src.command({ cmd: 'warp', preset: 'nowhere' }); expect(w.ok).toBe(false); // control: unknown preset
    expect((await src.command({ cmd: 'resume' })).ok).toBe(true);
    const reg = await registry(base); expect(reg.presets.map((x) => x.id)).toEqual(['start', 'burst']);
    const sum = await bget<LiveSummary>(base, ENDPOINTS.summary); expect(sum.tier).toBe('mock'); expect(sum.missing).toBe(0);
    let r = await getRun(base, run.id);
    await until(async () => { r = await getRun(base, run.id); return !['queued', 'pushing', 'running'].includes(r.state); }, 40000);
    expect(r.state).toBe('passed'); expect(r.report?.tier).toBe('mock'); expect(r.report?.pictures).toBeGreaterThan(60);
    expect(src.events.some((e) => e.t === 'verdict')).toBe(true);
    src.stop();
  }, 90000);
});
