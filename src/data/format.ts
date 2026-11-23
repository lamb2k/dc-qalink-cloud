// Session file format, version 2: JSON lines, one record per line. See docs/SESSION_FORMAT.md.
// The live stream from the bridge carries the same records, so a recording is the live stream written down.
// Version 2 (dc-qalink v0.2-netdisc): meta.build is the build record and every record may carry `build` (its id);
// `disc` records are the network disc's (mount, open, read). Version 1 files open as before (no build).

export const SESSION_FORMAT = 'dc-qalink.session';
export const SESSION_FORMAT_VERSION = 2;

/** A build: what was pushed and how it ran. The bridge makes one at push; its id is a hash of these fields. */
export interface BuildRecord {
  id: string;
  program: { name: string; sha256: string; bytes: number; commit?: string | null };
  disc: { manifest: string; mode: 'overlay' | 'whole'; files: number; served: number; base?: unknown; overlay?: unknown } | null;
  loader: { build?: string | null; sha8?: string | null; protocol?: number | null } | null;
  args: string;
  tier: string;
  created: string;
  last?: string;
  runs?: string[];
}
/** The network disc: a mount, a file opened, or a read the program made (side `pc` = served, `disc` = GDEMU). */
export interface DiscRecord { t: 'disc'; s?: number; op: 'mount' | 'open' | 'read'; run?: string; path?: string; off?: number; bytes?: number; ms?: number; calls?: number; side?: 'pc' | 'disc'; size?: number; mode?: string; served?: number; files?: number; manifest?: string; build?: string }
export const shortBuild = (b: Pick<BuildRecord, 'id' | 'program'> | null | undefined): string =>
  b ? `${b.program.name} ${b.program.commit ? b.program.commit.slice(0, 7) : b.program.sha256.slice(0, 8)}` : 'no build';

export interface PhaseDef {
  key: string;
  label: string;
  /** budget in the session's unit (ms per picture); 0 or absent: no budget line */
  budget?: number;
  /** chart colour token name, e.g. "--chart-draw" */
  color?: string;
  /** true for the whole-picture total (busy + wait); drawn in its own strip, not stacked */
  total?: boolean;
}
export interface CounterDef { key: string; name: string; group: string; unit?: string; guard: boolean }
export interface ExtraDef { key: string; label: string; group?: string }
export interface OutlineNode { depth: number; icon: string; label: string; value?: string }
export interface DeviceDesc { kind: 'flycast' | 'console'; name: string; transport: 'bba' | 'modem' }

export interface MetaRecord {
  t: 'meta';
  format: typeof SESSION_FORMAT;
  version: number;
  id: string;
  label: string;
  program: { name: string; bytes?: number; hash?: string };
  device: DeviceDesc;
  /** evidence tier for every number in the session, shown beside them */
  tier: string;
  tierDetail?: string;
  source?: string;
  recorded: string;
  /** nominal pictures a second (replay clock and time labels) */
  rate: number;
  units: string;
  phases: PhaseDef[];
  extras?: ExtraDef[];
  /** measured window [first, last]; pictures before it are warm-up */
  window?: [number, number];
  counters?: CounterDef[];
  lanes?: string[];
  outline?: OutlineNode[];
  /** true when the session's numbers and pictures are synthetic (demo data) */
  synthetic?: boolean;
  /** version 2: the build this session ran (absent in version 1 and for programs started on the console) */
  build?: BuildRecord;
}
export interface RowRecord { t: 'row'; n: number; ph: Record<string, number>; f?: number; x?: Record<string, number> }
export interface CounterRecord { t: 'ctr'; n: number; v: Record<string, number> }
export type LogLevel = 'info' | 'warn' | 'err' | 'stub';
export interface LogRecord { t: 'log'; n: number | null; lv: LogLevel; ph?: 'load' | 'play'; msg: string }
export interface TraceRecord { t: 'trace'; lane: string; n: number; d?: number; label: string }
/** A screen grab. kind "reference" marks a picture to compare against (another build, another device); the
 *  console screen shows only console grabs. */
export interface GrabRecord { t: 'grab'; n: number; w: number; h: number; fmt: 'png'; data?: string; url?: string; label?: string; kind?: 'console' | 'reference'; build?: string }
export interface EndRecord { t: 'end'; n: number; reason?: string }

export type SessionRecord = MetaRecord | RowRecord | CounterRecord | LogRecord | TraceRecord | GrabRecord | EndRecord;

export class SessionFormatError extends Error {}

/** Parses a session file. Blank lines are skipped; a bad line throws with its line number. */
export function parseSession(text: string): SessionRecord[] {
  const out: SessionRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s) continue;
    let r: SessionRecord;
    try { r = JSON.parse(s); } catch { throw new SessionFormatError(`line ${i + 1}: not JSON`); }
    if (!r || typeof r !== 'object' || typeof (r as { t?: unknown }).t !== 'string') throw new SessionFormatError(`line ${i + 1}: no record type`);
    if (r.t === 'meta') checkMeta(r, i + 1);
    out.push(r);
  }
  if (!out.length || out[0].t !== 'meta') throw new SessionFormatError('the first record must be meta');
  return out;
}

export function checkMeta(m: MetaRecord, line = 1): void {
  if (m.format !== SESSION_FORMAT) throw new SessionFormatError(`line ${line}: format is ${String(m.format)}, expected ${SESSION_FORMAT}`);
  if (typeof m.version !== 'number' || m.version > SESSION_FORMAT_VERSION) {
    throw new SessionFormatError(`line ${line}: session version ${String(m.version)} is newer than this Studio reads (${SESSION_FORMAT_VERSION})`);
  }
  if (!Array.isArray(m.phases) || !m.phases.length) throw new SessionFormatError(`line ${line}: meta has no phases`);
}

export function toJsonl(records: SessionRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
