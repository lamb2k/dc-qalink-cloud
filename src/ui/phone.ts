// Phone width: a monitor, not a workstation. Link state, the console's screen, one graph, a few commands.
import type { App } from './app';
import { drawStrips } from './charts';
import { fitCanvas, fmt, h, iconSvg } from './dom';
import { grabCanvas, xRange } from './view';
import { blitFit } from '../editors/pictures';
import BRAND_SVG from '../../assets/icon/dc-qalink-cloud.svg?raw';

export class Phone {
  el: HTMLElement;
  private screen = h('canvas', { class: 'fill', 'aria-label': 'Console screen' });
  private chart = h('canvas', { class: 'fill', 'aria-label': 'Drawing time per picture' });
  private head = h('div', { class: 'row-tight' });
  private pill = h('span');
  private kpis = h('div', { class: 'mon-kpis' });
  private overPill = h('span', { class: 'pill' });
  private devName = h('h2');
  private devMeta = h('span', { class: 'muted mono', style: 'font-size:var(--fs-xs)' });
  private chartTitle = h('h2');
  private foot = h('div', { class: 'mon-foot' });
  private playBtn: HTMLButtonElement;
  private last = '';
  constructor(private app: App) {
    const cmd = (ic: string, label: string, id: string) => { const b = h('button', { class: 'btn', html: iconSvg(ic) }); b.append(label); b.addEventListener('click', () => app.cmds.run(id)); return b; };
    this.playBtn = cmd('pause', 'Pause', 'play.toggle');
    const menu = h('button', { class: 'icon-btn', 'aria-label': 'Commands', title: 'Commands', html: iconSvg('menu') });
    menu.addEventListener('click', () => app.palette());
    this.el = h('div', { class: 'mon' },
      h('header', { class: 'mon-top' }, h('span', { class: 'brand' }, h('span', { class: 'brand-mark', html: BRAND_SVG }), 'DC QA Link Cloud'), h('span', { class: 'grow' }), this.pill, menu),
      h('div', { class: 'mon-body' },
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, this.devName, h('span', { class: 'grow' }), this.devMeta), h('div', { class: 'mon-screen' }, this.screen)),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, this.chartTitle, h('span', { class: 'grow' }), this.overPill), h('div', { class: 'mon-chart' }, this.chart), this.kpis),
        h('div', { class: 'cmd-grid' }, this.playBtn, cmd('step-forward', 'Step', 'step.next'), cmd('camera', 'Grab screen', 'grab'), cmd('crosshair', 'Warp', 'console.warp')),
        this.foot));
    void this.head;
  }
  frame(): void {
    const { app } = this; const st = app.store; const s = app.source; const v = app.view;
    const k = `${st.version}|${v.version}|${app.themeV}|${s.state}|${s.playing}|${innerWidth}`;
    if (k === this.last) return; this.last = k;
    this.pill.innerHTML = s.state === 'linked' ? `<span class="pill ok">${iconSvg('circle-check')}Linked</span>` : s.state === 'replay' ? `<span class="pill info">${iconSvg('history')}Replay</span>` : s.state === 'lost' ? `<span class="pill err">${iconSvg('link-2-off')}Lost</span>` : `<span class="pill">${iconSvg('circle')}Not linked</span>`;
    this.devName.textContent = s.info.device || 'No console linked';
    this.devMeta.textContent = s.info.transport ? `${s.info.transport === 'Broadband adapter' ? 'adapter' : 'modem'} · ${(s.info.rateBps / 1024).toFixed(1)} KB/s` : '';
    const g = st.grabAt(v.playhead);
    const cv = g ? grabCanvas(g, () => { this.last = ''; }) : null;
    { const { g: c, w, h: hh } = fitCanvas(this.screen); if (cv) blitFit(c, w, hh, cv); else c.clearRect(0, 0, w, hh); }
    const p = st.phases[0];
    this.chartTitle.textContent = p ? `${p.label}, ms per picture` : 'No data yet';
    if (p) {
      const stt = st.stats(p.key, p.budget ?? 0);
      this.overPill.className = 'pill ' + (stt.over ? 'err' : 'ok'); this.overPill.textContent = `${stt.over} of ${stt.n} over`;
      const { g: c, w, h: hh } = fitCanvas(this.chart);
      drawStrips(c, w, hh, st, { phases: [p], range: xRange(v, st.maxN, app.span()), playhead: v.playhead, hover: null });
      this.kpis.replaceChildren(...[['Mean', stt.mean], ['p95', stt.p95], ['Worst', stt.worst]].map(([l, x]) => h('div', { class: 'kpi' }, h('span', { class: 'l' }, String(l)), h('span', { class: 'v' }, fmt(x as number)))));
    }
    this.playBtn.innerHTML = iconSvg(s.playing ? 'pause' : 'play'); this.playBtn.append(s.playing ? 'Pause' : 'Play');
    this.foot.textContent = st.meta ? `${st.meta.tier} · ${st.meta.label} · picture ${v.playhead}` : '';
  }
}
