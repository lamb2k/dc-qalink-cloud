// The calm home when no console is linked: what to do next, devices seen, recent sessions.
import type { App } from '../ui/app';
import { esc, h } from '../ui/dom';
import { btn, empty, type Editor, type EditorDef } from './base';

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

class Devices implements Editor {
  el = h('div'); bodyClass = 'scroll';
  constructor(app: App) {
    const t = h('table', { class: 'table dense' });
    t.innerHTML = '<thead><tr><th>Device</th><th>Path</th><th>Last seen</th><th></th></tr></thead>';
    const tb = h('tbody');
    const rows: [string, string, string, boolean][] = [['Flycast on this PC', 'broadband adapter, through the bridge', 'demo-0001', true], ['Dreamcast, living room', 'modem through the DreamPi', 'not seen today', false]];
    for (const [d, p, l, on] of rows) {
      const tr = h('tr'); tr.innerHTML = `<td>${esc(d)}</td><td class="muted"><span class="ellipsis" title="${esc(p)}">${esc(p)}</span></td><td class="mono">${esc(l)}</td>`;
      const td = h('td', { style: 'text-align:right' }, btn('Link', () => app.cmds.run('link.local'), { small: true, disabled: !on })); tr.append(td); tb.append(tr);
    }
    t.append(tb); this.el.append(t);
  }
  meta(): string { return '2 seen'; }
  frame(): void { /* static */ }
}

class Sessions implements Editor {
  el = h('div'); bodyClass = 'scroll'; private built = '';
  constructor(private app: App) {}
  meta(): string { return 'recordings on this PC'; }
  frame(): void {
    const last = this.app.store.meta; const k = `${last?.id}`; if (k === this.built) return; this.built = k;
    const t = h('table', { class: 'table dense' });
    t.innerHTML = '<thead><tr><th>Session</th><th>Program</th><th class="num">Pictures</th><th class="num">Mean ms</th></tr></thead>';
    const tb = h('tbody');
    const add = (label: string, prog: string, pics: string, mean: string, run: () => void, sel = false) => {
      const tr = h('tr', { class: 'click' + (sel ? ' is-selected' : ''), tabindex: '0' }); tr.innerHTML = `<td><span class="ellipsis" title="${esc(label)}">${esc(label)}</span></td><td class="mono muted">${esc(prog)}</td><td class="num">${pics}</td><td class="num">${mean}</td>`;
      tr.addEventListener('click', run); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }); tb.append(tr);
    };
    if (last) { const st = this.app.store; const p = st.phases[0]; const s = st.stats(p.key); add(last.label, last.program.name, String(st.maxN), s.mean.toFixed(2), () => this.app.cmds.run('session.demo'), true); }
    else add('Spinning cubes, demo', 'example.elf', '900', '-', () => this.app.cmds.run('session.demo'));
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
