// Dropdown menu: keyboard (arrows, Home/End, Enter, Escape), closes on outside click, returns focus.
import { h, icon } from './dom';

export type MenuItem = { label: string; icon?: string; kbd?: string; run: () => void; current?: boolean; disabled?: boolean } | { group: string } | 'sep';

let open: { el: HTMLElement; close: () => void } | null = null;

export function closeMenu(): void { open?.close(); }

export function openMenu(anchor: HTMLElement, items: MenuItem[], label = 'Menu'): void {
  closeMenu();
  const back = document.activeElement as HTMLElement | null;
  const el = h('div', { class: 'menu', role: 'menu', 'aria-label': label });
  const buttons: HTMLButtonElement[] = [];
  for (const it of items) {
    if (it === 'sep') { el.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if ('group' in it) { el.append(h('div', { class: 'menu-group caps' }, it.group)); continue; }
    const b = h('button', { class: 'menu-item' + (it.current ? ' is-current' : ''), role: 'menuitem', disabled: !!it.disabled, tabindex: '-1' },
      it.icon ? icon(it.icon) : null, h('span', { class: 'ellipsis' }, it.label), it.kbd ? h('span', { class: 'kbd' }, it.kbd) : null);
    b.addEventListener('click', () => { close(); it.run(); });
    buttons.push(b); el.append(b);
  }
  document.body.append(el);
  const r = anchor.getBoundingClientRect(); const m = el.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - m.width - 8); const top = r.bottom + 4 + m.height > window.innerHeight ? Math.max(8, r.top - m.height - 4) : r.bottom + 4;
  el.style.left = `${Math.max(8, left)}px`; el.style.top = `${top}px`;
  const enabled = buttons.filter((b) => !b.disabled);
  let i = Math.max(0, enabled.findIndex((b) => b.classList.contains('is-current')));
  enabled[i]?.focus();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); back?.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); i = (i + (e.key === 'ArrowDown' ? 1 : enabled.length - 1)) % enabled.length; enabled[i].focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); i = e.key === 'Home' ? 0 : enabled.length - 1; enabled[i].focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); }
    e.stopPropagation();
  };
  const onDown = (e: MouseEvent) => { if (!el.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) close(); };
  el.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
  function close() { el.remove(); document.removeEventListener('mousedown', onDown); if (open?.el === el) open = null; }
  open = { el, close };
}
