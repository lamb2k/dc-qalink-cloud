// Split areas: a tree of row/column splits with editors at the leaves. Drag a handle to resize, pick any editor
// from an area's header menu, split, close, maximize. Each workspace remembers its tree.
import type { Editor, EditorDef } from '../editors/base';
import type { App } from './app';
import { h, iconSvg, save, store } from './dom';
import { openMenu, type MenuItem } from './menu';

export type LNode = { s: 'row' | 'col'; r: number; a: LNode; b: LNode } | { e: string; id?: string; o?: Record<string, unknown> };
export type Workspace = 'link' | 'perf' | 'assets' | 'capture' | 'debug' | 'commands';
/** full pages under the top bar (no split areas, no timeline) */
export type PageId = 'sessions' | 'settings' | 'setup';
export const PAGES: { id: PageId; label: string; icon: string }[] = [{ id: 'sessions', label: 'Sessions', icon: 'history' }, { id: 'settings', label: 'Settings', icon: 'settings' }];
export const WORKSPACES: { id: Workspace; label: string; icon: string }[] = [
  { id: 'link', label: 'Link', icon: 'link-2' }, { id: 'perf', label: 'Performance', icon: 'gauge' },
  { id: 'assets', label: 'Assets', icon: 'box' }, { id: 'capture', label: 'Capture', icon: 'camera' }, { id: 'debug', label: 'Debug', icon: 'cpu' },
  { id: 'commands', label: 'Commands', icon: 'gamepad-2' },
];

const row = (r: number, a: LNode, b: LNode): LNode => ({ s: 'row', r, a, b });
const col = (r: number, a: LNode, b: LNode): LNode => ({ s: 'col', r, a, b });
const e = (id: string, o?: Record<string, unknown>): LNode => ({ e: id, o });

export function defaultLayout(ws: Workspace | 'home'): LNode {
  switch (ws) {
    case 'link': return row(0.16, e('outliner'), col(0.6, row(0.56, e('screen'), e('graphs', { limit: 2 })), row(0.66, e('log'), e('properties'))));
    case 'perf': return row(0.37, e('graphs'), row(0.5, col(0.45, e('phases'), e('stacked')), col(0.58, e('counters'), e('slowest'))));
    case 'capture': return row(0.79, col(0.62, e('compare'), row(0.5, e('diff'), e('grabs'))), e('inspector'));
    case 'assets': return row(0.22, e('assetlist'), row(0.73, col(0.6, row(0.5, e('preview'), e('dcview')), e('sync')), e('assetprops')));
    case 'debug': return row(0.3, col(0.48, e('runs'), e('runreport')), row(0.7, col(0.64, e('memory'), e('log')), e('watch')));
    case 'commands': return row(0.3, col(0.62, e('warp'), e('cmdlog')), row(0.56, col(0.6, e('screen'), e('pad')), col(0.52, e('control'), e('padscripts'))));
    case 'home': return row(0.74, col(0.36, e('home'), col(0.3, e('devices'), e('graphs', { limit: 2, last: true }))), e('sessions'));
  }
}
const KEY = (ws: string) => `layout.${ws}.v1`;
export function loadLayout(ws: Workspace | 'home'): LNode { return store<LNode>(KEY(ws), defaultLayout(ws)); }
export function saveLayout(ws: Workspace | 'home', n: LNode): void { save(KEY(ws), n); }

let uid = 0;
function assignIds(n: LNode): void { if ('e' in n) { if (!n.id) n.id = `a${++uid}`; } else { assignIds(n.a); assignIds(n.b); } }

export class Area {
  el: HTMLElement; body: HTMLElement; metaEl: HTMLElement; toolsEl: HTMLElement; titleBtn: HTMLButtonElement;
  editor: Editor | null = null;
  private metaText = '';
  constructor(readonly node: Extract<LNode, { e: string }>, private host: LayoutHost) {
    const def = host.defs.get(node.e) ?? host.defs.get('outliner')!;
    this.titleBtn = h('button', { class: 'ed', 'aria-haspopup': 'menu', title: 'Change editor (menu)', html: `${iconSvg(def.icon)}<span>${def.title}</span>${iconSvg('chevron-down', 16, 'chev')}` });
    this.titleBtn.addEventListener('click', () => openMenu(this.titleBtn, this.menu(), `${def.title} area`));
    this.metaEl = h('span', { class: 'meta' });
    this.toolsEl = h('span', { class: 'area-tools' });
    this.body = h('div', { class: 'area-body' });
    this.el = h('section', { class: 'area', 'data-area': node.id!, 'data-editor': def.id, 'aria-label': def.title },
      h('header', { class: 'area-head' }, this.titleBtn, this.metaEl, h('span', { class: 'grow' }), this.toolsEl), this.body);
    this.el.addEventListener('mousedown', () => host.focus(this));
    this.el.addEventListener('focusin', () => host.focus(this));
    try {
      this.editor = def.create(host.app, node.o ?? {});
      if (this.editor.bodyClass) this.body.classList.add(...this.editor.bodyClass.split(' '));
      this.body.append(this.editor.el);
      if (this.editor.tools) this.toolsEl.append(...this.editor.tools);
    } catch (err) {
      this.body.append(h('div', { class: 'empty' }, h('div', { class: 't' }, 'This editor failed to open'), h('div', { class: 'mono' }, String(err))));
      console.error(err);
    }
  }
  get def(): EditorDef { return this.host.defs.get(this.node.e)!; }
  frame(force: boolean): void {
    if (!this.editor) return;
    this.editor.frame(force);
    const m = this.editor.meta?.() ?? '';
    if (m !== this.metaText) { this.metaText = m; this.metaEl.textContent = m; this.metaEl.title = m; }
  }
  destroy(): void { this.editor?.destroy?.(); }
  menu(): MenuItem[] {
    const items: MenuItem[] = [];
    const groups = new Map<string, EditorDef[]>();
    for (const d of this.host.defs.values()) { if (d.group === 'Home') continue; if (!groups.has(d.group)) groups.set(d.group, []); groups.get(d.group)!.push(d); }
    const extra = this.editor?.menu?.();
    if (extra?.length) items.push(...extra, 'sep');
    for (const [g, ds] of groups) {
      items.push({ group: g });
      for (const d of ds) items.push({ label: d.title, icon: d.icon, current: d.id === this.node.e, run: () => this.host.setEditor(this, d.id) });
    }
    items.push('sep',
      { label: 'Split right', icon: 'square-split-horizontal', kbd: 'Ctrl \\', run: () => this.host.split(this, 'row') },
      { label: 'Split down', icon: 'square-split-vertical', run: () => this.host.split(this, 'col') },
      { label: this.host.maximized ? 'Restore areas' : 'Maximize area', icon: 'maximize-2', kbd: 'Ctrl M', run: () => this.host.toggleMax(this) },
      { label: 'Close area', icon: 'x', disabled: this.host.isRoot(this), run: () => this.host.close(this) });
    return items;
  }
}

export interface LayoutHost {
  app: App;
  defs: Map<string, EditorDef>;
  maximized: string;
  focus(a: Area): void;
  setEditor(a: Area, id: string): void;
  split(a: Area, dir: 'row' | 'col'): void;
  close(a: Area): void;
  toggleMax(a: Area): void;
  isRoot(a: Area): boolean;
}

/** Builds the DOM for a tree; returns the root element and the areas in order. */
export function buildLayout(root: LNode, host: LayoutHost, onChange: () => void): { el: HTMLElement; areas: Area[] } {
  assignIds(root);
  const areas: Area[] = [];
  if (host.maximized) {
    const leaf = findLeaf(root, host.maximized);
    if (leaf) { const a = new Area(leaf, host); areas.push(a); return { el: h('div', { class: 'split' }, a.el), areas }; }
  }
  const build = (n: LNode): HTMLElement => {
    if ('e' in n) { const a = new Area(n, host); areas.push(a); return a.el; }
    const el = h('div', { class: `split split-${n.s}` });
    const handle = h('div', { class: 'split-handle', role: 'separator', 'aria-orientation': n.s === 'row' ? 'vertical' : 'horizontal', tabindex: '0', 'aria-label': 'Resize areas', 'aria-valuenow': Math.round(n.r * 100) });
    const A = build(n.a), B = build(n.b);
    const apply = () => {
      A.style.flex = `${n.r} 1 0%`; B.style.flex = `${1 - n.r} 1 0%`;
      handle.setAttribute('aria-valuenow', String(Math.round(n.r * 100)));
    };
    apply();
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); handle.setPointerCapture(ev.pointerId); handle.classList.add('is-drag');
      const r = el.getBoundingClientRect();
      const move = (m: PointerEvent) => {
        const f = n.s === 'row' ? (m.clientX - r.left) / r.width : (m.clientY - r.top) / r.height;
        n.r = Math.min(0.92, Math.max(0.08, f)); apply();
      };
      const up = () => { handle.classList.remove('is-drag'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); onChange(); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('keydown', (k) => {
      const d = k.key === 'ArrowLeft' || k.key === 'ArrowUp' ? -0.02 : k.key === 'ArrowRight' || k.key === 'ArrowDown' ? 0.02 : 0;
      if (d) { k.preventDefault(); n.r = Math.min(0.92, Math.max(0.08, n.r + d)); apply(); onChange(); }
    });
    el.append(A, handle, B);
    return el;
  };
  return { el: build(root), areas };
}

export function findLeaf(n: LNode, id: string): Extract<LNode, { e: string }> | null {
  if ('e' in n) return n.id === id ? n : null;
  return findLeaf(n.a, id) ?? findLeaf(n.b, id);
}
/** replace the leaf with id by fn(leaf); returns the new root */
export function mapLeaf(n: LNode, id: string, fn: (l: Extract<LNode, { e: string }>) => LNode | null): LNode | null {
  if ('e' in n) return n.id === id ? fn(n) : n;
  const a = mapLeaf(n.a, id, fn), b = mapLeaf(n.b, id, fn);
  if (!a) return b; if (!b) return a;
  n.a = a; n.b = b; return n;
}
