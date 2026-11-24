// The calm home when no console is linked: what to do next, devices seen, recent sessions.
import type { App } from '../ui/app';
import { esc, h } from '../ui/dom';
import { btn, empty, type Editor, type EditorDef } from './base';
import { bget } from '../data/bridge-client';
import { ENDPOINTS, uiDiscovery, type C1Discovery, type Discovery } from '../data/bridge-api';
import { isDemo, sourceEpoch } from '../data/scope';

class Home implements Editor {
  el = h('div'); bodyClass = 'scroll';
  constructor(app: App) {
    this.el.append(empty('cable', 'No console linked',
      'Start Flycast with the loader, or power the Dreamcast with the loader on its card. The bridge on this PC finds it on the local network or through the DreamPi, and DC QA Link Cloud links to the bridge.',
      [btn('Connect to the bridge on this PC', () => app.cmds.run('link.local'), { primary: true, icon: 'plug' }),
        btn('Enter an address', () => { app.palette(); }, { icon: 'search', kbd: 'Ctrl K' }),
        btn('Open the demo recording', () => app.cmds.run('session.demo'), { icon: 'history' })]));
  }
  meta(): string { return 'no console linked'; }
  frame(): void { /* static */ }
}

// devices the current source knows: the demo's example rows with the demo only; live, what the bridge hears; else none
class Devices implements Editor {
  el = h('div'); bodyClass = 'scroll'; private built = ''; private seen: Discovery['seen'] = []; private at = 0;
  constructor(private app: App) {}
  meta(): string { return isDemo(this.app.source) ? 'demo' : `${this.seen.length} seen`; }
  frame(): void {
    const s = this.app.source;
    if (s.kind === 'live' && performance.now() - this.at > 3000) { this.at = performance.now(); void bget<C1Discovery>(this.app.bridgeUrl, ENDPOINTS.discovery, 1500).then((d) => { this.seen = uiDiscovery(d).seen; this.built = ''; }).catch(() => { this.seen = []; this.built = ''; }); }
    const k = `${sourceEpoch()}|${s.kind}|${this.seen.map((x) => x.id + x.chosen).join(',')}`; if (k === this.built) return; this.built = k;
    const rows: [string, string, string, boolean][] = isDemo(s) ? [['Flycast on this PC (demo)', 'broadband adapter, through the bridge', 'demo-0001', true], ['Dreamcast, living room (demo)', 'modem through the DreamPi', 'not seen today', false]]
      : s.kind === 'live' ? this.seen.map((x) => [x.kind === 'console' ? `Dreamcast at ${x.address}` : 'Flycast on this PC', x.transport === 'modem' ? 'modem through the DreamPi' : 'broadband adapter, through the bridge', x.chosen ? 'linked' : x.at || 'seen', !x.chosen] as [string, string, string, boolean]) : [];
    if (!rows.length) { this.el.replaceChildren(empty('radio', s.kind === 'live' ? 'No console heard yet' : 'No devices', s.kind === 'live' ? 'Start the loader on the console or Flycast; the bridge lists what it hears here.' : 'Link to the bridge on this PC to see the consoles it hears.')); return; }
    const t = h('table', { class: 'table dense' });
    t.innerHTML = '<thead><tr><th>Device</th><th>Path</th><th>Last seen</th><th></th></tr></thead>';
    const tb = h('tbody');
    for (const [d, p, l, on] of rows) {
      const tr = h('tr'); tr.innerHTML = `<td>${esc(d)}</td><td class="muted"><span class="ellipsis" title="${esc(p)}">${esc(p)}</span></td><td class="mono">${esc(l)}</td>`;
      const td = h('td', { style: 'text-align:right' }, btn('Link', () => this.app.cmds.run('link.local'), { small: true, disabled: !on })); tr.append(td); tb.append(tr);
    }
    t.append(tb); this.el.replaceChildren(t);
  }
}

class Sessions implements Editor {
  el = h('div'); bodyClass = 'scroll'; private built = '';
  constructor(private app: App) {}
  meta(): string { return 'recordings on this PC'; }
  frame(): void {
    const last = this.app.store.meta; const k = `${sourceEpoch()}|${last?.id}`; if (k === this.built) return; this.built = k;
    const t = h('table', { class: 'table dense' });
    t.innerHTML = '<thead><tr><th>Session</th><th>Program</th><th class="num">Pictures</th><th class="num">Mean ms</th></tr></thead>';
    const tb = h('tbody');
    const add = (label: string, prog: string, pics: string, mean: string, run: () => void, sel = false) => {
      const tr = h('tr', { class: 'click' + (sel ? ' is-selected' : ''), tabindex: '0' }); tr.innerHTML = `<td><span class="ellipsis" title="${esc(label)}">${esc(label)}</span></td><td class="mono muted">${esc(prog)}</td><td class="num">${pics}</td><td class="num">${mean}</td>`;
      tr.addEventListener('click', run); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }); tb.append(tr);
    };
    if (last) { const st = this.app.store; const p = st.phases[0]; const s = p ? st.stats(p.key) : null; add(last.label, last.program.name, String(st.maxN), s && !Number.isNaN(s.mean) ? s.mean.toFixed(2) : '-', () => this.app.setWorkspace('link'), true); }
    else { this.el.replaceChildren(empty('history', 'No session in this source', 'Open a session file with Ctrl O, or the demo recording.', [btn('Open the demo recording', () => this.app.cmds.run('session.demo'), { small: true, icon: 'history' })])); return; }
    t.append(tb);
    const note = h('div', { class: 'faint', style: 'padding:var(--s-3);font-size:var(--fs-xs)' }, last ? `${last.tier}. Open a session file with Ctrl O.` : 'Open a session file with Ctrl O.');
    this.el.replaceChildren(t, note);
  }
}

export const homeEditors: EditorDef[] = [
  { id: 'home', title: 'Link', icon: 'link-2', group: 'Home', create: (app) => new Home(app) },
  { id: 'devices', title: 'Devices seen', icon: 'monitor', group: 'Home', create: (app) => new Devices(app) },
  { id: 'sessions', title: 'Recent sessions', icon: 'history', group: 'Home', create: (app) => new Sessions(app) },
];
