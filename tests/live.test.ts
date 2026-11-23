// LiveSource against the mock bridge: link, data, link lost (data kept), reconnect resuming without repeats,
// commands, grab and a pushed build with its hash.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { LiveSource } from '../src/data/live';

const PORT = 5191;
let bridge: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms: number): Promise<void> { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await sleep(50); } }

beforeAll(async () => {
  bridge = spawn(process.execPath, [fileURLToPath(new URL('../tools/mock-bridge.mjs', import.meta.url)), '--port', String(PORT), '--drop-after', '5', '--down', '1'], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/v0/status`)).ok) return; } catch { /* starting */ } await sleep(100); }
  throw new Error('mock bridge did not start');
});
afterAll(() => { bridge?.kill(); });

describe('LiveSource with the mock bridge', () => {
  it('links, loses the link with data kept, and resumes without repeats', async () => {
    const src = new LiveSource(`http://127.0.0.1:${PORT}`);
    const states: string[] = []; src.on('state', () => { if (states[states.length - 1] !== src.state) states.push(src.state); });
    const tick = setInterval(() => src.tick(performance.now()), 50);
    await src.start();
    await until(() => src.state === 'linked', 3000);
    expect(src.store.meta?.label).toBe('Spinning cubes, demo');
    await until(() => src.store.maxN > 10, 3000);
    await until(() => src.state === 'lost', 7000);
    const kept = src.store.maxN;
    expect(kept).toBeGreaterThan(10);
    expect(src.info.lostAt).toBe(kept);
    expect(src.store.count).toBe(kept); // nothing thrown away
    await until(() => src.state === 'linked', 8000); // retry after 4 s
    await until(() => src.store.maxN > kept + 5, 3000);
    // no repeats and no holes across the reconnect: every picture once
    expect(src.store.count).toBe(src.store.maxN);
    expect(src.store.gaps()).toEqual([]);
    expect(states).toEqual(expect.arrayContaining(['connecting', 'linked', 'lost']));
    clearInterval(tick); src.stop();
  }, 20000);

  it('sends commands, grabs and pushes a build with its hash', async () => {
    const src = new LiveSource(`http://127.0.0.1:${PORT}`);
    await src.start(); await until(() => src.state === 'linked', 3000);
    const p = await src.command({ cmd: 'pause' }); expect(p.ok).toBe(true); expect(src.playing).toBe(false);
    const s = await src.command({ cmd: 'step', count: 2 }); expect(s.ok).toBe(true);
    expect((await src.command({ cmd: 'resume' })).ok).toBe(true);
    await sleep(600);
    const g = await src.grab(); expect(g?.t).toBe('grab'); expect(g?.w).toBe(640);
    const bytes = new TextEncoder().encode('example build bytes');
    const run = await src.pushBuild({ name: 'example.elf', bytes });
    expect(run.state).toBe('queued'); expect(run.bytes).toBe(bytes.length);
    expect(run.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const runs = await src.runs(); expect(runs[0].id).toBe(run.id); expect(runs[0].args).toBe('');
    const withArgs = await src.pushBuild({ name: 'example.elf', bytes }, { args: 'level=2 diag=1' });
    expect(withArgs.args).toBe('level=2 diag=1');
    expect((await src.runs()).find((x) => x.id === withArgs.id)?.args).toBe('level=2 diag=1');
    await expect(src.readMemory(0x8c010100, 16)).rejects.toThrow(/not in this loader/); // 501 until plan L5
    src.stop();
  }, 15000);
});
