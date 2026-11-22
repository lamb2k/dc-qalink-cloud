// Time editors on the shared picture axis: Graphs (phases against budget), stacked picture time, Trace lanes.
// Hover shows a readout, click moves the playhead, drag selects a range to zoom, double-click shows everything.
import type { App } from '../ui/app';
import { drawLanes, drawStacked, drawStrips, type Axis, type LaneRow } from '../ui/charts';
import { esc, fitCanvas, fmt, h, iconSvg, num, tok } from '../ui/dom';
import { xRange } from '../ui/view';
import { toolBtn, Watch, type Editor, type EditorDef } from './base';

abstract class TimeChart implements Editor {
  el: HTMLElement; tools: HTMLElement[]; protected cv = h('canvas', { tabindex: '0' });
  protected readout = h('div', { class: 'readout', hidden: true });
  protected ax: Axis | null = null;
  protected sel: [number, number] | null = null;
  protected w = new Watch();
  protected mouse: [number, number] | null = null;
  constructor(protected app: App, label: string) {
    this.cv.setAttribute('aria-label', `${label}. Arrow keys move the playhead; drag to zoom; double-click to show everything.`);
    const body = h('div', { class: 'chart-body' }, this.cv, this.readout);
    this.el = h('div', { class: 'chart-pad' }, this.legend(), body);
    this.tools = [toolBtn('zoom-out', 'Show the whole session (Z)', () => app.view.set('zoom', null))];
    this.w.observe(body);
    let down: number | null = null, downX = 0;
    this.cv.addEventListener('pointerdown', (e) => { if (!this.ax) return; this.cv.setPointerCapture(e.pointerId); downX = e.offsetX; down = this.ax.n(e.offsetX); });
    this.cv.addEventListener('pointermove', (e) => {
      if (!this.ax) return; this.mouse = [e.offsetX, e.offsetY];
      const n = e.offsetX >= this.ax.left && e.offsetX <= this.ax.right ? this.ax.n(e.offsetX) : null;
      if (down != null && Math.abs(e.offsetX - downX) > 4) { this.sel = [down, this.ax.n(e.offsetX)]; app.view.bump(); }
      app.view.set('hover', n);
    });
    this.cv.addEventListener('pointerup', (e) => {
      if (!this.ax || down == null) return;
      if (this.sel && Math.abs(this.sel[1] - this.sel[0]) >= 4) { const a = Math.max(1, Math.min(...this.sel)), b = Math.max(...this.sel); app.view.set('zoom', [a, b]); }
      else if (Math.abs(e.offsetX - downX) <= 4) app.setPlayhead(this.ax.n(e.offsetX));
      down = null; this.sel = null; app.view.bump();
    });
    this.cv.addEventListener('pointerleave', () => { this.mouse = null; app.view.set('hover', null); });
    this.cv.addEventListener('dblclick', () => app.view.set('zoom', null));
    this.cv.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); app.setPlayhead(app.view.playhead + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); } });
  }
  protected abstract legend(): HTMLElement;
  protected abstract draw(g: CanvasRenderingContext2D, w: number, h: number, range: [number, number]): void;
  protected abstract readoutRows(n: number): string;
  meta(): string { const z = this.app.view.zoom; return z ? `pictures ${z[0]}-${z[1]}` : 'ms per picture'; }
  frame(force: boolean): void {
    if (!this.w.changed(this.app) && !force) return;
    const { g, w, h: hh } = fitCanvas(this.cv); const st = this.app.store; const v = this.app.view;
    if (!st.meta || !st.maxN) { g.clearRect(0, 0, w, hh); this.readout.hidden = true; return; }
    this.draw(g, w, hh, xRange(v, st.maxN, this.app.span()));
    const n = v.hover;
    if (n != null && this.mouse && n >= 1 && n <= st.maxN) {
      this.readout.innerHTML = this.readoutRows(n); this.readout.hidden = false;
      const rw = this.readout.offsetWidth, rh = this.readout.offsetHeight; const pad = num('--s-3');
      let x = this.mouse[0] + pad; if (x + rw > w) x = this.mouse[0] - pad - rw;
      const y = Math.min(Math.max(0, this.mouse[1] - rh / 2), hh - rh);
      this.readout.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      this.readout.style.left = '0'; this.readout.style.top = '0';
    } else this.readout.hidden = true;
  }
  destroy(): void { this.w.stop(); }
}

class Graphs extends TimeChart {
  constructor(app: App, private opts: { limit?: number; last?: boolean }) { super(app, 'Phases against budget'); }
  private phases() { const p = this.app.store.phases; return this.opts.limit ? p.slice(0, this.opts.limit) : p; }
  protected legend(): HTMLElement {
    const el = h('div', { class: 'chart-legend' });
    const fill = () => {
      el.replaceChildren(...this.phases().map((p) => h('span', null, h('i', { class: 'swatch', style: `background:var(${p.color || '--chart-draw'})` }), p.label)),
        h('span', null, h('i', { class: 'swatch', style: 'background:var(--chart-budget)' }), 'Budget'),
        h('span', { style: 'color:var(--err)' }, '▼ slowest 5'),
        h('span', null, h('i', { class: 'swatch', style: 'background:var(--warn)' }), 'Gap'));
    };
    queueMicrotask(fill); this.refill = fill;
    return el;
  }
  // set from legend(), which runs inside the base constructor: no initializer, or it would be reset after super()
  declare private refill: () => void;
  private metaId = '';
  protected draw(g: CanvasRenderingContext2D, w: number, hh: number, range: [number, number]): void {
    const st = this.app.store; if (st.meta && st.meta.id !== this.metaId) { this.metaId = st.meta.id; this.refill(); }
    this.ax = drawStrips(g, w, hh, st, { phases: this.phases(), range, playhead: this.app.view.playhead, hover: this.app.view.hover, select: this.sel }).ax;
  }
  protected readoutRows(n: number): string {
    const st = this.app.store;
    let s = `<span class="h">Picture ${n}${st.has(n) ? '' : ' (gap: not received)'}</span>`;
    for (const p of st.phases) { const v = st.value(p.key, n); s += `<span class="k"><i class="swatch" style="background:var(${p.color || '--chart-draw'})"></i>${esc(p.label)}</span><span class="v${p.budget && v > p.budget ? ' over' : ''}">${fmt(v)}</span>`; }
    return s;
  }
  menu() {
    return [{ label: this.opts.limit ? 'Show all phases' : 'Show the first two phases', icon: 'layers', run: () => { this.opts.limit = this.opts.limit ? 0 : 2; this.refill(); this.app.view.bump(); } }];
  }
}

class Stacked extends TimeChart {
  protected legend(): HTMLElement {
    const el = h('div', { class: 'chart-legend' });
    queueMicrotask(() => {
      const st = this.app.store; const parts = st.phases.filter((p) => !p.total);
      const tot = st.phases.find((p) => p.total);
      el.replaceChildren(...parts.map((p) => h('span', null, h('i', { class: 'swatch', style: `background:var(${p.color || '--chart-draw'})` }), p.label)),
        st.column('wait') ? h('span', null, h('i', { class: 'swatch', style: 'background:var(--chart-wait)' }), 'Pacer wait') : '',
        tot?.budget ? h('span', null, h('i', { class: 'swatch', style: 'background:var(--chart-budget)' }), `${tot.label} budget ${fmt(tot.budget, 1)} ms`) : '');
    });
    return el;
  }
  protected draw(g: CanvasRenderingContext2D, w: number, hh: number, range: [number, number]): void {
    this.ax = drawStacked(g, w, hh, this.app.store, range, this.app.view.playhead, this.app.view.hover);
    if (this.sel && this.ax) { g.fillStyle = tok('--chart-select'); const a = this.ax.x(Math.min(...this.sel)), b = this.ax.x(Math.max(...this.sel)); g.fillRect(a, 0, b - a, hh); }
  }
  protected readoutRows(n: number): string {
    const st = this.app.store; let s = `<span class="h">Picture ${n}</span>`; let sum = 0;
    for (const p of st.phases.filter((x) => !x.total)) { const v = st.value(p.key, n); sum += v || 0; s += `<span class="k">${esc(p.label)}</span><span class="v">${fmt(v)}</span>`; }
    if (st.column('wait')) s += `<span class="k">Pacer wait</span><span class="v">${fmt(st.value('wait', n))}</span>`;
    const t = st.phases.find((p) => p.total); if (t) { const v = st.value(t.key, n); s += `<span class="k">${esc(t.label)}</span><span class="v${t.budget && v > t.budget ? ' over' : ''}">${fmt(v)}</span>`; }
    void sum; return s;
  }
}

class Trace extends TimeChart {
  private rows: LaneRow[] = []; private lh = 0;
  protected legend(): HTMLElement { return h('div', { class: 'chart-legend' }, h('span', null, 'Lanes from the session trace, then derived lanes: over budget, slowest, gaps, log lines. Dense lanes draw a count per pixel.')); }
  meta(): string { const st = this.app.store; return `${st.traceCount.toLocaleString('en-GB')} events, ${st.lanes.length} lanes`; }
  protected draw(g: CanvasRenderingContext2D, w: number, hh: number, range: [number, number]): void {
    const r = drawLanes(g, w, hh, this.app.store, { range, playhead: this.app.view.playhead, hover: this.app.view.hover, labelW: num('--w-col-num') + num('--s-8'), labels: true, select: this.sel });
    this.ax = r.ax; this.rows = r.rows; this.lh = r.lh;
  }
  protected readoutRows(n: number): string {
    const st = this.app.store; let s = `<span class="h">Picture ${n}</span>`;
    if (this.mouse && this.lh) {
      const row = this.rows[Math.floor(this.mouse[1] / this.lh)];
      if (row?.kind === 'trace') {
        const L = st.trace[row.lane!]; const { from, to } = st.traceIn(row.lane!, n, n);
        const hits = []; for (let i = from; i < to && hits.length < 4; i++) if (L[i].start <= n && L[i].end >= n) hits.push(L[i]);
        s += `<span class="k">${esc(row.name)}</span><span class="v">${hits.length ? esc(hits.map((e) => e.label).join(', ')) : '-'}</span>`;
      } else if (row) s += `<span class="k">${esc(row.name)}</span><span class="v"></span>`;
    }
    return s;
  }
}

export const timeEditors: EditorDef[] = [
  { id: 'graphs', title: 'Graphs', icon: 'activity', group: 'Performance', create: (app, o) => new Graphs(app, o as { limit?: number }) },
  { id: 'stacked', title: 'Picture time, stacked', icon: 'layers', group: 'Performance', create: (app) => new (class extends Stacked { constructor() { super(app, 'Picture time, stacked'); } })() },
  { id: 'trace', title: 'Trace', icon: 'history', group: 'Performance', create: (app) => new (class extends Trace { constructor() { super(app, 'Trace lanes'); } })() },
];
void iconSvg;
