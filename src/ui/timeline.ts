// The shared timeline: transport, playhead ruler and trace lanes on the same picture axis as every chart.
import type { App } from './app';
import { drawLanes, drawRuler, laneRows, type Axis } from './charts';
import { fitCanvas, h, iconSvg, num, save, store } from './dom';
import { xRange } from './view';

export class Timeline {
  el: HTMLElement;
  private ruler = h('canvas', { class: 'tl-ruler', 'aria-label': 'Playhead ruler: click or drag to move the playhead' });
  private lanes = h('canvas', { class: 'tl-lanes', 'aria-label': 'Trace lanes' });
  private pos = h('span', { class: 'readpos' });
  private mode = h('span', { class: 'pill info' });
  private playBtn: HTMLButtonElement;
  private followBtn: HTMLButtonElement;
  private speedSel = h('select', { class: 'select', 'aria-label': 'Replay speed', title: 'Replay speed' });
  private last = '';
  private sizeV = 0;
  private ax: Axis | null = null;
  private scroll = h('div', { class: 'tl-scroll' });
  private grip = h('div', { class: 'tl-grip', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Timeline height: drag, or arrow keys', tabindex: '0' });
  private colBtn: HTMLButtonElement;
  /** user height in CSS pixels (null: fits its lanes) and collapsed (head only); kept per browser */
  private hgt = store<number | null>('timeline.h', null);
  private collapsed = store<boolean>('timeline.collapsed', false);
  constructor(private app: App) {
    const b = (ic: string, title: string, cmd: string, kbd?: string) => { const x = h('button', { class: 'icon-btn icon-btn-sm', title: kbd ? `${title} (${kbd})` : title, 'aria-label': title, html: iconSvg(ic) }); x.addEventListener('click', () => app.cmds.run(cmd)); return x; };
    this.playBtn = b('play', 'Play', 'play.toggle', 'Space');
    this.followBtn = b('skip-forward', 'Follow the newest picture', 'follow.toggle', 'F');
    for (const s of [0.25, 0.5, 1, 2, 4]) this.speedSel.append(h('option', { value: String(s) }, `${s}x`));
    this.speedSel.value = '1';
    this.speedSel.addEventListener('change', () => app.source.setSpeed(Number(this.speedSel.value)));
    const head = h('div', { class: 'tl-head' },
      h('span', { class: 'row-tight strong', html: iconSvg('history') }, 'Timeline'),
      h('span', { class: 'row-tight' }, b('skip-back', 'To the start', 'go.start', 'Home'), b('step-back', 'Back one picture', 'step.prev', ','), this.playBtn, b('step-forward', 'Step one picture', 'step.next', '.'), this.followBtn),
      this.pos, h('span', { class: 'grow' }), this.mode, h('span', { class: 'select-wrap', html: iconSvg('chevron-down') }, this.speedSel));
    this.speedSel.parentElement!.prepend(this.speedSel);
    this.colBtn = h('button', { class: 'icon-btn icon-btn-sm', title: 'Collapse or expand the timeline', 'aria-label': 'Collapse or expand the timeline' });
    this.colBtn.addEventListener('click', () => { this.collapsed = !this.collapsed; save('timeline.collapsed', this.collapsed); this.apply(); });
    head.append(this.colBtn);
    this.scroll.append(h('div', { class: 'tl-wrap' }, this.lanes));
    this.el = h('section', { class: 'ws-timeline', 'aria-label': 'Timeline' }, this.grip, head, h('div', { class: 'tl-wrap' }, this.ruler), this.scroll);
    this.grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.grip.setPointerCapture(e.pointerId); this.grip.classList.add('is-drag'); const y0 = e.clientY, h0 = this.el.offsetHeight;
      const mv = (m: PointerEvent) => this.setHeight(h0 + (y0 - m.clientY));
      const up = () => { this.grip.classList.remove('is-drag'); this.grip.removeEventListener('pointermove', mv); this.grip.removeEventListener('pointerup', up); save('timeline.h', this.hgt); };
      this.grip.addEventListener('pointermove', mv); this.grip.addEventListener('pointerup', up);
    });
    this.grip.addEventListener('keydown', (k) => { const d = k.key === 'ArrowUp' ? 16 : k.key === 'ArrowDown' ? -16 : 0; if (d) { k.preventDefault(); this.setHeight(this.el.offsetHeight + d); save('timeline.h', this.hgt); } });
    this.apply();
    new ResizeObserver(() => this.sizeV++).observe(this.el);
    for (const cv of [this.ruler, this.lanes]) this.scrub(cv);
  }
  private scrub(cv: HTMLCanvasElement): void {
    cv.addEventListener('pointerdown', (e) => {
      if (!this.ax) return;
      cv.setPointerCapture(e.pointerId);
      const go = (ev: PointerEvent) => { const r = cv.getBoundingClientRect(); this.app.scrubTo(this.ax!.n(ev.clientX - r.left)); };
      go(e);
      const up = () => { cv.removeEventListener('pointermove', go); cv.removeEventListener('pointerup', up); };
      cv.addEventListener('pointermove', go); cv.addEventListener('pointerup', up);
    });
    cv.addEventListener('mousemove', (e) => { if (!this.ax) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left; this.app.view.set('hover', x >= this.ax.left ? this.ax.n(x) : null); });
    cv.addEventListener('mouseleave', () => this.app.view.set('hover', null));
  }
  private setHeight(px: number): void {
    const min = num('--h-panel-head') + num('--s-5') + num('--s-8'); const max = Math.round(window.innerHeight * 0.6);
    this.hgt = Math.round(Math.max(min, Math.min(max, px))); if (this.collapsed) { this.collapsed = false; save('timeline.collapsed', false); } this.apply();
  }
  reset(): void { this.hgt = null; save('timeline.h', null); this.apply(); }
  private apply(): void {
    this.el.classList.toggle('is-collapsed', this.collapsed);
    this.el.style.height = this.collapsed || this.hgt == null ? '' : `${this.hgt}px`;
    this.scroll.style.flex = this.hgt != null && !this.collapsed ? '1 1 0%' : '';
    this.colBtn.innerHTML = iconSvg(this.collapsed ? 'chevron-right' : 'chevron-down');
    this.colBtn.classList.toggle('is-on', this.collapsed); this.sizeV++;
  }
  frame(): void {
    const { app } = this; const st = app.store; const v = app.view; const src = app.source;
    const k = `${st.version}|${v.version}|${app.themeV}|${this.sizeV}|${src.playing}|${src.state}|${src.speed}`;
    if (k === this.last) return; this.last = k;
    const range = xRange(v, st.maxN, app.span());
    const labelW = num('--w-col-num') + num('--s-8');
    { const { g, w, h: hh } = fitCanvas(this.ruler); this.ax = drawRuler(g, w, hh, st, range, v.playhead, labelW, st.maxN); }
    const lh = num('--s-3') + num('--s-half'); const want = `${laneRows(st).length * lh}px`;
    if (this.lanes.style.height !== want) this.lanes.style.height = want;
    { const { g, w, h: hh } = fitCanvas(this.lanes); drawLanes(g, w, hh, st, { range, playhead: v.playhead, hover: v.hover, labelW, labels: true, laneH: lh }); }
    const rate = st.rate; const n = v.playhead;
    this.pos.textContent = `picture ${n} of ${app.span() || st.maxN} · ${(n / rate).toFixed(2)} s${v.zoom ? ` · zoom ${v.zoom[0]}-${v.zoom[1]}` : ''}`;
    const live = src.kind === 'live';
    this.mode.innerHTML = live ? `${iconSvg('radio')}Live` : `${iconSvg('history')}Replay ${src.speed}x`;
    this.mode.className = live ? 'pill ok' : 'pill info';
    this.speedSel.parentElement!.hidden = live; this.speedSel.value = String(src.speed);
    const playing = src.playing && src.state !== 'lost';
    this.playBtn.innerHTML = iconSvg(playing ? 'pause' : 'play');
    this.playBtn.title = (playing ? 'Pause' : 'Play') + ' (Space)'; this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.playBtn.classList.toggle('is-on', playing);
    this.followBtn.classList.toggle('is-on', v.follow);
  }
}
