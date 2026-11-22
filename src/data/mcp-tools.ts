// The MCP tool list: the console as tools for any agent (plan 2d). One list, versioned with the bridge API; the
// bridge (Python, dc-qalink) serves exactly this list over stdio and a local HTTP port, QA Link Cloud serves it remotely
// through the job queue, and tools/mock-mcp.mjs serves it over the mock bridge as the reference implementation.
// This file is plain data plus one small argument checker, written in erasable TypeScript so Node can load it as is.
//
// Permission levels: read (data, sessions), control (warp, pause, grab, pad, reset, assets), run (push and run code).
// A server started at a level lists and accepts only the tools at or below it. Every call is logged with who made it.

export const MCP_TOOLS_VERSION = '0.3.0';
/** The bridge contract these tools map onto (dc-qalink docs/BRIDGE_API.md, contract 1; bridge-api.ts BRIDGE_API_VERSION). */
export const MCP_BRIDGE_API = '1.0';

export type McpLevel = 'read' | 'control' | 'run';
export const LEVEL_RANK: Record<McpLevel, number> = { read: 0, control: 1, run: 2 };

export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | JsonSchema;
}
export interface McpToolDef {
  name: string;
  title: string;
  /** what it is for, written for the agent reading the list */
  description: string;
  level: McpLevel;
  /** the bridge API call(s) it maps to */
  bridge: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  /** answers with an image block (PNG) as well as structured content */
  image?: boolean;
}

const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'string', description, ...extra });
const int = (description: string, minimum?: number, maximum?: number): JsonSchema => ({ type: 'integer', description, minimum, maximum });
const num = (description: string): JsonSchema => ({ type: 'number', description });
const anyObj = (description: string): JsonSchema => ({ type: 'object', description });

const status: JsonSchema = obj({ contract: int('bridge contract (1)'), bridge: str('bridge program and version'), link: str('the loader\'s link state', { enum: ['searching', 'up', 'lost', 'refused'] }), device: { description: 'the device this bridge owns: kind, tier, name, transport, address, loader, program' }, session: str('session being recorded'), rate_bps: num('bytes a second from the console'), mode: str('full (adapter) or summary (modem)', { enum: ['full', 'summary'] }), tier: str('where the numbers come from', { enum: ['console', 'flycast', 'mock'] }) }, ['contract', 'link', 'mode', 'tier']);
const report: JsonSchema = obj({ exit: { description: 'exit code (integer), null while running' }, state: str('run state'), seconds: num('run time'), pictures: int('pictures drawn'), tier: str('console, flycast or mock'), numbers: { type: 'array', items: obj({ label: str('name'), value: num('value'), unit: str('unit'), tier: str('tier') }) }, notes: { type: 'array', items: str('note') }, crash: anyObj('crash: event, pc, pr, sp') });
const run: JsonSchema = obj({ id: str('run id (opaque)'), program: obj({ name: str('build file name'), sha256: str('hash of the bytes received'), bytes: int('size') }), args: str('arguments'), state: str('the loader\'s run state', { enum: ['queued', 'sending', 'running', 'done', 'crashed', 'timeout', 'reset', 'lost', 'refused'] }), times: anyObj('seconds: push_s, run_s, report_s, total_s'), way_back: str('stub, watchdog or power'), queued_at: str('ISO time'), ended_at: str('ISO time'), by: str('who sent it'), device: str('device it ran on'), tier: str('console, flycast or mock'), summary: report, crash: anyObj('crash: event, pc, pr, sp'), error: str('why it did not run or come back'), stills: { type: 'array', items: str('still id') }, report: str('the report text (get_run)') }, ['id', 'program', 'state', 'tier']);
const commandResult: JsonSchema = obj({ ok: { type: 'boolean' }, id: str('command id'), n: int('picture the command took effect at'), error: str('why it failed') }, ['ok', 'id']);
const padState: JsonSchema = obj({ buttons: { type: 'array', items: str('button', { enum: ['A', 'B', 'X', 'Y', 'START', 'UP', 'DOWN', 'LEFT', 'RIGHT'] }) }, stick: { type: 'array', items: { type: 'number', minimum: -1, maximum: 1 }, description: 'analogue stick x, y from -1 to 1' }, lt: { type: 'number', minimum: 0, maximum: 1, description: 'left trigger 0..1' }, rt: { type: 'number', minimum: 0, maximum: 1, description: 'right trigger 0..1' } }, ['buttons']);
const win: Record<string, JsonSchema> = { from: int('first picture (default 0)', 0), to: int('last picture (default: newest)', 0), limit: int('most items to return (default 500)', 1, 5000) };

const TOOLS: McpToolDef[] = [
  { name: 'link_status', title: 'Link status', level: 'read', bridge: 'GET /v0/status',
    description: 'Is a Dreamcast or Flycast linked, which one, over what (broadband adapter or modem), and which session is recording. Call this first.',
    inputSchema: obj({}), outputSchema: status },
  { name: 'list_devices', title: 'List devices', level: 'read', bridge: 'GET /v0/devices, GET /v0/discovery',
    description: 'Devices the bridge knows: Flycast on this PC and consoles whose loader it has heard, with address and loader version.',
    inputSchema: obj({}), outputSchema: obj({ devices: { type: 'array', items: anyObj('device: id, kind, tier, name, transport, address, loader') }, discovery: { type: 'array', items: anyObj('a loader heard: address, kind, beacons, chosen') } }, ['devices']) },
  { name: 'push_build', title: 'Push a build', level: 'run', bridge: 'POST /v0/runs',
    description: 'Send a program (ELF or BIN) to the linked device and start it. Give a file path on the bridge\'s PC or the bytes as base64. The bridge checks the hash on receipt. Returns the queued run; use get_run or run_and_wait for its report.',
    inputSchema: obj({ path: str('path of the build on the bridge\'s PC (local MCP only)'), base64: str('the build bytes, base64'), name: str('file name to show (default: from the path)'), device: str('device kind to run on', { enum: ['flycast', 'console'] }) }),
    outputSchema: run },
  { name: 'run_and_wait', title: 'Run and wait for the report', level: 'run', bridge: 'POST /v0/runs, then GET /v0/runs/<id> until it ends',
    description: 'Push a build, run it, and wait until it ends or the time limit passes. Returns the run with its report (exit, seconds, pictures, numbers with their tier, notes, crash with source lines).',
    inputSchema: obj({ path: str('path of the build on the bridge\'s PC'), base64: str('the build bytes, base64'), name: str('file name to show'), device: str('device kind', { enum: ['flycast', 'console'] }), timeout_s: int('seconds to wait (default 60)', 1, 900) }),
    outputSchema: run },
  { name: 'get_run', title: 'Get a run', level: 'read', bridge: 'GET /v0/runs/<id> (or GET /v0/runs for the list)',
    description: 'One run with its report, or the list of runs newest first when no id is given.',
    inputSchema: obj({ id: str('run id; omit for the list') }), outputSchema: obj({ runs: { type: 'array', items: run } }, ['runs']) },
  { name: 'self_test', title: 'Run the self test', level: 'run', bridge: 'POST /v0/selftest',
    description: 'Push and run the bridge\'s own small test program to prove the link end to end; wait for its report.',
    inputSchema: obj({ timeout_s: int('seconds to wait (default 30)', 1, 300) }), outputSchema: run },
  { name: 'grab_screen', title: 'Grab the screen', level: 'control', bridge: 'POST /v0/stills, then GET /v0/stills/<id>', image: true,
    description: 'The picture on the console now, as a PNG image (640x480 unless the program sets another mode), with the picture number it was taken at.',
    inputSchema: obj({}), outputSchema: obj({ n: int('picture number'), w: int('width'), h: int('height'), label: str('what it is'), bytes: int('PNG size'), id: str('still id'), tier: str('console, flycast or mock') }, ['n', 'w', 'h']) },
  { name: 'live_summary', title: 'Live summary', level: 'read', bridge: 'GET /v0/summary',
    description: 'Time per phase against its budget (mean, p95, worst and where, pictures over budget) over the measured window, guards that should read 0, pictures missing, and the tier of the numbers.',
    inputSchema: obj({}), outputSchema: obj({ session: str('session id'), label: str('session label'), device: str('device'), tier: str('what kind of numbers these are'), pictures: int('pictures so far'), measured: int('pictures in the measured window'), missing: int('pictures never received (gaps)'), phases: { type: 'array', items: anyObj('phase: key, label, budget, mean, p95, worst, worstAt, over') }, guards: { type: 'array', items: anyObj('guard: key, name, value') } }, ['session', 'tier', 'phases']) },
  { name: 'slowest_pictures', title: 'Slowest pictures', level: 'read', bridge: 'GET /v0/summary?slowest=<count>',
    description: 'The slowest pictures in the measured window by busy time (the sum of the phases), with each phase\'s time.',
    inputSchema: obj({ count: int('how many (default 10)', 1, 50) }), outputSchema: obj({ tier: str('tier'), slowest: { type: 'array', items: anyObj('picture: n, total, phases') } }, ['slowest']) },
  { name: 'query_trace', title: 'Query the trace', level: 'read', bridge: 'GET /v0/trace',
    description: 'Trace events (pad script steps, scenes, loads, sound) in a picture range, optionally one lane.',
    inputSchema: obj({ ...win, lane: str('lane name, e.g. "Loads"') }), outputSchema: obj({ from: int('from'), to: int('to'), events: { type: 'array', items: anyObj('event: lane, n, d, label') }, truncated: { type: 'boolean' } }, ['events']) },
  { name: 'read_log', title: 'Read the log', level: 'read', bridge: 'GET /v0/log',
    description: 'The program\'s log lines in a picture range, filtered by level or text; the newest lines when over the limit.',
    inputSchema: obj({ ...win, level: str('only this level ("warn" includes errors)', { enum: ['info', 'warn', 'err', 'stub'] }), q: str('text to find') }),
    outputSchema: obj({ from: int('from'), to: int('to'), lines: { type: 'array', items: anyObj('line: n, lv, msg') }, truncated: { type: 'boolean' } }, ['lines']) },
  { name: 'list_presets', title: 'List warp presets and test options', level: 'read', bridge: 'GET /v0/presets',
    description: 'Warp presets, test options and pad scripts the running program registered with the link.',
    inputSchema: obj({}), outputSchema: obj({ program: str('program'), presets: { type: 'array', items: anyObj('preset: id, label, group, detail') }, options: { type: 'array', items: anyObj('option: name, label, type, values, value') }, scripts: { type: 'array', items: anyObj('pad script: name, text') } }, ['presets', 'options']) },
  { name: 'warp', title: 'Warp', level: 'control', bridge: 'POST /v0/command {cmd: warp}',
    description: 'Move the running program to a preset it registered (see list_presets).',
    inputSchema: obj({ preset: str('preset id') }, ['preset']), outputSchema: commandResult },
  { name: 'pause', title: 'Pause', level: 'control', bridge: 'POST /v0/command {cmd: pause}',
    description: 'Pause the program at the end of the current picture.', inputSchema: obj({}), outputSchema: commandResult },
  { name: 'resume', title: 'Resume', level: 'control', bridge: 'POST /v0/command {cmd: resume}',
    description: 'Resume after a pause or steps.', inputSchema: obj({}), outputSchema: commandResult },
  { name: 'step', title: 'Step pictures', level: 'control', bridge: 'POST /v0/command {cmd: step}',
    description: 'Run a number of pictures and pause again.', inputSchema: obj({ count: int('pictures (default 1)', 1, 600) }), outputSchema: commandResult },
  { name: 'set_option', title: 'Set a test option', level: 'control', bridge: 'POST /v0/command {cmd: option}',
    description: 'Change a test option the program registered (see list_presets).',
    inputSchema: obj({ name: str('option name'), value: { description: 'new value: boolean, integer or one of its values' } as JsonSchema }, ['name', 'value']), outputSchema: commandResult },
  { name: 'send_pad', title: 'Send pad input', level: 'control', bridge: 'POST /v0/command {cmd: pad}',
    description: 'Hold buttons, the stick and triggers until the next pad call (state), or play a pad script of steps, each held for a number of pictures (steps).',
    inputSchema: obj({ state: padState, steps: { type: 'array', items: { ...padState, properties: { ...padState.properties, frames: int('pictures to hold this step', 1, 3600) }, required: ['buttons', 'frames'] } } }),
    outputSchema: commandResult },
  { name: 'reset', title: 'Reset', level: 'control', bridge: 'POST /v0/command {cmd: reset}',
    description: 'Bring the device back to the loader: "return" asks the program, "watchdog" forces it, "power" uses the smart plug if one is set up.',
    inputSchema: obj({ level: str('reset ladder step', { enum: ['return', 'watchdog', 'power'] }) }, ['level']), outputSchema: commandResult },
  { name: 'read_memory', title: 'Read memory', level: 'read', bridge: 'POST /v0/memory/read',
    description: 'Read up to 64 KB of the console\'s memory at an address (hex). Returns base64 bytes and the picture they were read at.',
    inputSchema: obj({ addr: str('address in hex, e.g. "8C010000"', { pattern: '^(0x)?[0-9A-Fa-f]+$' }), len: int('bytes', 1, 65536) }, ['addr', 'len']),
    outputSchema: obj({ addr: int('address'), data: str('base64'), n: int('picture') }, ['addr', 'data', 'n']) },
  { name: 'upload_asset', title: 'Upload an asset', level: 'control', bridge: 'POST /v0/assets',
    description: 'Send a texture (PNG) or model (OBJ) to the console\'s live-asset block; it is checked against the console budget first and refused with the reason when over.',
    inputSchema: obj({ path: str('path on the bridge\'s PC'), base64: str('the bytes, base64'), name: str('file name') }),
    outputSchema: obj({ name: str('name'), bytes: int('size'), sha256: str('hash'), state: str('sent or refused', { enum: ['sent', 'refused'] }), reason: str('why'), ram: int('main memory bytes'), vram: int('graphics memory bytes') }, ['name', 'state']) },
  { name: 'list_sessions', title: 'List sessions', level: 'read', bridge: 'GET /v0/sessions',
    description: 'Recorded sessions: id, label, device, when, pictures, tier.',
    inputSchema: obj({}), outputSchema: obj({ sessions: { type: 'array', items: anyObj('session summary') } }, ['sessions']) },
  { name: 'export_session', title: 'Export a session', level: 'read', bridge: 'GET /v0/sessions/<id>',
    description: 'A session as its file (JSON lines, session format 1). Large sessions are cut at max_bytes and say so.',
    inputSchema: obj({ id: str('session id'), max_bytes: int('most bytes to return (default 1,000,000)', 1000, 20000000) }, ['id']),
    outputSchema: obj({ id: str('id'), bytes: int('full size'), truncated: { type: 'boolean' }, text: str('the session file') }, ['id', 'text', 'truncated']) },
];

/** outputs may carry more fields than listed (a newer bridge adds, never removes) */
function loose(s: JsonSchema): JsonSchema {
  const o: JsonSchema = { ...s }; delete o.additionalProperties;
  if (o.properties) o.properties = Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, loose(v)]));
  if (o.items) o.items = loose(o.items);
  return o;
}
export const MCP_TOOLS: McpToolDef[] = TOOLS.map((t) => ({ ...t, outputSchema: loose(t.outputSchema) }));

/** Tools a server at this level offers. */
export function toolsFor(level: McpLevel): McpToolDef[] { return MCP_TOOLS.filter((t) => LEVEL_RANK[t.level] <= LEVEL_RANK[level]); }

/** Checks arguments against a tool's input schema (the subset used above). Returns the problems, empty when valid. */
export function checkArgs(schema: JsonSchema, v: unknown, at = 'arguments'): string[] {
  const out: string[] = [];
  if (schema.type === undefined) return out;
  const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
  if (schema.type === 'integer') { if (typeof v !== 'number' || !Number.isInteger(v)) return [`${at} must be a whole number`]; }
  else if (schema.type === 'number') { if (typeof v !== 'number' || !Number.isFinite(v)) return [`${at} must be a number`]; }
  else if (schema.type !== t) return [`${at} must be ${schema.type === 'object' ? 'an object' : `a ${schema.type}`}`];
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum) out.push(`${at} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && v > schema.maximum) out.push(`${at} must be at most ${schema.maximum}`);
  }
  if (typeof v === 'string') {
    if (schema.maxLength !== undefined && v.length > schema.maxLength) out.push(`${at} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) out.push(`${at} is not in the expected form`);
  }
  if (schema.enum && !schema.enum.includes(v as string)) out.push(`${at} must be one of ${schema.enum.join(', ')}`);
  if (schema.type === 'array' && Array.isArray(v) && schema.items) v.forEach((x, i) => out.push(...checkArgs(schema.items!, x, `${at}[${i}]`)));
  if (schema.type === 'object' && v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in o)) out.push(`${at}.${r} is required`);
    for (const [k, x] of Object.entries(o)) {
      const p = schema.properties?.[k];
      if (!p) { if (schema.additionalProperties === false) out.push(`${at}.${k} is not a known input`); continue; }
      out.push(...checkArgs(p, x, `${at}.${k}`));
    }
  }
  return out;
}
