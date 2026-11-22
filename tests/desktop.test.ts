// The desktop interface's two halves agree, the main process keeps its security settings, and pad scripts parse.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IPC_CHANNELS, IPC_EVENTS } from '../src/platform/desktop';
import { parsePadScript } from '../src/data/padscript';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const preload = read('../desktop/preload.cjs');
const main = read('../desktop/main.mjs');

describe('desktop interface', () => {
  it('the preload uses exactly the declared channels and the main process handles each of them', () => {
    const invoked = [...preload.matchAll(/inv\('([\w:-]+)'/g)].map((m) => m[1]);
    const listened = [...preload.matchAll(/listen\('([\w:-]+)'/g)].map((m) => m[1]);
    expect([...new Set(invoked)].sort()).toEqual([...IPC_CHANNELS].sort());
    expect([...new Set(listened)].sort()).toEqual([...IPC_EVENTS].sort());
    const handled = [...main.matchAll(/(?<!protocol\.)handle\('([\w:-]+)'/g)].map((m) => m[1]);
    expect([...new Set(handled)].sort()).toEqual([...IPC_CHANNELS].sort());
    for (const ev of IPC_EVENTS) expect(main).toContain(`'${ev}'`);
  });
  it('keeps the window locked down', () => {
    for (const s of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true', "setWindowOpenHandler(() => ({ action: 'deny' }))", "script-src 'self'", "default-src 'none'"]) expect(main).toContain(s);
    expect(main).toMatch(/onBeforeRequest\(\(d, cb\) => cb\(\{ cancel: !/); // nothing remote
    expect(main).toMatch(/if \(!u\.startsWith\(`\$\{ORIGIN\}\/`\)\) throw new Error\('refused: not the app page'\)/); // every IPC call checks its sender
    expect(preload).not.toMatch(/exposeInMainWorld\('ipcRenderer'/);
  });
});

describe('pad scripts', () => {
  it('parses steps, sticks and triggers and counts pictures', () => {
    const p = parsePadScript('# test\n60 stick -1 0\n2 A START\n10 -\n5 lt 0.5 rt 1');
    expect(p.errors).toEqual([]);
    expect(p.steps).toHaveLength(4);
    expect(p.steps[0]).toEqual({ frames: 60, buttons: [], stick: [-1, 0] });
    expect(p.steps[1].buttons).toEqual(['A', 'START']);
    expect(p.pictures).toBe(77);
  });
  it('names the line and the problem when wrong', () => {
    expect(parsePadScript('2 A\nfive B').errors[0]).toEqual({ line: 2, msg: 'starts with "five": give the pictures to hold, 1 to 3600' });
    expect(parsePadScript('2 JUMP').errors[0].msg).toMatch(/not a button/);
    expect(parsePadScript('2 stick 2 0').errors[0].msg).toMatch(/-1 to 1/);
  });
});
