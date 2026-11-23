// Plain calls to a bridge by address (contract 1), for pages that talk to it outside the live stream (setup, settings,
// commands, sessions). Every call sends X-Contract so a bridge of another contract answers 409, shown as "bridge too
// old or too new".
import { CONTRACT, ENDPOINTS, uiDiscovery, uiRun, type C1CommandResult, type C1Discovery, type C1Run, type CommandRequest, type CommandResult, type Discovery, type GameRegistry, type RunRecord } from './bridge-api';
import { sha256Hex } from './source';

export const DEFAULT_BRIDGE = 'http://127.0.0.1:52080';
const join = (base: string, path: string) => base.replace(/\/$/, '') + path;
const H = { 'X-Contract': String(CONTRACT) };

async function answer<T>(r: Response): Promise<T> {
  const v = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (r.status === 409 && /contract/.test(JSON.stringify(v))) throw new Error(`the bridge speaks another contract (${(v as { ours?: number })?.ours ?? '?'}); this app speaks ${CONTRACT}: update one of them`);
  if (!r.ok) throw Object.assign(new Error(typeof v === 'object' && v && 'error' in v ? String((v as { error: string }).error) : `bridge answered ${r.status}`), { status: r.status });
  return v as T;
}
export async function bget<T>(base: string, path: string, ms = 4000): Promise<T> {
  return answer<T>(await fetch(join(base, path), { headers: H, signal: AbortSignal.timeout(ms) }));
}
export async function bpost<T>(base: string, path: string, body: unknown = {}, ms = 8000): Promise<T> {
  return answer<T>(await fetch(join(base, path), { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }));
}
export async function bbytes(base: string, path: string): Promise<{ name: string; bytes: Uint8Array }> {
  const r = await fetch(join(base, path), { headers: H, signal: AbortSignal.timeout(20000) });
  if (!r.ok) { let e = `bridge answered ${r.status}`; try { e = (await r.json()).error ?? e; } catch { /* not json */ } throw new Error(e); }
  const cd = r.headers.get('content-disposition') ?? ''; const m = cd.match(/filename="([^"]+)"/);
  return { name: m?.[1] ?? 'download.bin', bytes: new Uint8Array(await r.arrayBuffer()) };
}
/** Push a build: multipart with the program and its sha256 (the bridge refuses a mismatch). */
export async function pushProgram(base: string, name: string, bytes: Uint8Array, opts: { args?: string; deadline_s?: number; files?: string } = {}): Promise<RunRecord> {
  const fd = new FormData();
  fd.append('sha256', await sha256Hex(bytes));
  fd.append('name', name);
  if (opts.args) fd.append('args', opts.args);
  if (opts.deadline_s) fd.append('deadline_s', String(opts.deadline_s));
  if (opts.files) fd.append('files', opts.files);
  fd.append('program', new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), name);
  const r = await answer<C1Run>(await fetch(join(base, ENDPOINTS.runs), { method: 'POST', headers: H, body: fd, signal: AbortSignal.timeout(30000) }));
  return uiRun(r);
}
export const getRun = async (base: string, id: string): Promise<RunRecord> => uiRun(await bget<C1Run>(base, ENDPOINTS.run(id)));
export const listRuns = async (base: string): Promise<RunRecord[]> => (await bget<{ runs: C1Run[] }>(base, ENDPOINTS.runs)).runs.map(uiRun);
export const discovery = async (base: string, ms = 1500): Promise<Discovery> => uiDiscovery(await bget<C1Discovery>(base, ENDPOINTS.discovery, ms));
export async function sendCommand(base: string, c: CommandRequest): Promise<CommandResult> {
  const r = await fetch(join(base, ENDPOINTS.command), { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(c), signal: AbortSignal.timeout(45000) });
  const v = (await r.json()) as C1CommandResult & { error?: string };
  return { ok: !!v.ok, id: v.id ?? '', n: v.n ?? undefined, error: v.error ?? undefined, notYet: r.status === 501 };
}
export const registry = (base: string): Promise<GameRegistry> => bget<GameRegistry>(base, ENDPOINTS.presets);
