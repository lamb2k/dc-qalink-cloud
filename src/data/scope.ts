// The source is a hard boundary (owner 2026-11-23: "the workspace doesn't mix demo and active builds session values and
// assets"). Everything a panel keeps about a source (runs, memory reads, presets and command history, assets, the
// disc listing, picture diffs) lives in that source's own scope; a new source starts empty, and going back to a
// source shows only what that source had. Panels with module state register a hook that swaps it on a change.
import type { Source } from './source';

const scopes = new WeakMap<object, Map<string, unknown>>();

/** this source's own value for key, made by init the first time */
export function perSource<T>(src: object, key: string, init: () => T): T {
  let m = scopes.get(src); if (!m) { m = new Map(); scopes.set(src, m); }
  if (!m.has(key)) m.set(key, init());
  return m.get(key) as T;
}

const hooks: ((s: Source) => void)[] = [];
/** run fn whenever the app's source changes (and for the current one when registered after the first change) */
export function onSourceChange(fn: (s: Source) => void): void { hooks.push(fn); if (current) fn(current); }
let current: Source | null = null;
let epoch = 0;
/** the App calls this on every source change; panels' Watch keys include sourceEpoch() so all of them rebuild */
export function sourceChanged(s: Source): void { current = s; epoch++; for (const f of hooks) f(s); }
export function sourceEpoch(): number { return epoch; }

/** what the badge says: the demo, a recording, or live on a device */
export function sourceBadge(s: Source): { kind: 'demo' | 'recording' | 'live' | 'none'; text: string } {
  if (s.kind === 'replay') return (s as { demo?: boolean }).demo ? { kind: 'demo', text: 'Demo' } : { kind: 'recording', text: `Recording${s.info.label ? `: ${s.info.label}` : ''}` };
  if (s.kind === 'live') return { kind: 'live', text: `Live on ${s.info.device || 'the bridge'}` };
  return { kind: 'none', text: 'No source' };
}
/** the demo replay (the bundled example session): the only source that may show example content */
export const isDemo = (s: Source): boolean => s.kind === 'replay' && !!(s as { demo?: boolean }).demo;
