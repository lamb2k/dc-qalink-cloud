// Capture: the console screen for the playhead's picture, grab history, A/B compare (side by side, difference,
// wipe), the pixel inspector, and PNG export.
import type { App } from '../ui/app';
import type { GrabRecord } from '../data/format';
import { esc, fitCanvas, h, iconSvg, int } from '../ui/dom';
import { grabCanvas } from '../ui/view';
import { btn, empty, toolBtn, Watch, type Editor, type EditorDef } from './base';
import { blitFit, difference, hex, loupe, markPixel, pixel, rgb565, toImage, type Fit, type FitMode } from './pictures';

function pickA(app: App): GrabRecord | null { return app.view.grabA ?? app.store.grabAt(app.view.playhead); }
function pickB(app: App, a: GrabRecord | null): GrabRecord | null {
  if (app.view.grabB) return app.view.grabB;
  const gs = app.store.grabs; if (!a) return null;
  const ref = gs.find((g) => g.kind === 'reference' && g.n === a.n); if (ref) return ref;
  const i = gs.indexOf(a); for (let k = i - 1; k >= 0; k--) if (gs[k].kind !== 'reference') return gs[k];
  return null;
}
const label = (g: GrabRecord | null) => (g ? `${g.kind === 'reference' ? 'reference' : 'picture'} ${g.n}${g.label ? `, ${g.label}` : ''}` : 'none');

class Screen implements Editor {
  el: HTMLElement; tools: HTMLElement[];
  private cv = h('canvas', { class: 'fill', tabindex: '0', 'aria-label': 'Console screen. Move the mouse for a pixel readout; click to inspect a pixel; wheel to zoom.' });
  private note = h('span', { class: 'area-note' });
  private info = h('span', { class: 'area-note left' });
  private w = new Watch(); private fit: Fit | null = null; private mode: FitMode = 'fit'; private zoom = 1; private center: [number, number] | null = null;
  private hoverPx: [number, number] | null = null; private v = 0; private grab: GrabRecord | null = null;
  constructor(private app: App) {
    this.el = h('div', { class: 'fill' }, this.cv, this.note, this.info);
    const modeBtn = toolBtn('scan', 'Fit or fill the area (fill crops)', () => { this.mode = this.mode === 'fit' ? 'fill' : 'fit'; this.zoom = 1; this.center = null; modeBtn.classList.toggle('is-on', this.mode === 'fill'); this.v++; });
    this.tools = [toolBtn('camera', 'Grab the console screen (G)', () => app.cmds.run('grab')), toolBtn('zoom-in', 'Zoom in', () => this.zoomBy(2)), toolBtn('zoom-out', 'Zoom out', () => this.zoomBy(0.5)), modeBtn, toolBtn('download', 'Export this picture as PNG', () => this.export())];
    this.cv.addEventListener('mousemove', (e) => { if (!this.fit) return; this.hoverPx = toImage(this.fit, e.offsetX, e.offsetY); this.v++; });
    this.cv.addEventListener('mouseleave', () => { this.hoverPx = null; this.v++; });
    this.cv.addEventListener('click', (e) => { if (!this.fit) return; const p = toImage(this.fit, e.offsetX, e.offsetY); if (p) app.view.set('pixel', p); });
    this.cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = this.fit && toImage(this.fit, e.offsetX, e.offsetY); if (p) this.center = p; this.zoomBy(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    this.w.observe(this.el);
  }
  private zoomBy(f: number): void { this.zoom = Math.min(16, Math.max(1, this.zoom * f)); if (this.zoom === 1) this.center = null; this.v++; }
  private export(): void { const a = this.grab; if (!a) return; this.app.view.grabA = a; this.app.exportGrab('a'); }
  private origin = '';
  meta(): string { const g = this.grab; return g ? `grab at picture ${g.n}, ${g.w}x${g.h}, ${this.origin}${this.zoom > 1 ? `, zoom ${this.zoom.toFixed(1)}x` : ''}` : 'no grab yet'; }
  frame(force: boolean): void {
    if (!this.w.changed(this.app, String(this.v)) && !force) return;
    const st = this.app.store; this.grab = st.grabAt(this.app.view.playhead);
    const { g, w, h: hh } = fitCanvas(this.cv);
    const src = this.grab ? grabCanvas(this.grab, () => this.v++) : null;
    if (!src) { g.clearRect(0, 0, w, hh); this.fit = null; this.note.hidden = false; this.note.textContent = this.grab ? 'decoding' : st.meta ? 'No grab at or before this picture. Press G to grab.' : 'No console linked'; this.info.hidden = true; return; }
    this.fit = blitFit(g, w, hh, src, this.mode, this.zoom, this.center ?? undefined);
    markPixel(g, this.fit, this.app.view.pixel);
    this.origin = st.meta?.synthetic ? 'generated test picture' : this.app.source.kind === 'replay' ? 'from the recording' : 'from the console';
    this.note.textContent = ''; this.note.hidden = true;
    if (this.hoverPx) { const p = pixel(src, ...this.hoverPx); this.info.hidden = false; this.info.textContent = `x ${this.hoverPx[0]} y ${this.hoverPx[1]} · ${hex(p)} · RGB565 0x${rgb565(p).toString(16).toUpperCase().padStart(4, '0')}`; }
    else this.info.hidden = true;
  }
  destroy(): void { this.w.stop(); }
}

class Compare implements Editor {
  el: HTMLElement; tools: HTMLElement[];
  private cv = h('canvas', { class: 'fill', tabindex: '0', 'aria-label': 'Compare grab A with grab B' });
  private labels = h('div', { class: 'compare-labels' });
  private seg = h('span', { class: 'seg', role: 'group', 'aria-label': 'Compare mode' });
  private w = new Watch(); private v = 0; private fits: Fit[] = []; private dragging = false;
  constructor(private app: App) {
    this.el = h('div', { class: 'fill' }, this.cv, this.labels);
    for (const [m, l] of [['side', 'Side by side'], ['diff', 'Difference'], ['wipe', 'Wipe']] as const) {
      const b = h('button', { 'data-m': m, 'aria-pressed': 'false' }, l); b.addEventListener('click', () => app.view.set('compare', m)); this.seg.append(b);
    }
    this.tools = [this.seg, toolBtn('redo-2', 'Swap A and B', () => app.cmds.run('grab.swap'))];
    this.cv.addEventListener('pointerdown', (e) => { if (app.view.compare === 'wipe') { this.dragging = true; this.cv.setPointerCapture(e.pointerId); this.wipeTo(e.offsetX); } });
    this.cv.addEventListener('pointermove', (e) => {
      if (this.dragging) { this.wipeTo(e.offsetX); return; }
      for (const f of this.fits) { const p = toImage(f, e.offsetX, e.offsetY); if (p && e.buttons === 1) app.view.set('pixel', p); }
    });
    this.cv.addEventListener('pointerup', () => { this.dragging = false; });
    this.cv.addEventListener('click', (e) => { if (app.view.compare === 'wipe') return; for (const f of this.fits) { const p = toImage(f, e.offsetX, e.offsetY); if (p) { app.view.set('pixel', p); break; } } });
    this.w.observe(this.el);
  }
  private wipeTo(x: number): void { const r = this.cv.getBoundingClientRect(); this.app.view.wipe = Math.min(1, Math.max(0, x / r.width)); this.app.view.bump(); }
  meta(): string { const a = pickA(this.app); return `A ${label(a)} · B ${label(pickB(this.app, a))}`; }
  frame(force: boolean): void {
    if (!this.w.changed(this.app, String(this.v)) && !force) return;
    const v = this.app.view;
    this.seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.m === v.compare; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    const A = pickA(this.app), B = pickB(this.app, A);
    const a = A ? grabCanvas(A, () => this.v++) : null, b = B ? grabCanvas(B, () => this.v++) : null;
    const { g, w, h: hh } = fitCanvas(this.cv); this.fits = [];
    g.clearRect(0, 0, w, hh);
    const tag = (k: string, t: string) => `<span class="pill outline"><span class="ab ${k}">${k.toUpperCase()}</span>${esc(t)}</span>`;
    this.el.querySelector('.fill-center')?.remove();
    if (!a) {
      this.labels.innerHTML = '';
      this.el.append(h('div', { class: 'fill-center' }, empty('columns-2', 'Nothing to compare yet', `No grab at or before picture ${v.playhead}. Press G to grab the console screen, or pick A in Grabs (Shift+click for B).`, [btn('Grab now', () => this.app.cmds.run('grab'), { icon: 'camera', small: true, kbd: 'G' })], true)));
      return;
    }
    if (v.compare === 'side' || !b) {
      const half = b ? w / 2 : w;
      g.save(); g.beginPath(); g.rect(0, 0, half - 1, hh); g.clip(); const fa = blitFit(g, half - 1, hh, a); g.restore(); this.fits.push(fa); markPixel(g, fa, v.pixel);
      if (b) { g.save(); g.translate(half + 1, 0); g.beginPath(); g.rect(0, 0, half - 1, hh); g.clip(); const fb = blitFit(g, half - 1, hh, b); g.restore(); const fb2 = { ...fb, dx: fb.dx + half + 1 }; this.fits.push(fb2); markPixel(g, fb2, v.pixel); }
      this.labels.innerHTML = tag('a', label(A)) + (b ? tag('b', label(B)) : '<span class="pill">no B: pick one in Grabs (Shift+click)</span>');
    } else if (v.compare === 'diff') {
      const d = difference(a, b, v.threshold, `${A!.n}|${A!.kind}|${B!.n}|${B!.kind}`); const f = blitFit(g, w, hh, d.cv); this.fits.push(f); markPixel(g, f, v.pixel);
      this.labels.innerHTML = tag('a', label(A)) + `<span class="pill warn">${d.pct.toFixed(1)} % over ${v.threshold}</span>` + tag('b', label(B));
    } else {
      const f = blitFit(g, w, hh, b); const x = Math.round(w * v.wipe);
      g.save(); g.beginPath(); g.rect(0, 0, x, hh); g.clip(); blitFit(g, w, hh, a); g.restore();
      g.fillStyle = getComputedStyle(this.cv).getPropertyValue('--chart-cursor'); g.fillRect(x, 0, 1, hh);
      this.fits.push(f); markPixel(g, f, v.pixel);
      this.labels.innerHTML = tag('a', label(A)) + tag('b', label(B));
    }
  }
  destroy(): void { this.w.stop(); }
}

class DiffView implements Editor {
  el: HTMLElement; tools: HTMLElement[];
  private cv = h('canvas', { class: 'fill', 'aria-label': 'Difference of A and B' });
  private note = h('span', { class: 'area-note' });
  private w = new Watch(); private v = 0; private fit: Fit | null = null; private stats = '';
  constructor(private app: App) {
    this.el = h('div', { class: 'fill' }, this.cv, this.note);
    const t = (d: number) => () => { app.view.threshold = Math.max(0, Math.min(255, app.view.threshold + d)); app.view.bump(); };
    this.tools = [toolBtn('minus', 'Lower threshold', t(-8)), toolBtn('plus', 'Raise threshold', t(8)), toolBtn('download', 'Export the difference as PNG', () => this.export())];
    this.cv.addEventListener('click', (e) => { if (!this.fit) return; const p = toImage(this.fit, e.offsetX, e.offsetY); if (p) app.view.set('pixel', p); });
    this.w.observe(this.el);
  }
  private last: HTMLCanvasElement | null = null;
  private export(): void { this.last?.toBlob((b) => { if (!b) return; const a = h('a', { href: URL.createObjectURL(b), download: 'difference.png' }); document.body.append(a); a.click(); a.remove(); }); }
  meta(): string { return `threshold ${this.app.view.threshold} of 255${this.stats}`; }
  frame(force: boolean): void {
    if (!this.w.changed(this.app, String(this.v)) && !force) return;
    const A = pickA(this.app), B = pickB(this.app, A);
    const a = A ? grabCanvas(A, () => this.v++) : null, b = B ? grabCanvas(B, () => this.v++) : null;
    const { g, w, h: hh } = fitCanvas(this.cv);
    this.el.querySelector('.fill-center')?.remove(); this.note.hidden = false;
    if (!a || !b) { g.clearRect(0, 0, w, hh); this.stats = ''; this.note.hidden = true; this.el.append(h('div', { class: 'fill-center' }, empty('diff', 'Needs two grabs', 'The difference shows once A and B are set. In Grabs: click for A, Shift+click for B.', [], true))); return; }
    const d = difference(a, b, this.app.view.threshold, `${A!.n}|${A!.kind}|${B!.n}|${B!.kind}`); this.last = d.cv;
    this.fit = blitFit(g, w, hh, d.cv); markPixel(g, this.fit, this.app.view.pixel);
    this.stats = ` · ${d.pct.toFixed(1)} % changed`;
    this.note.textContent = `${int(d.changed)} pixels over threshold · mean ${d.mean.toFixed(1)} · max ${d.max.toFixed(0)}`;
  }
  destroy(): void { this.w.stop(); }
}

class Grabs implements Editor {
  el = h('div', { class: 'thumbs', role: 'listbox', 'aria-label': 'Grabs. Click sets A, Shift+click sets B.' }); bodyClass = 'scroll'; tools: HTMLElement[];
  private built = ''; private v = 0; private w = new Watch(); private figs = new Map<GrabRecord, HTMLButtonElement>();
  constructor(private app: App) {
    this.tools = [toolBtn('download', 'Export grab A as PNG (E)', () => app.cmds.run('grab.export')), toolBtn('camera', 'Grab now (G)', () => app.cmds.run('grab'))];
  }
  meta(): string { const n = this.app.store.grabs.length; return `${n} grab${n === 1 ? '' : 's'} · click A, Shift+click B`; }
  frame(force: boolean): void {
    const st = this.app.store; const gs = st.grabs.slice(-120);
    const key = `${st.meta?.id}|${st.grabs.length}|${this.app.themeV}|${this.v}`;
    if (key !== this.built) {
      this.built = key; this.figs.clear(); this.el.replaceChildren();
      if (!gs.length) this.el.append(empty('camera', 'No grabs yet', 'Press G to grab the console screen. Grabs in a recording appear here.', [btn('Grab now', () => this.app.cmds.run('grab'), { icon: 'camera', small: true, kbd: 'G' })]));
      for (const gr of gs) {
        const cv = h('canvas', { width: '128', height: '96' });
        const f = h('button', { class: 'thumb-fig', role: 'option', title: `${label(gr)}. Click: A. Shift+click: B.` }, cv, h('span', { class: 'tag mono' }, gr.kind === 'reference' ? `ref ${gr.n}` : `picture ${gr.n}`));
        f.addEventListener('click', (e) => { if (e.shiftKey) this.app.view.set('grabB', gr); else { this.app.view.set('grabA', gr); } });
        f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); this.app.view.set('grabB', gr); } });
        this.el.append(f); this.figs.set(gr, f);
        const paint = () => { const src = grabCanvas(gr); if (!src) return false; const c = cv.getContext('2d')!; c.imageSmoothingEnabled = true; c.drawImage(src, 0, 0, 128, 96); return true; };
        if (!paint()) grabCanvas(gr, () => { paint(); });
      }
    }
    if (!this.w.changed(this.app) && !force) return;
    const A = pickA(this.app), B = pickB(this.app, A);
    for (const [gr, f] of this.figs) {
      f.classList.toggle('is-a', gr === A); f.classList.toggle('is-b', gr === B); f.setAttribute('aria-selected', String(gr === A));
      const tag = f.querySelector('.tag')!; tag.innerHTML = `${gr === A ? '<span class="ab a">A</span>' : gr === B ? '<span class="ab b">B</span>' : ''}${gr.kind === 'reference' ? `ref ${gr.n}` : `picture ${gr.n}`}`;
    }
  }
}

class Inspector implements Editor {
  el = h('div', { class: 'pane-pad' }); bodyClass = 'scroll';
  private lp = h('canvas', { class: 'loupe-canvas', 'aria-label': 'Loupe, 11 by 11 pixels around the inspected pixel' });
  private dl = h('div');
  private w = new Watch(); private v = 0;
  constructor(private app: App) { this.el.append(this.lp, this.dl); }
  meta(): string { const p = this.app.view.pixel; return `pixel ${p[0]}, ${p[1]}`; }
  frame(force: boolean): void {
    if (!this.w.changed(this.app, String(this.v)) && !force) return;
    const A = pickA(this.app), B = pickB(this.app, A);
    const a = A ? grabCanvas(A, () => this.v++) : null, b = B ? grabCanvas(B, () => this.v++) : null;
    const [x, y] = this.app.view.pixel;
    const { g, w, h: hh } = fitCanvas(this.lp);
    this.lp.hidden = !a;
    if (!a) { g.clearRect(0, 0, w, hh); this.dl.replaceChildren(empty('pipette', 'Nothing to inspect', 'Grab a picture, then click a pixel in the console screen or the compare view.')); return; }
    loupe(g, w, hh, a, x, y);
    const pa = pixel(a, x, y); const pb = b ? pixel(b, x, y) : null;
    let html = `<dl class="props"><dt>Position</dt><dd>${x}, ${y}</dd><dt>A RGB</dt><dd>${pa.join(' ')}</dd><dt>A hex</dt><dd>${hex(pa)}</dd><dt>A as RGB565</dt><dd>0x${rgb565(pa).toString(16).toUpperCase().padStart(4, '0')}</dd>`;
    if (pb) html += `<dt>B RGB</dt><dd>${pb.join(' ')}</dd><dt>Delta A-B</dt><dd>${pa.map((v, i) => v - pb[i]).join(' ')}</dd>`;
    html += '</dl>';
    if (b) { const d = difference(a, b, this.app.view.threshold, `${A!.n}|${A!.kind}|${B!.n}|${B!.kind}`); html += `<div class="section-title">${iconSvg('diff')}Whole picture</div><dl class="props"><dt>Pixels over threshold</dt><dd>${int(d.changed)}</dd><dt>Share</dt><dd>${d.pct.toFixed(1)} %</dd><dt>Mean delta</dt><dd>${d.mean.toFixed(1)} of 255</dd></dl>`; }
    html += `<div class="faint" style="font-size:var(--fs-xs)">A: ${esc(label(A))}. B: ${esc(label(B))}.${this.app.store.meta?.synthetic ? ' Generated test pictures, not a console capture.' : ''}</div>`;
    this.dl.innerHTML = html;
  }
}

export const captureEditors: EditorDef[] = [
  { id: 'screen', title: 'Console screen', icon: 'monitor', group: 'Capture', create: (app) => new Screen(app) },
  { id: 'compare', title: 'Compare', icon: 'columns-2', group: 'Capture', create: (app) => new Compare(app) },
  { id: 'diff', title: 'Difference', icon: 'diff', group: 'Capture', create: (app) => new DiffView(app) },
  { id: 'grabs', title: 'Grabs', icon: 'camera', group: 'Capture', create: (app) => new Grabs(app) },
  { id: 'inspector', title: 'Pixel inspector', icon: 'pipette', group: 'Capture', create: (app) => new Inspector(app) },
];
