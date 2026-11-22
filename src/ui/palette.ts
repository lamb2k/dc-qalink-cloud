// Commands: every action has one, the palette (Ctrl+K) reaches all of them, shortcuts are listed beside them.
import { h, iconSvg } from './dom';

export interface Command {
  id: string;
  title: string;
  group: string;
  icon?: string;
  /** shown in the palette and menus, e.g. "Space" or "Ctrl K" */
  keys?: string;
  /** asks for a value first (palette second step) */
  ask?: { label: string; placeholder: string; parse(v: string): unknown };
  enabled?(): boolean;
  run(arg?: unknown): unknown;
}

export class Commands {
  list: Command[] = [];
  add(...c: Command[]): void { this.list.push(...c); }
  get(id: string): Command | undefined { return this.list.find((c) => c.id === id); }
  run(id: string, arg?: unknown): void { const c = this.get(id); if (c && (c.enabled?.() ?? true)) void c.run(arg); }
}

/** fuzzy-ish match: every word of the query appears in title or group, in order of first letters scored */
export function matchScore(q: string, c: Command): number {
  if (!q) return 1;
  const t = `${c.title} ${c.group}`.toLowerCase(); let s = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = t.indexOf(w); if (i < 0) return 0;
    s += i === 0 ? 4 : t[i - 1] === ' ' ? 3 : 1;
  }
  return s;
}

export function openPalette(cmds: Commands, onClose: () => void): HTMLElement {
  const back = document.activeElement as HTMLElement | null;
  const input = h('input', { 'aria-label': 'Search commands', placeholder: 'Type a command', spellcheck: 'false', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list' });
  const list = h('div', { class: 'palette-list', role: 'listbox', id: 'palette-list' });
  const foot = h('div', { class: 'palette-foot' }, h('span', null, h('span', { class: 'kbd' }, 'Enter'), ' run'), h('span', null, h('span', { class: 'kbd' }, '↑'), h('span', { class: 'kbd' }, '↓'), ' move'), h('span', null, h('span', { class: 'kbd' }, 'Esc'), ' close'));
  const prompt = h('span', { class: 'caps' });
  const pal = h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Command palette', 'aria-modal': 'true' },
    h('div', { class: 'palette-input', html: iconSvg('search') }, prompt, input), list, foot);
  const overlay = h('div', { class: 'overlay' }, pal);
  let shown: Command[] = []; let active = 0; let asking: Command | null = null;
  const render = () => {
    list.replaceChildren();
    if (asking) { list.append(h('div', { class: 'palette-empty' }, asking.ask!.label)); return; }
    const q = input.value.trim();
    shown = cmds.list.filter((c) => c.enabled?.() ?? true).map((c) => ({ c, s: matchScore(q, c) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s).map((x) => x.c);
    active = Math.min(active, Math.max(0, shown.length - 1));
    if (!shown.length) { list.append(h('div', { class: 'palette-empty' }, `No command matches "${q}".`)); return; }
    let group = '';
    shown.forEach((c, i) => {
      if (!q && c.group !== group) { group = c.group; list.append(h('div', { class: 'palette-group caps' }, group)); }
      const it = h('div', { class: 'palette-item' + (i === active ? ' is-active' : ''), role: 'option', id: `pc-${i}`, 'aria-selected': String(i === active), 'data-cmd': c.id, html: iconSvg(c.icon || 'command') },
        h('span', { class: 'ellipsis' }, c.title), q ? h('span', { class: 'grp' }, c.group) : null,
        c.keys ? h('span', { class: 'kbds' }, ...c.keys.split(' ').map((k) => h('span', { class: 'kbd' }, k))) : null);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); active = i; choose(); });
      list.append(it);
    });
    input.setAttribute('aria-activedescendant', `pc-${active}`);
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };
  const close = () => { overlay.remove(); onClose(); back?.focus(); };
  const choose = () => {
    if (asking) {
      const v = asking.ask!.parse(input.value.trim());
      if (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) { prompt.textContent = 'not valid'; return; }
      const c = asking; close(); void c.run(v); return;
    }
    const c = shown[active]; if (!c) return;
    if (c.ask) { asking = c; input.value = ''; input.placeholder = c.ask.placeholder; prompt.textContent = c.title; render(); return; }
    close(); void c.run();
  };
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') e.preventDefault();
    e.stopPropagation();
  });
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  render(); input.focus();
  return overlay;
}
