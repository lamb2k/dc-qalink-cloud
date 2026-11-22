// The MCP tool list proven over the mock bridge: a real MCP client (official SDK, stdio) starts tools/mock-mcp.mjs,
// lists the tools, calls grab_screen, live_summary and push_build, and checks the replies. Controls that must fail:
// a server at level "read" refuses push_build; bad arguments are refused; a tampered list would fail the name check.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCP_TOOLS, toolsFor, checkArgs } from '../src/data/mcp-tools';
import { BRIDGE_API_VERSION } from '../src/data/bridge-api';
import { MCP_BRIDGE_API } from '../src/data/mcp-tools';

const PORT = 5193;
const BR = `http://127.0.0.1:${PORT}`;
const MCP = fileURLToPath(new URL('../tools/mock-mcp.mjs', import.meta.url));
let bridge: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(level: string): Promise<Client> {
  const c = new Client({ name: 'qalink-mcp-test', version: '1.0.0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [MCP, '--bridge', BR, '--level', level, '--who', 'vitest'], stderr: 'ignore' }));
  return c;
}
type Res = { content: { type: string; text?: string; data?: string; mimeType?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

beforeAll(async () => {
  bridge = spawn(process.execPath, [fileURLToPath(new URL('../tools/mock-bridge.mjs', import.meta.url)), '--port', String(PORT)], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BR}/v0/status`)).ok) break; } catch { /* starting */ } await sleep(100); }
  await sleep(1500); // let some pictures arrive
});
afterAll(() => { bridge?.kill(); });

describe('MCP tool list', () => {
  it('is versioned with the bridge API and every input schema is an object', () => {
    expect(MCP_BRIDGE_API.split('.').slice(0, 2)).toEqual(BRIDGE_API_VERSION.split('.').slice(0, 2));
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of MCP_TOOLS) { expect(t.inputSchema.type).toBe('object'); expect(t.outputSchema.type).toBe('object'); expect(t.bridge).toMatch(/\/v0\//); }
    expect(toolsFor('read').every((t) => t.level === 'read')).toBe(true);
    expect(checkArgs(MCP_TOOLS.find((t) => t.name === 'step')!.inputSchema, { count: 0 })).toHaveLength(1);
    expect(checkArgs(MCP_TOOLS.find((t) => t.name === 'warp')!.inputSchema, {})).toEqual(['arguments.preset is required']);
  });

  it('lists the tools and answers grab_screen, live_summary and push_build over stdio', async () => {
    const c = await connect('run');
    try {
      const listed = (await c.listTools()).tools.map((t) => t.name).sort();
      expect(listed).toEqual(MCP_TOOLS.map((t) => t.name).sort());

      const g = (await c.callTool({ name: 'grab_screen', arguments: {} })) as Res;
      expect(g.isError).toBeFalsy();
      const img = g.content.find((x) => x.type === 'image')!;
      expect(img.mimeType).toBe('image/png');
      expect(Buffer.from(img.data!, 'base64').subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(g.structuredContent!.w).toBe(640);
      expect(g.structuredContent!.n as number).toBeGreaterThan(0);

      const s = (await c.callTool({ name: 'live_summary', arguments: {} })) as Res;
      expect(s.isError).toBeFalsy();
      const sum = s.structuredContent as { tier: string; phases: { key: string; budget: number; mean: number }[]; pictures: number };
      expect(sum.phases.map((p) => p.key)).toEqual(['draw', 'logic', 'audio', 'frame']);
      expect(sum.tier).toMatch(/mock/);
      expect(sum.pictures).toBeGreaterThan(0);

      const bytes = Buffer.from('a build for the MCP test\n'.repeat(100));
      const p = (await c.callTool({ name: 'push_build', arguments: { base64: bytes.toString('base64'), name: 'mcp-test.elf' } })) as Res;
      expect(p.isError).toBeFalsy();
      const run = p.structuredContent as { id: string; program: { sha256: string; bytes: number; name: string }; state: string };
      expect(run.program.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(run.program.bytes).toBe(bytes.length);
      expect(run.program.name).toBe('mcp-test.elf');
      expect(run.state).toBe('queued');

      const w = (await c.callTool({ name: 'get_run', arguments: { id: run.id } })) as Res;
      expect((w.structuredContent as { runs: { id: string }[] }).runs[0].id).toBe(run.id);

      const bad = (await c.callTool({ name: 'step', arguments: { count: 'five' } })) as Res;
      expect(bad.isError).toBe(true);
      expect(bad.content[0].text).toMatch(/whole number/);
    } finally { await c.close(); }
  }, 30000);

  it('a read-only server does not offer or accept push_build (control)', async () => {
    const c = await connect('read');
    try {
      const listed = (await c.listTools()).tools.map((t) => t.name);
      expect(listed).not.toContain('push_build');
      expect(listed).not.toContain('grab_screen');
      expect(listed).toContain('live_summary');
      const r = (await c.callTool({ name: 'push_build', arguments: { base64: 'AA==' } })) as Res;
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/no tool "push_build" at permission level "read"/);
    } finally { await c.close(); }
  }, 20000);
});
