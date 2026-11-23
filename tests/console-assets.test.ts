// Live assets on the console (lane ql-assets): the calls, the state mapping and the newest-wins scheduler; and, when
// QALINK_DCQALINK_ASSETS names a dc-qalink copy with pc/assets (and Python with numpy), the real bridge on free ports.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drawMs, editorState, grabState, Latest, LIVE_RAM, LIVE_VRAM, toBase64, uploadAsset, uploadPath, viewAsset, type C1AssetView } from '../src/data/console-assets';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('console assets: the calls', () => {
  it('base64 matches Node for large buffers', () => {
    const b = new Uint8Array(100_003); for (let i = 0; i < b.length; i++) b[i] = (i * 131 + 7) & 255;
    expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
  });
  it('posts the asset and the view as docs/ASSETS.md says', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: 'abc', state: 'checked' }), { headers: { 'content-type': 'application/json' } });
    }));
    await uploadAsset('http://b/', 'card.png', new Uint8Array([1, 2, 3]), { format: 'vq' });
    await viewAsset('http://b', '0123456789ab', { yaw: 0.6, pitch: 0.5, dist: 3.1, fov: 0.87 }, { measure: 60 });
    await uploadPath('http://b', 'C:/x/torus.obj');
    expect(calls[0].url).toBe('http://b/v0/assets');
    expect(calls[0].body).toEqual({ name: 'card.png', base64: 'AQID', format: 'vq' });
    expect(calls[1].url).toBe('http://b/v0/assets/0123456789ab/view');
    expect(calls[1].body).toMatchObject({ camera: { yaw: 0.6, pitch: 0.5, dist: 3.1, fov: 0.87 }, start_viewer: true, measure: 60 });
    expect(calls[2].body).toEqual({ path: 'C:/x/torus.obj' });
  });
});

describe('console assets: what the editor shows', () => {
  const view = (over: number, differ: number): C1AssetView => ({ id: 'v', asset: 'a', state: 'live', tier: 'flycast', times: {},
    diff: { pixels: 307200, differ, over, threshold: 8, max: 0, mean_abs: 0, psnr: 99, url: '/d' } });
  it('grab rows: identical, in sync, differs', () => {
    expect(grabState(view(0, 0)).text).toBe('identical');
    expect(grabState(view(0, 12)).text).toBe('in sync');
    expect(grabState(view(5, 12))).toEqual({ cls: 'warn', text: 'differs: 5 px' });
    expect(grabState(undefined).text).toBe('not grabbed');
  });
  it('states map to the editor pills; the budget is the editor\'s rule', () => {
    expect(editorState(undefined)).toBe('checked');
    expect(editorState({ state: 'refused' } as never)).toBe('refused');
    expect(editorState({ state: 'checked' } as never, view(0, 0))).toBe('live');
    expect(editorState({ state: 'checked' } as never, { ...view(0, 0), state: 'refused' })).toBe('refused');
    expect(LIVE_RAM).toBe(16 * 1024 * 1024 / 4); expect(LIVE_VRAM).toBe(8 * 1024 * 1024 / 2);
  });
  it('time to draw is submit plus render', () => {
    expect(drawMs(null)).toBeNull();
    expect(drawMs({ submit_ms: { mean: 1.5, worst: 2 }, render_ms: { mean: 7.5, worst: 10 } } as never)).toEqual({ mean: 9, worst: 12 });
  });
});

describe('console assets: newest camera wins', () => {
  it('a drag of 20 steps runs the first settled wish and the last, never the middle', async () => {
    vi.useFakeTimers();
    const ran: number[] = []; let release: () => void = () => {};
    const q = new Latest<number>((k) => { ran.push(k); return new Promise<void>((r) => { release = r; }); }, 150);
    q.want(0); await vi.advanceTimersByTimeAsync(200);           // starts 0, which stays busy
    for (let i = 1; i <= 20; i++) { q.want(i); await vi.advanceTimersByTimeAsync(20); }
    await vi.advanceTimersByTimeAsync(200);
    release(); await vi.advanceTimersByTimeAsync(10);             // 0 ends: only 20 follows
    release(); await vi.advanceTimersByTimeAsync(10);
    expect(ran).toEqual([0, 20]);
    expect(q.idle).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------- the real bridge (host)
const QL = process.env.QALINK_DCQALINK_ASSETS;
const PY = process.env.QALINK_PYTHON_ASSETS ?? 'python';
describe.skipIf(!QL)('console assets: the real bridge (no console; QALINK_DCQALINK_ASSETS)', () => {
  it('converts generated assets and answers the editor\'s fields; a view without a viewer is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ql-assets-'));
    let p: ChildProcess | null = null;
    try {
      const g = spawnSync(PY, ['-c', `import sys; sys.path.insert(0, r'${QL}\\pc'); from assets import gen; gen.write_all(r'${dir}\\gen')`]);
      expect(g.status).toBe(0);
      p = spawn(PY, [join(QL!, 'pc', 'qalink_bridge.py'), '--port', '52384', '--udp-port', '52394', '--console', '127.0.0.1:52395', '--device', 'mock', '--data', join(dir, 'b'), '--quiet'], { stdio: 'ignore', windowsHide: true });
      const base = 'http://127.0.0.1:52384';
      for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/v0/status')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
      const tex = await uploadPath(base, join(dir, 'gen', 'card_256.png'));
      expect(tex).toMatchObject({ kind: 'texture', state: 'checked', texW: 256, texH: 256, fits: true });
      expect(tex.vram).toBeLessThanOrEqual(LIVE_VRAM);
      const tor = await uploadPath(base, join(dir, 'gen', 'torus.obj'));
      expect(tor).toMatchObject({ kind: 'model', tris: 2304, strips: 24, stripVerts: 2352 });
      expect(tor.textures?.length).toBe(1);
      await expect(viewAsset(base, tor.id, { yaw: 0, pitch: 0, dist: 3.1, fov: 0.87 })).rejects.toThrow(/viewer|no program/);
    } finally {
      if (p?.pid) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
