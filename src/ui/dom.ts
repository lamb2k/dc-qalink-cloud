// Small DOM, icon, number and token helpers. No framework.
import { ICONS } from './icons-data';
import { desktop } from '../platform/desktop';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener> & { class?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}
export function append(el: Node, kids: Child[]): void {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
}
export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }

export function iconSvg(name: string, size: 16 | 20 = 16, cls = ''): string {
  return `<svg class="ic ic${size}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${size <= 16 ? 2 : 1.75}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}
export function icon(name: string, size: 16 | 20 = 16, cls = ''): Element {
  const t = document.createElement('template'); t.innerHTML = iconSvg(name, size, cls); return t.content.firstElementChild!;
}

export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const fmt = (v: number | null | undefined, d = 2): string => (v == null || Number.isNaN(v) ? '-' : v.toFixed(d));
export const int = (v: number | null | undefined): string => (v == null || Number.isNaN(v) ? '-' : Math.round(v).toLocaleString('en-GB'));
export const bytes = (v: number): string => `${int(v)} B`;

// ---- tokens for canvases (colours and sizes come from tokens.css only)
let tokCache = new Map<string, string>();
let tokEl: Element = document.documentElement;
export function resetTokens(): void { tokCache = new Map(); tokEl = document.documentElement; }
export function tok(name: string): string {
  let v = tokCache.get(name);
  if (v === undefined) { v = getComputedStyle(tokEl).getPropertyValue(name).trim(); tokCache.set(name, v); }
  return v;
}
/** a size token in CSS pixels, e.g. num('--s-2') = 8 */
export function num(name: string): number { return parseFloat(tok(name)) || 0; }
export function rgbOf(name: string): [number, number, number] {
  const v = tok(name);
  if (v.startsWith('#')) { const x = v.slice(1); const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as [number, number, number]; }
  const m = v.match(/[\d.]+/g); return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [0, 0, 0];
}

export function store<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem('qalink-cloud.' + key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function save(key: string, value: unknown): void {
  try { localStorage.setItem('qalink-cloud.' + key, JSON.stringify(value)); } catch { /* storage blocked: layouts are not kept */ }
}

/** Canvas sized to its element at device pixels; returns a context in CSS pixels. */
export function fitCanvas(cv: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } {
  const r = cv.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h: r.height };
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function download(name: string, blob: Blob): void {
  const q = desktop();
  if (q) { // the desktop app saves through the system dialog (downloads are switched off there)
    const purpose = /\.jsonl$/i.test(name) ? 'session' : /\.png$/i.test(name) ? 'asset' : /\.json$/i.test(name) ? 'presets' : /\.(txt|pad)$/i.test(name) ? 'padscript' : 'loader';
    void blob.arrayBuffer().then((b) => q.saveFile(purpose, name, new Uint8Array(b))).catch((e) => console.error(e));
    return;
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
