// Editor contract: an editor fills one area. It redraws only when what it reads has changed.
import type { App } from '../ui/app';
import type { MenuItem } from '../ui/menu';
import { h, iconSvg } from '../ui/dom';

export interface Editor {
  el: HTMLElement;
  /** area body class: '' (fixed, canvas), 'scroll', 'pad' */
  bodyClass?: string;
  tools?: HTMLElement[];
  /** header meta text; read every frame, written only when it changes */
  meta?(): string;
  frame(force: boolean): void;
  destroy?(): void;
  menu?(): MenuItem[];
}
export type Group = 'Link' | 'Performance' | 'Capture' | 'Assets' | 'Debug' | 'Commands' | 'Home';
export interface EditorDef { id: string; title: string; icon: string; group: Group; create(app: App, opts: Record<string, unknown>): Editor }

/** redraw key: data, view, theme and size versions */
export class Watch {
  private last = '';
  sizeV = 0;
  private ro: ResizeObserver | null = null;
  observe(el: Element): void { this.ro = new ResizeObserver(() => { this.sizeV++; }); this.ro.observe(el); }
  changed(app: App, extra = ''): boolean {
    const k = `${app.store.version}|${app.view.version}|${app.themeV}|${this.sizeV}|${app.source.state}|${extra}`;
    if (k === this.last) return false;
    this.last = k; return true;
  }
  stop(): void { this.ro?.disconnect(); }
}

export function toolBtn(icon: string, title: string, run: (e: MouseEvent) => void, on = false): HTMLButtonElement {
  const b = h('button', { class: 'icon-btn icon-btn-sm' + (on ? ' is-on' : ''), title, 'aria-label': title, html: iconSvg(icon) });
  b.addEventListener('click', run);
  return b;
}

export function empty(iconName: string, title: string, text: string, actions: HTMLElement[] = [], center = false): HTMLElement {
  const el = h('div', { class: 'empty' + (center ? ' center' : ''), html: iconSvg(iconName, 20) });
  el.append(h('div', { class: 't' }, title), h('div', null, text));
  if (actions.length) el.append(h('div', { class: 'home-actions' }, actions));
  return el;
}

export function btn(label: string, run: () => void, opt: { icon?: string; primary?: boolean; small?: boolean; kbd?: string; disabled?: boolean; ghost?: boolean } = {}): HTMLButtonElement {
  const b = h('button', { class: `btn${opt.primary ? ' btn-primary' : ''}${opt.small ? ' btn-sm' : ''}${opt.ghost ? ' btn-ghost' : ''}`, disabled: !!opt.disabled, html: opt.icon ? iconSvg(opt.icon) : '' });
  b.append(label); if (opt.kbd) b.append(h('span', { class: 'kbd' }, opt.kbd));
  b.addEventListener('click', run);
  return b;
}
