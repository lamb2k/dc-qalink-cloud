// The bridge's API: contract 1 of dc-qalink's bridge (dc-qalink docs/BRIDGE_API.md is the source; this file matches it).
// HTTP on 127.0.0.1:52080 (this PC only); paths under /v0/; every JSON answer carries `contract`; a client of another
// contract major is refused with 409. The live stream is Server-Sent Events at /v0/live: session-format records
// (`t` the record type, `s` seconds on the session clock), plus hello and status; a row's event id is its picture, so a
// reconnect (?from=<n>&session=<id>, or Last-Event-ID) resumes with no repeat and a hole stays a gap.
// The bridge speaks the loader's words (link searching/up/lost, run states done/crashed/...); the ui* functions below
// map them to the UI's plain words (Linked, Passed ...). Every number carries its tier: console, flycast or mock.

import type { GrabRecord, MetaRecord, SessionRecord, DeviceDesc } from './format';

export const CONTRACT = 1;
/** kept for the MCP list's version check: contract 1 = tool-list bridge API 1.0 */
export const BRIDGE_API_VERSION = '1.0';
export const BRIDGE_API_PREFIX = '/v0';
export const DEFAULT_BRIDGE_PORT = 52080;

export const ENDPOINTS = {
  /** GET -> C1Status */
  status: '/v0/status',
  /** GET -> C1Device (the one device this bridge owns) */
  device: '/v0/device',
  /** GET -> { devices: C1Device[] } */
  devices: '/v0/devices',
  /** GET (SSE) ?from=<n>&session=<id> */
  live: '/v0/live',
  /** POST CommandRequest -> C1CommandResult; 501 for what the loader or program cannot do yet */
  command: '/v0/command',
  /** POST {timeout_s?} -> C1Still: grab the picture now; GET /v0/stills/<id> the PNG, /v0/stills/<id>.json its fields */
  stills: '/v0/stills',
  still: (id: string) => `/v0/stills/${encodeURIComponent(id)}`,
  /** GET -> { runs: C1Run[] } newest first; POST multipart (program file, sha256, args, deadline_s, files, reset_after_s) -> 202 C1Run */
  runs: '/v0/runs',
  run: (id: string) => `/v0/runs/${encodeURIComponent(id)}`,
  report: (id: string) => `/v0/runs/${encodeURIComponent(id)}/report`,
  serial: (id: string) => `/v0/runs/${encodeURIComponent(id)}/serial`,
  /** POST MemoryReadRequest -> MemoryReadResult (501 in this loader) */
  memoryRead: '/v0/memory/read',
  /** GET -> { sessions: C1Session[] }; GET /v0/sessions/<id> -> the session file (application/x-ndjson) */
  sessions: '/v0/sessions',
  session: (id: string) => `/v0/sessions/${encodeURIComponent(id)}`,
  /** GET ?slowest=<k> -> LiveSummary of the current session */
  summary: '/v0/summary',
  /** GET ?from=&to=&lane=&limit= -> TraceQueryResult */
  trace: '/v0/trace',
  /** GET ?from=&to=&level=&q=&limit= -> LogQueryResult */
  log: '/v0/log',
  /** GET -> GameRegistry (what the running program declared) */
  presets: '/v0/presets',
  /** POST (501 in this loader: live assets are plan L5b) */
  assets: '/v0/assets',
  /** POST {} -> 202 C1Run: push and run the bridge's own test program */
  selftest: '/v0/selftest',
  /** GET -> C1Discovery (loader beacons heard on the local network) */
  discovery: '/v0/discovery',
  /** POST {console_ip} -> C1Status */
  link: '/v0/link',
  /** GET -> the loader disc (application/zip, Content-Disposition names the file) */
  loader: '/v0/loader',
  reset: '/v0/reset',
  power: '/v0/power',
  /** GET -> { builds: BuildRecord[], current }: every build pushed, newest first; GET /v0/builds/<id> one */
  builds: '/v0/builds',
  build: (id: string) => `/v0/builds/${encodeURIComponent(id)}`,
  /** GET -> C1Disc: the network disc's manifest (every file, its side and hash) and its counters */
  disc: '/v0/disc',
  /** GET ?limit= -> { reads: DiscRecord[], total }: the program's reads (file, offset, bytes, ms, side) */
  discReads: '/v0/disc/reads',
  /** GET ?path= -> the file's bytes as the console sees it with the network disc on (overlay first) */
  discFile: (path: string) => `/v0/disc/file?path=${encodeURIComponent(path)}`,
  /** GET -> { plugins: [{name, url}] }: asset decoder plugins from the bridge's --asset-plugins folder (outside any repository) */
  plugins: '/v0/plugins',
} as const;

export type Tier = 'console' | 'flycast' | 'mock';
export type C1Link = 'searching' | 'up' | 'lost' | 'refused';
export type C1RunState = 'queued' | 'sending' | 'running' | 'done' | 'crashed' | 'timeout' | 'reset' | 'lost' | 'refused';

export interface C1Device extends C1ConsoleCard {
  id: string; kind: 'flycast' | 'console'; tier: Tier; name: string; transport: 'adapter' | 'modem';
  address: string | null; console_ip: string | null; link: C1Link; state: string | null;
  loader: { build: string; sha8: string; protocol: number; stub_bytes: number; boot_count: number; pushed: boolean } | null;
  program: { run: string; linked: boolean } | null;
  last_run?: { id: string; state: C1RunState; report_bytes?: number };
  /** what the loader's HELLO says beyond the address (loaders from dc-qalink 456ac57 on; null when it does not) */
  ident?: string | null;
}
/** The console's MAC (its identity for autoconnect), GDEMU slot and version, the stub's record of the last way back. */
export interface C1ConsoleCard {
  mac?: string | null; gdemu_slot?: number | null; gdemu_version?: string | null;
  stub?: { step: number; step_name: string; err: number; gdemu: number; entries: number } | null;
  stub_text?: string | null;
}
export interface C1Status {
  contract: number; bridge: string; link: C1Link; device: C1Device; session: string | null; rate_bps: number;
  mode: 'full' | 'summary'; paused: boolean; n: number; level: 'read' | 'control' | 'run'; tier: Tier;
  queue: string[]; active_run: string | null;
  /** links by itself to a console linked before (or the only one heard); POST /v0/settings {autoconnect} */
  autoconnect?: boolean; remembered?: number;
  /** talks only to a loader on this PC (Flycast); a console on the network is listed, never sent to (--allow-lan off) */
  only_local?: boolean; remote_refused?: number;
  /** the current build's id (the last pushed); the network disc's mode, null when none is served */
  build?: string | null; disc?: 'overlay' | 'whole' | null;
}
export interface C1DiscFile { path: string; size: number; sha256: string; side: 'pc' | 'disc'; source: 'base' | 'overlay'; changed: boolean; new?: boolean; base_sha256?: string | null }
export interface C1Disc {
  mode: 'overlay' | 'whole' | null; files: C1DiscFile[]; sha256?: string; count?: number; served?: number;
  base?: { kind: string; path: string; files: number; volume?: string } | null; overlay?: { kind: string; path: string; files: number } | null;
  stats?: { requests: number; resend_requests: number; bytes: number; request_ms?: { n: number; mean: number; p50: number; p99: number; worst: number }; program_reads?: Record<string, { records: number; bytes: number; ms: number; MBps: number | null }> };
  note?: string;
}
export interface C1Number { label: string; value: number; unit: string; tier: Tier }
export interface C1Summary { exit: number | null; state: C1RunState; seconds: number; pictures: number; numbers: C1Number[]; notes: string[]; tier: Tier; crash?: { event: string; pc: string; pr: string; sp: string } }
export interface C1Run {
  id: string; program: { name: string; sha256: string; bytes: number }; args: string; state: C1RunState;
  times: { push_s?: number; run_s?: number; report_s?: number; total_s?: number }; way_back: string | null; by: string;
  queued_at: string; ended_at: string | null; device: string; tier: Tier; summary: C1Summary | null;
  crash?: { event: string; pc: string; pr: string; sp: string }; error: string | null; stills: string[]; serial_lines: number;
  report?: string | null;
  build?: string | null;
}
export interface C1Still { id: string; run: string; picture: number; width: number; height: number; format: 'rgb565'; crc_ok: boolean; bytes: number; seconds: number; tier: Tier; at: string }
export interface C1Discovery { listening: boolean; port: number; seen: ({ id: string; console_ip: string; address: string; port: number; kind: 'console' | 'flycast'; transport: string; loader: string; beacons: number; last_s_ago: number; chosen: boolean; at: string; ident?: string | null; remembered?: boolean } & C1ConsoleCard)[] }
export interface C1Session { id: string; label: string; device: string; started: string; recorded: string; pictures: number | null; tier: Tier; bytes: number; version?: number; build?: string | null }
export interface C1CommandResult { ok: boolean; id: string; n?: number | null; error?: string | null; rung?: string }

// ---- the live stream
/** First on every live connection: the session being recorded (null before any program linked) and its meta. */
export interface HelloMessage { t: 'hello'; contract: number; bridge: string; s: number; session: string | null; device: C1Device; meta: MetaRecord | null; resume_from: number; link: C1Link }
/** About once a second. */
export interface StatusMessage { t: 'status'; s: number; link: C1Link; rate_bps: number; paused: boolean; n: number; mode: 'full' | 'summary'; session: string | null; active_run: string | null }
/** Run events (session-format record types a format-1 reader may ignore). */
export interface RunEvent { t: 'link' | 'hello' | 'push' | 'verdict' | 'exec' | 'line' | 'file' | 'still' | 'back' | 'reset' | 'disc'; s: number; run?: string; [k: string]: unknown }
export type LiveMessage = HelloMessage | StatusMessage | RunEvent | (SessionRecord & { s?: number });

// ---- the UI's view (plain words), mapped from contract 1
export type LinkState = 'linked' | 'connecting' | 'lost' | 'unlinked';
export function uiLink(l: C1Link, programLinked = true): LinkState { return l === 'up' ? (programLinked ? 'linked' : 'linked') : l === 'lost' ? 'lost' : l === 'refused' ? 'unlinked' : 'connecting'; }

export interface BridgeStatus {
  contract: number;
  bridge: string;
  link: LinkState;
  device: DeviceInfo | null;
  session: string | null;
  rateBps: number;
  mode: 'full' | 'summary';
  tier: Tier;
}
export interface DeviceInfo extends DeviceDesc {
  id: string;
  address: string;
  loader?: string;
  lastSeen?: string;
  quality?: number;
  tier?: Tier;
  /** the adapter MAC (the console's identity), GDEMU slot, and where the stub's last way back stopped */
  mac?: string;
  slot?: number;
  stub?: string;
}
export function uiDevice(d: C1Device | null | undefined): DeviceInfo | null {
  if (!d || !d.address) return null;
  const extra = [d.mac ? `MAC ${d.mac}` : '', d.gdemu_slot ? `slot ${d.gdemu_slot}` : ''].filter(Boolean).join(', ');
  return { id: d.id, kind: d.kind, name: d.name, transport: d.transport === 'modem' ? 'modem' : 'bba', address: d.console_ip ?? d.address,
    loader: d.loader ? `${d.loader.build} (${d.loader.sha8.slice(0, 8)})${extra ? `, ${extra}` : ''}` : undefined, tier: d.tier,
    mac: d.mac ?? undefined, slot: d.gdemu_slot ?? undefined, stub: d.stub_text ?? undefined };
}
export function uiStatus(s: C1Status): BridgeStatus {
  return { contract: s.contract, bridge: s.bridge, link: uiLink(s.link), device: uiDevice(s.device), session: s.session, rateBps: s.rate_bps, mode: s.mode, tier: s.tier };
}

export type CommandRequest =
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'step'; count?: number }
  | { cmd: 'warp'; preset: string }
  | { cmd: 'option'; name: string; value: number | string | boolean }
  | { cmd: 'reset'; level: 'return' | 'watchdog' | 'power' }
  | { cmd: 'pad'; state?: PadState; steps?: PadStep[] };

export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'START', 'UP', 'DOWN', 'LEFT', 'RIGHT'] as const;
export type PadButton = (typeof PAD_BUTTONS)[number];
export interface PadState { buttons: PadButton[]; stick?: [number, number]; lt?: number; rt?: number }
export interface PadStep extends PadState { frames: number }

export interface PhaseSummary { key: string; label: string; budget: number | null; mean: number; p95: number; worst: number; worstAt: number; over: number; tier?: Tier }
export interface LiveSummary {
  session: string; label: string; device: string; tier: string; pictures: number; measured: number; missing: number;
  phases: PhaseSummary[];
  guards: { key: string; name: string; value: number }[];
  slowest: { n: number; total: number; phases: Record<string, number> }[];
}
export interface TraceQueryResult { from: number; to: number; events: { lane: string; n: number; d: number; label: string }[]; truncated: boolean }
export interface LogQueryResult { from: number; to: number; lines: { n: number | null; lv: string; msg: string }[]; truncated: boolean }
export interface WarpPreset { id: string; label: string; group?: string; detail?: string }
export interface TestOption { name: string; label: string; type: 'bool' | 'int' | 'enum'; values?: string[]; min?: number; max?: number; value: number | string | boolean }
export interface PadScript { name: string; text: string }
export interface GameRegistry { program: string; presets: WarpPreset[]; options: TestOption[]; scripts: PadScript[]; linked?: boolean }
export interface AssetResult { name: string; bytes: number; sha256: string; state: 'sent' | 'refused'; reason?: string; ram: number; vram: number }
export interface Discovery { listening: boolean; port: number; seen: { id: string; kind: 'console' | 'flycast'; address: string; transport: 'bba' | 'modem'; loader: string; at: string; chosen?: boolean }[] }
export function uiDiscovery(d: C1Discovery): Discovery {
  return { listening: d.listening, port: d.port, seen: d.seen.map((x) => ({ id: x.id, kind: x.kind, address: x.console_ip || x.address, transport: x.transport === 'modem' ? 'modem' : 'bba', loader: x.loader, at: x.at, chosen: x.chosen })) };
}
export interface CommandResult { ok: boolean; id: string; n?: number; error?: string; notYet?: boolean }

export type GrabResponse = GrabRecord;

/** The UI's run words. done with exit 0 shows as passed; any other ending is failed or crashed. */
export type RunState = 'queued' | 'pushing' | 'running' | 'passed' | 'failed' | 'crashed';
export interface RunReport {
  exit: number | null;
  seconds: number;
  pictures: number;
  numbers: { label: string; value: number; unit: string; tier?: Tier }[];
  tier: string;
  notes: string[];
  crash?: { pc: string; pr: string; symbol: string; source?: { file: string; line: number; text: string[]; at: number } };
}
export interface RunRecord {
  id: string;
  file: string;
  bytes: number;
  sha256: string;
  device: string;
  state: RunState;
  queuedAt: string;
  endedAt?: string;
  by: string;
  report?: RunReport;
  /** the bridge's own word for the state (done, timeout, reset, lost, refused ...) */
  bridgeState?: C1RunState;
  error?: string;
  /** the arguments the program was pushed with (the loader hands them to it) */
  args?: string;
}
export function uiRunState(s: C1RunState, exit: number | null | undefined): RunState {
  switch (s) {
    case 'queued': return 'queued';
    case 'sending': return 'pushing';
    case 'running': return 'running';
    case 'done': return exit === 0 || exit === null || exit === undefined ? 'passed' : 'failed';
    case 'crashed': return 'crashed';
    default: return 'failed';
  }
}
export function uiRun(r: C1Run): RunRecord {
  const sm = r.summary;
  const notes = [...(sm?.notes ?? [])];
  if (r.error) notes.unshift(r.error);
  if (r.state === 'timeout' || r.state === 'reset' || r.state === 'lost' || r.state === 'refused') notes.unshift(`The bridge says: ${r.state}${r.way_back ? `, back through the ${r.way_back}` : ''}.`);
  const report: RunReport | undefined = sm ? { exit: sm.exit, seconds: sm.seconds, pictures: sm.pictures, numbers: sm.numbers, tier: sm.tier, notes, crash: sm.crash ? { pc: sm.crash.pc, pr: sm.crash.pr, symbol: `event ${sm.crash.event}` } : undefined }
    : r.error ? { exit: null, seconds: r.times.run_s ?? 0, pictures: 0, numbers: [], tier: r.tier, notes } : undefined;
  return { id: r.id, file: r.program.name, bytes: r.program.bytes, sha256: r.program.sha256, device: r.device, state: uiRunState(r.state, sm?.exit), queuedAt: r.queued_at, endedAt: r.ended_at ?? undefined, by: r.by, report, bridgeState: r.state, error: r.error ?? undefined, args: r.args ?? '' };
}

export interface MemoryReadRequest { addr: number; len: number }
export interface MemoryReadResult { addr: number; data: string /* base64 */; n: number }

export interface SessionSummary { id: string; label: string; device: string; recorded: string; pictures: number; tier: string; headline?: string; build?: string | null }
export function uiSession(s: C1Session): SessionSummary { return { id: s.id, label: s.label, device: s.device, recorded: s.started || s.recorded, pictures: s.pictures ?? 0, tier: s.tier, build: s.build ?? null }; }

/** The contract major must match. */
export function contractCompatible(theirs: number | string | undefined): boolean { return String(theirs ?? '').split('.')[0] === String(CONTRACT); }
/** major.minor of the MCP list's bridge API version must match. */
export function apiCompatible(theirs: string, ours = BRIDGE_API_VERSION): boolean {
  const a = theirs.split('.'), b = ours.split('.');
  return a[0] === b[0] && a[1] === b[1];
}
