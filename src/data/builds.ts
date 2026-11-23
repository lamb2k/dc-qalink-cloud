// Builds (dc-qalink v0.2-netdisc, lane ql-disc): the workspace's anchor. The bridge makes a build record at every push
// (program hash, name, commit, disc manifest, loader, arguments, tier) and stamps its id on every record it writes;
// a session of format 2 names its build in meta.build. Picking a build opens its newest session, so Link, Performance,
// Capture and Assets follow it; another build's grabs can join the current session as references for Capture's compare.
import { ENDPOINTS, type C1Session } from './bridge-api';
import { parseSession, shortBuild, type BuildRecord, type GrabRecord, type SessionRecord } from './format';

const j = async <T>(url: string): Promise<T> => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return (await r.json()) as T; };
const trim = (b: string) => b.replace(/\/$/, '');

export async function listBuilds(base: string): Promise<{ builds: BuildRecord[]; current: string | null }> {
  return j(trim(base) + ENDPOINTS.builds);
}
/** The newest session that ran this build, or null (session ids start with their time, so the bridge's order holds). */
export async function newestSessionOf(base: string, build: string): Promise<C1Session | null> {
  const { sessions } = await j<{ sessions: C1Session[] }>(trim(base) + ENDPOINTS.sessions);
  return sessions.find((s) => s.build === build) ?? null;
}
export async function sessionRecords(base: string, id: string): Promise<SessionRecord[]> {
  const r = await fetch(trim(base) + ENDPOINTS.session(id)); if (!r.ok) throw new Error(`session ${id}: ${r.status}`);
  return parseSession(await r.text());
}
/** The grabs of a build's newest session as references (kind "reference", labelled with the build), with absolute URLs. */
export async function referenceGrabs(base: string, b: BuildRecord): Promise<GrabRecord[]> {
  const s = await newestSessionOf(base, b.id); if (!s) return [];
  const recs = await sessionRecords(base, s.id);
  return recs.filter((r): r is GrabRecord => r.t === 'grab').map((g) => ({ ...g, kind: 'reference', label: `build ${shortBuild(b)}${g.label ? `, ${g.label}` : ''}`, url: g.url && g.url.startsWith('/') ? trim(base) + g.url : g.url }));
}
export function buildLine(b: BuildRecord): string {
  return `${shortBuild(b)} · ${b.tier}${b.args ? ` · ${b.args}` : ''}${b.disc ? ` · disc ${b.disc.mode} ${b.disc.manifest.slice(0, 8)}` : ''}`;
}
