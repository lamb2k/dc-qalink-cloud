// Sessions: every recording this app can reach (the built-in demos, files opened, the bridge's recordings when linked),
// opened for replay, compared two at a time (phases side by side with the difference, one chart on one axis), exported
// as one file.
import type { App } from '../ui/app';
import { ENDPOINTS, uiSession, type C1Session, type SessionSummary } from '../data/bridge-api';
import { bget } from '../data/bridge-client';
import { parseSession, type SessionRecord } from '../data/format';
import { ReplaySource } from '../data/source';
import { SessionStore } from '../data/store';
import { desktop } from '../platform/desktop';
import { download, esc, fitCanvas, fmt, h, iconSvg, int, num, tok } from '../ui/dom';
import { btn, empty } from '../editors/base';
import type { Page } from './page';

interface Entry { id: string; label: string; program: string; device: string; recorded: string; pictures: number; mean: number; tier: string; from: 'Built in' | 'File' | 'Bridge'; load(): Promise<string>; text?: string; store?: SessionStore; name: string }
const opened: Entry[] = [];
let builtins: Entry[] | null = null;

function summarize(e: Entry, text: string): Entry {
  const recs: SessionRecord[] = parseSession(text); const st = new SessionStore(); st.appendMany(recs);
  const m = st.meta!; const tot = st.totalKey(); const ph = st.phases.find((p) => p.key === tot);
  return Object.assign(e, { text, store: st, label: m.label, program: m.program.name, device: m.device.name, recorded: m.recorded, pictures: st.maxN, mean: ph ? st.stats(tot, ph.budget ?? 0).mean : NaN, tier: m.tier });
}
async function loadBuiltins(): Promise<Entry[]> {
  const mk = (file: string): Entry => ({ id: `builtin:${file}`, name: file, label: file, program: '', device: '', recorded: '', pictures: 0, mean: NaN, tier: '', from: 'Built in', load: async () => (await fetch(`${import.meta.env.BASE_URL}${file}`)).text() });
  const list = [mk('demo-session.jsonl'), mk('demo-long.jsonl')];
  for (const e of list) summarize(e, await e.load());
  return list;
}

export class SessionsPage implements Page {
  el = h('div', { class: 'page' });
  private sel: string[] = [];
  private bridge: Entry[] = []; private bridgeFor = ''; private v = 0; private built = '';
  private chart = h('canvas', { class: 'cmp-chart', 'aria-label': 'Picture time of both sessions on one axis' });
  constructor(private app: App) {
    if (!builtins) void loadBuiltins().then((b) => { builtins = b; this.v++; }).catch((e) => app.toast('err', 'Could not read the demo recordings', String(e)));
    new ResizeObserver(() => { this.v++; }).observe(this.chart);
  }
  private all(): Entry[] { return [...opened, ...this.bridge, ...(builtins ?? [])]; }
  private async refreshBridge(): Promise<void> {
    const key = `${this.app.source.kind}|${this.app.source.state}`; if (key === this.bridgeFor) return; this.bridgeFor = key;
    if (!(this.app.source.kind === 'live' && this.app.source.state === 'linked')) { this.bridge = []; this.v++; return; }
    try {
      const base = this.app.bridgeUrl; const list: SessionSummary[] = (await bget<{ sessions: C1Session[] }>(base, ENDPOINTS.sessions)).sessions.map(uiSession);
      this.bridge = list.map((s) => ({ id: `bridge:${s.id}`, name: `${s.id}.jsonl`, label: s.label, program: '', device: s.device, recorded: s.recorded, pictures: s.pictures, mean: NaN, tier: s.tier, from: 'Bridge', load: async () => (await fetch(base.replace(/\/$/, '') + ENDPOINTS.session(s.id))).text() }));
      this.v++;
    } catch (e) { this.app.toast('warn', 'The bridge did not list its sessions', String(e)); }
  }
  private async openFiles(): Promise<void> {
    const q = desktop();
    const add = (name: string, text: string) => { try { const e = summarize({ id: `file:${name}:${opened.length}`, name, label: name, program: '', device: '', recorded: '', pictures: 0, mean: NaN, tier: '', from: 'File', load: async () => text }, text); opened.unshift(e); this.v++; } catch (err) { this.app.toast('err', `${name} is not a session file`, String(err)); } };
    if (q) { for (const f of await q.openFiles('session', true)) add(f.name, new TextDecoder().decode(f.bytes)); return; }
    const i = h('input', { type: 'file', accept: '.jsonl,.ndjson', multiple: true, class: 'sr-only' }); document.body.append(i);
    i.addEventListener('change', async () => { for (const f of i.files ?? []) add(f.name, await f.text()); i.remove(); }); i.click();
  }
  private async ensure(e: Entry): Promise<Entry> { if (!e.store) summarize(e, await e.load()); return e; }
  private async open(e: Entry): Promise<void> {
    try { await this.ensure(e); await this.app.setSource(new ReplaySource(parseSession(e.text!), { label: e.label })); this.app.setWorkspace('link'); this.app.toast('ok', `Opened ${e.label}`, 'Replaying in the Link workspace.'); }
    catch (err) { this.app.toast('err', `Could not open ${e.label}`, String(err)); }
  }
  private async export(e: Entry): Promise<void> { try { await this.ensure(e); download(e.name.endsWith('.jsonl') ? e.name : `${e.name}.jsonl`, new Blob([e.text!], { type: 'application/x-ndjson' })); } catch (err) { this.app.toast('err', 'Export failed', String(err)); } }
  private toggle(id: string): void { this.sel = this.sel.includes(id) ? this.sel.filter((x) => x !== id) : [...this.sel, id].slice(-2); this.v++; void Promise.all(this.sel.map((s) => { const e = this.all().find((x) => x.id === s); return e ? this.ensure(e) : null; })).then(() => { this.v++; }); }
  select(ids: string[]): void { this.sel = ids.slice(0, 2); this.v++; } // for tests and pictures

  frame(): void {
    void this.refreshBridge();
    const k = `${this.v}|${this.app.themeV}|${this.sel.join(',')}`; if (k === this.built) return; this.built = k;
    const all = this.all();
    const head = h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Recordings'), h('h1', null, 'Sessions'), h('p', null, 'Every recording this app can reach. Open one to replay it, tick two to compare them, export one as a file.')),
      h('div', { class: 'actions' }, btn('Open a session file', () => void this.openFiles(), { icon: 'folder-open', kbd: 'Ctrl O' })));
    const t = h('table', { class: 'table' });
    t.innerHTML = '<thead><tr><th class="chk"><span class="sr-only">Compare</span></th><th>Session</th><th>Where</th><th>Device</th><th>Recorded</th><th class="num">Pictures</th><th class="num">Mean picture ms</th><th>Tier</th><th></th></tr></thead>';
    const tb = h('tbody');
    for (const e of all) {
      const cb = h('input', { type: 'checkbox', 'aria-label': `Compare ${e.label}`, checked: this.sel.includes(e.id) }); cb.addEventListener('change', () => this.toggle(e.id));
      const tr = h('tr', { class: this.sel.includes(e.id) ? 'is-selected' : '' });
      tr.append(h('td', { class: 'chk' }, cb));
      tr.insertAdjacentHTML('beforeend', `<td><span class="ellipsis strong" title="${esc(e.label)}">${esc(e.label)}</span><div class="faint mono" style="font-size:var(--fs-xs)">${esc(e.name)}</div></td><td><span class="pill${e.from === 'Bridge' ? ' ok' : e.from === 'File' ? ' info' : ''}">${e.from}</span></td><td class="muted">${esc(e.device || '-')}</td><td class="mono muted">${esc(e.recorded.slice(0, 16).replace('T', ' ') || '-')}</td><td class="num">${e.pictures ? int(e.pictures) : '-'}</td><td class="num">${fmt(e.mean)}</td><td class="muted"><span class="ellipsis" title="${esc(e.tier)}">${esc(e.tier || '-')}</span></td>`);
      tr.append(h('td', null, h('span', { class: 'row-actions' }, btn('Open', () => void this.open(e), { small: true, icon: 'play' }), btn('Export', () => void this.export(e), { small: true, ghost: true, icon: 'download' }))));
      tb.append(tr);
    }
    t.append(tb);
    const list = h('section', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('history') }, h('h2', null, 'All sessions'), h('span', { class: 'meta' }, `${all.length} sessions${this.bridge.length ? `, ${this.bridge.length} on the bridge` : this.app.source.kind === 'live' ? '' : ', bridge not linked'}`)),
      h('div', { class: 'card-body flush scroll' }, all.length ? t : empty('history', 'Reading the recordings', 'The demo recordings load first.')));
    this.el.replaceChildren(head, list, this.compare());
  }

  private compare(): HTMLElement {
    const [a, b] = this.sel.map((id) => this.all().find((x) => x.id === id)).filter(Boolean) as Entry[];
    const card = h('section', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('git-compare') }, h('h2', null, 'Compare'), h('span', { class: 'meta' }, a && b ? `${a.label}  vs  ${b.label}` : `${this.sel.length} of 2 ticked`)));
    if (!a || !b || !a.store || !b.store) { card.append(h('div', { class: 'card-body' }, empty('git-compare', 'Tick two sessions', 'Their phases appear side by side with the difference, and their picture times on one axis. Use it for the console beside Flycast, or a build beside the one before.'))); return card; }
    const keys = a.store.phases.map((p) => p.key).filter((k) => b.store!.phases.some((p) => p.key === k));
    const rows = keys.map((k) => {
      const pa = a.store!.phases.find((p) => p.key === k)!; const sa = a.store!.stats(k, pa.budget ?? 0); const sb = b.store!.stats(k, pa.budget ?? 0);
      const d = sb.mean - sa.mean; const cls = Math.abs(d) < 0.005 ? '' : d > 0 ? 'delta-up' : 'delta-down';
      return `<tr><td>${esc(pa.label)}</td><td class="num">${pa.budget ? fmt(pa.budget, 1) : '-'}</td><td class="num">${fmt(sa.mean)}</td><td class="num">${fmt(sb.mean)}</td><td class="num ${cls}">${d > 0 ? '+' : ''}${fmt(d)}</td><td class="num">${fmt(sa.p95)}</td><td class="num">${fmt(sb.p95)}</td><td class="num">${fmt(sa.worst)}</td><td class="num">${fmt(sb.worst)}</td></tr>`;
    }).join('');
    const tiers = a.tier === b.tier ? '' : `<div class="callout warn" style="margin:var(--s-3) var(--s-4) 0">${iconSvg('triangle-alert')}<p><b>Different tiers.</b> A is "${esc(a.tier)}", B is "${esc(b.tier)}": read the difference with that in mind.</p></div>`;
    const body = h('div', { class: 'card-body flush' });
    body.innerHTML = `${tiers}<table class="table dense"><thead><tr><th>Phase</th><th class="num">Budget ms</th><th class="num">A mean</th><th class="num">B mean</th><th class="num">B - A</th><th class="num">A p95</th><th class="num">B p95</th><th class="num">A worst</th><th class="num">B worst</th></tr></thead><tbody>${rows}</tbody></table>`;
    const tot = a.store.totalKey(); const busyKey = a.store.phases.find((p) => !p.total)?.key ?? tot;
    const legend = h('div', { class: 'cmp-legend', style: 'padding:var(--s-3) var(--s-4) 0' }, h('span', null, h('i', { style: 'background:var(--chart-draw)' }), `A: ${a.label}`), h('span', null, h('i', { style: 'background:var(--chart-svc)' }), `B: ${b.label}`), h('span', { class: 'faint' }, `${a.store.phases.find((p) => p.key === busyKey)?.label ?? busyKey} ms per picture`));
    body.append(legend, h('div', { style: 'padding:var(--s-2) var(--s-4) var(--s-4)' }, this.chart));
    card.append(body);
    requestAnimationFrame(() => this.draw(a.store!, b.store!, busyKey));
    return card;
  }
  private draw(A: SessionStore, B: SessionStore, key: string): void {
    const { g, w, h: H } = fitCanvas(this.chart); g.clearRect(0, 0, w, H);
    const L = num('--s-8'), T = num('--s-2'), Bm = num('--s-5'); const n = Math.max(A.maxN, B.maxN, 1);
    let max = 0; for (const s of [A, B]) for (let i = 1; i <= s.maxN; i++) { const v = s.value(key, i); if (v > max) max = v; }
    const bud = A.phases.find((p) => p.key === key)?.budget ?? 0; max = Math.max(max, bud) * 1.1 || 1;
    const x = (i: number) => L + ((i - 1) / Math.max(1, n - 1)) * (w - L - num('--s-2')); const y = (v: number) => T + (1 - v / max) * (H - T - Bm);
    g.font = tok('--chart-font'); g.fillStyle = tok('--text-faint'); g.strokeStyle = tok('--border'); g.lineWidth = 1;
    const marks = [0, bud, max].filter((q, i, all) => (i === 0 || q > 0) && all.slice(0, i).every((o) => Math.abs(o - q) > max * 0.12));
    for (const v of marks) { g.beginPath(); g.setLineDash(v === bud && bud ? [4, 3] : []); g.moveTo(L, y(v)); g.lineTo(w, y(v)); g.stroke(); g.fillText(v.toFixed(1), num('--s-1'), y(v) + num('--s-1')); }
    g.setLineDash([]);
    for (let i = 0; i <= 4; i++) { const p = Math.round(1 + (i * (n - 1)) / 4); g.fillText(String(p), Math.min(w - num('--s-8'), x(p) - num('--s-1')), H - num('--s-1')); }
    for (const [s, c] of [[A, '--chart-draw'], [B, '--chart-svc']] as const) {
      g.strokeStyle = tok(c); g.lineWidth = 1.25; g.beginPath(); let pen = false;
      for (let i = 1; i <= s.maxN; i++) { const v = s.value(key, i); if (Number.isNaN(v)) { pen = false; continue; } if (pen) g.lineTo(x(i), y(v)); else { g.moveTo(x(i), y(v)); pen = true; } }
      g.stroke();
    }
  }
}
