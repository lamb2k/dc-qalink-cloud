// The workstation shell: top bar with workspaces, split editor areas, shared timeline, status bar, commands.
import { EDITORS } from '../editors';
import type { Source } from '../data/source';
import { IdleSource, ReplaySource } from '../data/source';
import { LiveSource } from '../data/live';
import type { SessionStore } from '../data/store';
import { parseSession, shortBuild } from '../data/format';
import { buildLine, listBuilds, newestSessionOf, referenceGrabs } from '../data/builds';
import { download, h, icon, iconSvg, isTyping, resetTokens, save, store } from './dom';
import { buildLayout, defaultLayout, findLeaf, loadLayout, mapLeaf, saveLayout, WORKSPACES, type Area, type LNode, type LayoutHost, type Workspace } from './layout';
import { closeMenu, openMenu, type MenuItem } from './menu';
import { Commands, openPalette } from './palette';
import { Timeline } from './timeline';
import { grabCanvas, View } from './view';
import { Phone } from './phone';
import { PAGES, type PageId } from './layout';
import type { Page } from '../pages/page';
import { SessionsPage } from '../pages/sessions';
import { SettingsPage } from '../pages/settings';
import { SetupPage, type StepId } from '../pages/setup';
import { DEFAULT_BRIDGE } from '../data/bridge-client';
import { desktop } from '../platform/desktop';
import BRAND_SVG from '../../assets/icon/dc-qalink-cloud.svg?raw';

export interface AppOptions { ws?: Workspace; theme?: 'dark' | 'light'; phone?: boolean; demoUrl: string; privateUrl?: string; bridge?: string }

export class App implements LayoutHost {
  readonly app = this;
  view = new View();
  cmds = new Commands();
  defs = new Map(EDITORS.map((d) => [d.id, d]));
  themeV = 0;
  ws: Workspace;
  maximized = '';
  source: Source;
  root: HTMLElement;
  private main = h('main', { class: 'ws-main' });
  private top!: HTMLElement;
  private banner = h('div');
  private status = h('footer', { class: 'ws-status', 'aria-label': 'Status' });
  private toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  private timeline: Timeline;
  private areas: Area[] = [];
  private layoutKey: Workspace | 'home' = 'link';
  private layout: LNode;
  private focused: Area | null = null;
  private topKey = ''; private statusKey = ''; private bannerKey = ''; private mainKey = '';
  private paletteOpen = false;
  private phone: Phone | null = null;
  private unsub: (() => void)[] = [];
  /** loop timing for the speed test: ms of work per animation frame and frame intervals */
  perf = { work: [] as number[], gaps: [] as number[], lastT: 0 };

  constructor(root: HTMLElement, source: Source, readonly opt: AppOptions) {
    this.root = root;
    this.source = source;
    this.ws = opt.ws ?? store<Workspace>('ws', 'link');
    this.applyTheme(opt.theme ?? store<'dark' | 'light'>('theme', 'dark'));
    this.layout = loadLayout(this.ws);
    this.timeline = new Timeline(this);
    this.registerCommands();
    this.bindSource();
    this.render();
    window.addEventListener('keydown', (e) => this.onKey(e));
    requestAnimationFrame((t) => this.loop(t));
  }

  /** a page shown instead of the split areas (Sessions, Settings, Set up a console), or null */
  pageId: PageId | null = null;
  private page: Page | null = null;
  private setupAt: StepId | undefined;
  /** the bridge's address: the live source's, else the one given or saved, else this PC's default */
  get bridgeUrl(): string { return this.source instanceof LiveSource ? this.source.base : this.opt.bridge ?? store<string>('bridge', DEFAULT_BRIDGE); }
  openPage(id: PageId): void { if (this.pageId === id && id !== 'setup') return; this.pageId = id; this.maximized = ''; this.mainKey = ''; this.topKey = ''; }
  openSetup(step?: StepId): void { this.setupAt = step; this.pageId = null; this.openPage('setup'); }
  resetTimeline(): void { this.timeline.reset(); }
  get pageEl(): Page | null { return this.page; }

  get store(): SessionStore { return this.source instanceof IdleSource ? this.source.last?.store ?? this.source.store : this.source.store; }
  /** replay: the recording's last picture (the axis spans it); live: 0 (the axis spans what arrived) */
  span(): number { return this.source instanceof ReplaySource ? this.source.length : this.source instanceof IdleSource ? this.source.last?.length ?? 0 : 0; }

  // ------------------------------------------------------------------ source
  private bindSource(): void {
    this.unsub.forEach((u) => u()); this.unsub = [];
    this.unsub.push(this.source.on('state', () => { this.statusKey = ''; this.topKey = ''; }));
  }
  async setSource(s: Source, at?: number): Promise<void> {
    this.source.stop(); this.source = s; this.bindSource();
    this.view = new View();
    await s.start();
    if (at != null && s instanceof ReplaySource) { this.view.follow = false; this.view.playhead = Math.min(at, s.length); }
    this.mainKey = ''; this.topKey = ''; this.statusKey = '';
  }
  async openDemo(at?: number, url = this.opt.demoUrl): Promise<void> {
    try { const r = await ReplaySource.fromUrl(url); r.playing = false; await this.setSource(r, at); if (at == null) { r.seek(0); r.play(); } }
    catch (e) { this.toast('err', 'Could not open the recording', String(e)); }
  }
  async connect(bridge: string): Promise<void> {
    const s = new LiveSource(bridge);
    await this.setSource(s);
    this.toast('info', 'Connecting to the bridge', bridge);
  }

  // ------------------------------------------------------------------ playhead
  setPlayhead(n: number, follow = false): void {
    const max = this.store.maxN; n = Math.max(0, Math.min(Math.max(max, this.span()), Math.round(n)));
    if (this.source instanceof ReplaySource && n > max) this.source.seek(n);
    this.view.follow = follow; this.view.set('playhead', Math.min(n, Math.max(this.store.maxN, 0))); this.view.bump();
  }
  /** a click or drag on the timeline: replay while playing moves the clock; otherwise it inspects */
  scrubTo(n: number): void {
    if (this.source instanceof ReplaySource && this.source.playing) { this.source.seek(n); this.view.follow = true; this.view.bump(); return; }
    this.setPlayhead(n, false);
  }
  togglePlay(): void {
    const s = this.source;
    if (s instanceof ReplaySource) {
      if (s.playing) { s.pause(); return; }
      if (!this.view.follow && this.view.playhead < this.store.maxN && this.view.playhead > 0) s.seek(this.view.playhead);
      this.view.follow = true; this.view.bump(); s.play(); return;
    }
    if (s.playing) s.pause(); else s.play();
  }
  step(d: number): void {
    const s = this.source; const v = this.view;
    if (d > 0 && v.playhead >= this.store.maxN) { if (s instanceof ReplaySource) { s.step(d); v.follow = true; v.bump(); } else s.step(d); return; }
    this.setPlayhead(v.playhead + d);
  }

  // ------------------------------------------------------------------ theme
  applyTheme(t: 'dark' | 'light'): void {
    document.documentElement.dataset.theme = t; resetTokens(); this.themeV++; save('theme', t);
  }
  get theme(): 'dark' | 'light' { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }

  // ------------------------------------------------------------------ layout host
  focus(a: Area): void { if (this.focused === a) return; this.focused?.el.classList.remove('is-focused'); this.focused = a; a.el.classList.add('is-focused'); this.view.focusedArea = a.node.id!; }
  setEditor(a: Area, id: string): void { a.node.e = id; a.node.o = {}; this.persist(); this.renderMain(); }
  split(a: Area, dir: 'row' | 'col'): void {
    const id = a.node.id!;
    this.layout = mapLeaf(this.layout, id, (l) => ({ s: dir, r: 0.5, a: { ...l }, b: { e: l.e, o: l.o } })) ?? this.layout;
    this.persist(); this.renderMain();
  }
  close(a: Area): void { if (this.isRoot(a)) return; this.layout = mapLeaf(this.layout, a.node.id!, () => null) ?? this.layout; this.maximized = ''; this.persist(); this.renderMain(); }
  toggleMax(a: Area): void { this.maximized = this.maximized ? '' : a.node.id!; this.renderMain(); }
  isRoot(a: Area): boolean { return 'e' in this.layout && this.layout.id === a.node.id; }
  private persist(): void { saveLayout(this.layoutKey, this.layout); }
  resetLayout(): void { this.layout = defaultLayout(this.layoutKey); this.maximized = ''; this.persist(); this.renderMain(); }
  setWorkspace(ws: Workspace): void { if (this.pageId) { this.pageId = null; this.mainKey = ''; this.topKey = ''; } if (this.ws === ws) return; this.ws = ws; save('ws', ws); this.maximized = ''; this.mainKey = ''; this.topKey = ''; }

  // ------------------------------------------------------------------ render
  private isHome(): boolean { return this.source.state === 'unlinked' && this.ws === 'link'; }
  private render(): void {
    this.phone = this.opt.phone ? new Phone(this) : null;
    if (this.phone) { this.root.replaceChildren(this.phone.el, this.toasts); return; }
    this.top = h('header', { class: 'ws-top' });
    this.root.replaceChildren(h('div', { class: 'app' }, this.top, this.banner, this.main, this.timeline.el, this.status), this.toasts);
  }
  private renderMain(): void {
    closeMenu();
    for (const a of this.areas) a.destroy();
    this.page?.destroy?.(); this.page = null;
    if (this.pageId) {
      this.areas = []; this.focused = null;
      this.page = this.pageId === 'sessions' ? new SessionsPage(this) : this.pageId === 'settings' ? new SettingsPage(this) : new SetupPage(this, this.setupAt);
      this.main.replaceChildren(h('div', { class: 'ws-page' }, this.page.el));
      this.timeline.el.hidden = true; this.page.frame(true); return;
    }
    const key: Workspace | 'home' = this.isHome() ? 'home' : this.ws;
    if (key !== this.layoutKey) { this.layoutKey = key; this.layout = loadLayout(key); }
    const { el, areas } = buildLayout(this.layout, this, () => this.persist());
    this.areas = areas; this.focused = null;
    this.main.replaceChildren(el);
    const focusId = this.view.focusedArea; const f = areas.find((a) => a.node.id === focusId) ?? areas[0];
    if (f) this.focus(f);
    this.timeline.el.hidden = key === 'home' || key === 'assets';
    for (const a of areas) a.frame(true);
  }
  private renderTop(): void {
    const s = this.source;
    const tabs = h('nav', { class: 'wstabs', 'aria-label': 'Workspaces' });
    WORKSPACES.forEach((w, i) => {
      const on = w.id === this.ws && !this.pageId;
      const b = h('button', { class: 'wstab' + (on ? ' is-active' : ''), 'aria-current': on ? 'page' : null, title: `${w.label} (${i + 1})`, html: iconSvg(w.icon) });
      b.append(w.label); b.addEventListener('click', () => this.setWorkspace(w.id)); tabs.append(b);
    });
    tabs.append(h('span', { class: 'sep-v' }));
    PAGES.forEach((p, i) => {
      const on = this.pageId === p.id;
      const b = h('button', { class: 'wstab' + (on ? ' is-active' : ''), 'aria-current': on ? 'page' : null, title: `${p.label} (${WORKSPACES.length + i + 1})`, html: iconSvg(p.icon) });
      b.append(p.label); b.addEventListener('click', () => this.openPage(p.id)); tabs.append(b);
    });
    const pill = s.state === 'linked' ? `<span class="pill ok">${iconSvg('circle-check')}Linked</span>`
      : s.state === 'replay' ? `<span class="pill info">${iconSvg('history')}Replay</span>`
      : s.state === 'lost' ? `<span class="pill err">${iconSvg('link-2-off')}Link lost</span>`
      : s.state === 'connecting' ? `<span class="pill warn">${iconSvg('loader-circle', 16, 'spin')}Connecting</span>`
      : `<span class="pill">${iconSvg('circle')}No console linked</span>`;
    const what = s.state === 'replay' ? `${s.info.label ?? ''}, recorded on ${s.info.device}` : s.state === 'lost' ? `retrying in ${s.info.retryIn ?? 0} s` : s.state === 'unlinked' ? '' : `${s.info.device}${s.info.transport ? ', ' + s.info.transport.toLowerCase() : ''}`;
    const cmdBtn = h('button', { class: 'btn btn-sm', title: 'Command palette (Ctrl K)', html: iconSvg('search') }); cmdBtn.append('Commands', h('span', { class: 'kbd' }, 'Ctrl K'));
    cmdBtn.addEventListener('click', () => this.palette());
    const themeBtn = h('button', { class: 'icon-btn', title: `Light or dark theme (T)`, 'aria-label': 'Switch theme', html: iconSvg(this.theme === 'dark' ? 'sun' : 'moon') });
    themeBtn.addEventListener('click', () => this.cmds.run('theme.toggle'));
    this.top.replaceChildren(
      h('span', { class: 'brand', title: 'DC QA Link Cloud, built on dc-qalink 0.2' }, h('span', { class: 'brand-mark', html: BRAND_SVG }), h('span', { class: 'brand-name' }, 'DC QA Link Cloud')),
      tabs, h('span', { class: 'grow' }),
      h('span', { class: 'top-link', html: pill }, what ? h('span', { class: 'muted ellipsis', title: what }, what) : null),
      h('span', { class: 'sep-v' }), cmdBtn, themeBtn);
  }
  private renderBanner(): void {
    const s = this.source;
    if (s.state !== 'lost') { this.banner.replaceChildren(); return; }
    const retry = h('button', { class: 'btn btn-sm', html: iconSvg('refresh-cw') }); retry.append('Retry now', h('span', { class: 'kbd' }, 'R'));
    retry.addEventListener('click', () => this.cmds.run('link.retry'));
    const n = s.info.lostAt ?? this.store.maxN;
    this.banner.replaceChildren(h('div', { class: 'banner err', role: 'alert', html: iconSvg('link-2-off') },
      h('span', null, h('b', null, `Link lost at picture ${n}.`), ` Everything up to picture ${n} is kept; nothing new arrives. Retrying in ${s.info.retryIn ?? 0} s (attempt ${s.info.attempt ?? 1}).`), retry));
  }
  private renderStatus(): void {
    const s = this.source; const st = this.store; const v = this.view;
    const it = (ic: string, text: string, cls = '') => h('span', { class: 'item ' + cls, title: text, html: iconSvg(ic) }, h('span', null, text));
    const items: Node[] = [];
    if (s.state === 'linked') items.push(it('circle-dot', 'Linked', 'ok'), it('cable', s.info.transport));
    else if (s.state === 'replay') items.push(it('history', `Replay at ${s.speed}x, not live`, 'info'));
    else if (s.state === 'lost') items.push(it('link-2-off', `Link lost at picture ${s.info.lostAt ?? st.maxN}, data kept`, 'err'));
    else if (s.state === 'connecting') items.push(it('loader-circle', 'Connecting', 'warn'));
    else items.push(it('circle', 'Not linked'));
    if (st.meta && s.kind === 'idle') items.push(it('history', `Last session: ${st.meta.label}, ${st.maxN} pictures`, 'wide'), h('span', { class: 'item tier', html: iconSvg('info') }, st.meta.tier));
    else if (st.meta) {
      items.push(it('square-play', `${st.meta.program.name}, ${st.meta.label}`, 'wide'));
      items.push(it(s.playing && s.state !== 'lost' ? 'play' : 'pause', `${s.playing && s.state !== 'lost' ? 'At' : 'Paused at'} picture ${v.playhead} of ${this.span() || st.maxN}`));
      const gaps = st.gaps(); if (gaps.length) items.push(it('triangle-alert', `${gaps.reduce((a, [x, y]) => a + y - x + 1, 0)} pictures missing`, 'warn'));
      items.push(h('span', { class: 'item mono' }, `${((s.state === 'linked' || s.state === 'replay') && s.playing ? s.info.rateBps / 1024 : 0).toFixed(1)} KB/s`));
      items.push(h('span', { class: 'item tier', title: st.meta.tierDetail ?? '', html: iconSvg('info') }, st.meta.tier));
    }
    // the build this session ran (session format 2): the workspace's anchor; a click picks another build
    if (st.meta) {
      const b = st.meta.build;
      const bi = h('button', { class: 'item', title: b ? `Build ${b.id}: ${buildLine(b)}. Click to pick another build.` : 'This session names no build (format 1, or a program started on the console). Click to pick a build.', html: iconSvg('git-commit-horizontal') }, h('span', null, b ? `Build ${shortBuild(b)}` : 'No build'));
      bi.addEventListener('click', () => void this.pickBuild(bi));
      items.push(bi);
    }
    const keys = h('span', { class: 'keys' }, ...[['Space', 'play'], ['.', 'step'], ['G', 'grab'], ['Ctrl K', 'commands']].map(([k, l]) => h('span', null, h('span', { class: 'kbd' }, k), l)));
    this.status.replaceChildren(...items, keys);
  }

  // ------------------------------------------------------------------ builds (lane ql-disc)
  /** A menu of the bridge's builds. "open" opens the build's newest session (every workspace follows the source);
   *  "refs" adds that build's grabs to this session as references, for Capture's A/B compare across builds. */
  async pickBuild(anchor: HTMLElement, what: 'open' | 'refs' = 'open'): Promise<void> {
    const base = this.bridgeUrl;
    let list: Awaited<ReturnType<typeof listBuilds>>;
    try { list = await listBuilds(base); } catch (e) { this.toast('warn', 'No builds to pick', `The bridge at ${base} did not list its builds: ${String(e)}`); return; }
    if (!list.builds.length) { this.toast('info', 'No builds yet', 'A build record is made at every push.'); return; }
    const cur = this.store.meta?.build?.id;
    const items: MenuItem[] = [{ group: what === 'open' ? 'Open the newest session of a build' : 'Add a build\'s grabs as references' },
      ...list.builds.slice(0, 20).map((b) => ({ label: buildLine(b), icon: 'git-commit-horizontal', current: b.id === cur, run: () => void (what === 'open' ? this.openBuild(b.id) : this.addBuildRefs(b)) }))];
    openMenu(anchor, items, 'Builds');
  }
  async openBuild(id: string): Promise<void> {
    const base = this.bridgeUrl.replace(/\/$/, '');
    try {
      const s = await newestSessionOf(base, id);
      if (!s) { this.toast('info', `Build ${id} has no session yet`, 'Its runs have not linked a program, or their sessions were removed.'); return; }
      const r = await ReplaySource.fromUrl(base + `/v0/sessions/${encodeURIComponent(s.id)}`); r.playing = false; await this.setSource(r); r.seek(0);
      this.toast('ok', `Build ${id}: ${s.label}`, 'Link, Performance, Capture and Assets show this build\'s newest session.');
    } catch (e) { this.toast('err', `Could not open build ${id}`, String(e)); }
  }
  async addBuildRefs(b: NonNullable<NonNullable<SessionStore['meta']>['build']>): Promise<void> {
    try {
      const g = await referenceGrabs(this.bridgeUrl, b);
      if (!g.length) { this.toast('info', `Build ${shortBuild(b)} has no grabs`, 'Grab its screen while it runs, then compare.'); return; }
      this.store.appendMany(g); this.statusKey = '';
      this.toast('ok', `${g.length} grabs of build ${shortBuild(b)} added as references`, 'In Capture: click one for A, Shift+click one of this build for B.');
    } catch (e) { this.toast('err', 'Could not read that build\'s grabs', String(e)); }
  }

  // ------------------------------------------------------------------ loop
  private loop(t: number): void {
    const t0 = performance.now();
    try { this.frame(t); } catch (e) { console.error(e); }
    const p = this.perf; p.work.push(performance.now() - t0); if (p.lastT) p.gaps.push(t - p.lastT); p.lastT = t;
    if (p.work.length > 4000) { p.work.splice(0, 2000); p.gaps.splice(0, 2000); }
    requestAnimationFrame((x) => this.loop(x));
  }
  private frame(t: number): void {
    this.source.tick(t);
    const v = this.view; const st = this.store;
    if (v.follow && v.playhead !== st.maxN) { v.playhead = st.maxN; v.bump(); }
    if (v.playhead > st.maxN && !(this.source instanceof IdleSource)) { v.playhead = st.maxN; v.bump(); }
    if (this.phone) { this.phone.frame(); return; }
    const mk = `${this.pageId ?? (this.isHome() ? 'home' : this.ws)}`;
    if (mk !== this.mainKey) { this.mainKey = mk; this.renderMain(); this.topKey = ''; }
    const s = this.source;
    const tk = `${this.ws}|${this.pageId}|${s.state}|${s.info.retryIn}|${s.info.device}|${this.themeV}`;
    if (tk !== this.topKey) { this.topKey = tk; this.renderTop(); }
    const bk = `${s.state}|${s.info.retryIn}|${s.info.attempt}|${s.info.lostAt}`;
    if (bk !== this.bannerKey) { this.bannerKey = bk; this.renderBanner(); }
    const sk = `${s.state}|${s.speed}|${s.playing}|${v.playhead}|${st.maxN}|${st.meta?.id}|${Math.round(s.info.rateBps)}`;
    if (sk !== this.statusKey) { this.statusKey = sk; this.renderStatus(); }
    for (const a of this.areas) a.frame(false);
    this.page?.frame(false);
    if (!this.timeline.el.hidden) this.timeline.frame();
  }

  // ------------------------------------------------------------------ toasts, palette, keys
  toast(kind: 'ok' | 'err' | 'warn' | 'info', title: string, detail = ''): void {
    const ic = kind === 'ok' ? 'circle-check' : kind === 'err' ? 'circle-x' : kind === 'warn' ? 'triangle-alert' : 'info';
    const x = h('button', { class: 'icon-btn icon-btn-sm', 'aria-label': 'Dismiss', html: iconSvg('x') });
    const el = h('div', { class: `toast ${kind}`, role: 'status' }, icon(ic), h('div', { class: 't' }, title), x, detail ? h('div', { class: 'd' }, detail) : null);
    x.addEventListener('click', () => el.remove());
    this.toasts.append(el); setTimeout(() => el.remove(), 5000);
  }
  palette(): void { if (this.paletteOpen) return; this.paletteOpen = true; closeMenu(); openPalette(this.cmds, () => { this.paletteOpen = false; }); }
  private onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.palette(); return; }
    if (this.paletteOpen || isTyping(e)) return;
    const k = (e.ctrlKey ? 'Ctrl ' : '') + (e.shiftKey && e.key.length > 1 ? 'Shift ' : '') + (e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
    const c = this.cmds.list.find((x) => x.keys === k || (x.keys && x.keys.split(' / ').includes(k)));
    if (c && (c.enabled?.() ?? true)) {
      if (c.keys === 'Space' && (e.target as HTMLElement)?.tagName === 'BUTTON') return; // Space on a focused button presses it
      e.preventDefault(); this.cmds.run(c.id);
    }
  }

  private chooseFile(accept: string): Promise<File | null> {
    return new Promise((res) => {
      const i = h('input', { type: 'file', accept, class: 'sr-only' }); document.body.append(i);
      i.addEventListener('change', () => { res(i.files?.[0] ?? null); i.remove(); });
      i.click();
    });
  }
  async grabNow(): Promise<void> {
    const g = await this.source.grab(this.view.playhead).catch((e) => { this.toast('err', 'Grab failed', String(e)); return null; });
    if (!g) { this.toast('warn', 'No picture to grab', this.source.state === 'unlinked' ? 'No console linked.' : 'This recording has no grab at or before this picture.'); return; }
    this.view.grabB = this.view.grabA && this.view.grabA !== g ? this.view.grabA : this.view.grabB;
    this.view.grabA = g; this.view.bump();
    this.toast('ok', `Grabbed picture ${g.n}`, this.source.kind === 'replay' ? 'From the recording (replay). Set as A in Capture.' : 'From the console. Set as A in Capture.');
  }
  exportGrab(which: 'a' | 'b' = 'a'): void {
    const g = which === 'a' ? this.view.grabA ?? this.store.grabAt(this.view.playhead) : this.view.grabB;
    if (!g) { this.toast('warn', 'No grab to export'); return; }
    const cv = grabCanvas(g, () => this.exportGrab(which)); if (!cv) return;
    cv.toBlob((b) => b && download(`grab-${this.store.meta?.id ?? 'session'}-${g.n}.png`, b), 'image/png');
  }

  private registerCommands(): void {
    const C = this.cmds; const replay = () => this.source instanceof ReplaySource; const hasData = () => this.store.maxN > 0;
    WORKSPACES.forEach((w, i) => C.add({ id: `ws.${w.id}`, title: `Go to ${w.label} workspace`, group: 'Workspaces', icon: w.icon, keys: String(i + 1), run: () => this.setWorkspace(w.id) }));
    PAGES.forEach((p, i) => C.add({ id: `page.${p.id}`, title: `Go to ${p.label}`, group: 'Workspaces', icon: p.icon, keys: String(WORKSPACES.length + i + 1), run: () => this.openPage(p.id) }));
    C.add({ id: 'setup.open', title: 'Set up a console', group: 'Link', icon: 'sparkles', run: () => this.openSetup() });
    C.add(
      { id: 'build.pick', title: 'Pick a build to view (its newest session)', group: 'Builds', icon: 'git-commit-horizontal', run: () => void this.pickBuild(this.status) },
      { id: 'build.refs', title: 'Compare grabs with another build (adds its grabs as references)', group: 'Builds', icon: 'git-compare', enabled: hasData, run: () => void this.pickBuild(this.status, 'refs') },
    );
    C.add(
      { id: 'play.toggle', title: 'Play or pause', group: 'Timeline', icon: 'play', keys: 'Space', enabled: () => this.source.kind !== 'idle', run: () => this.togglePlay() },
      { id: 'step.next', title: 'Step one picture', group: 'Timeline', icon: 'step-forward', keys: '.', enabled: () => this.source.kind !== 'idle', run: () => this.step(1) },
      { id: 'step.prev', title: 'Back one picture', group: 'Timeline', icon: 'step-back', keys: ',', enabled: hasData, run: () => this.step(-1) },
      { id: 'go.start', title: 'Playhead to the first picture', group: 'Timeline', icon: 'skip-back', keys: 'Home', enabled: hasData, run: () => this.setPlayhead(1) },
      { id: 'go.end', title: 'Playhead to the newest picture', group: 'Timeline', icon: 'skip-forward', keys: 'End', enabled: hasData, run: () => this.setPlayhead(this.store.maxN, true) },
      { id: 'follow.toggle', title: 'Follow the newest picture', group: 'Timeline', icon: 'skip-forward', keys: 'F', enabled: hasData, run: () => { this.view.follow = !this.view.follow; this.view.bump(); } },
      { id: 'go.picture', title: 'Go to picture...', group: 'Timeline', icon: 'hash', ask: { label: 'Picture number', placeholder: 'e.g. 178', parse: (v) => parseInt(v, 10) }, enabled: hasData, run: (n) => this.setPlayhead(n as number) },
      { id: 'go.slowest', title: 'Go to the slowest picture', group: 'Timeline', icon: 'timer', enabled: hasData, run: () => { const s = this.store.slowestBusy(1)[0]; if (s) this.setPlayhead(s); } },
      { id: 'go.nextover', title: 'Go to the next picture over budget', group: 'Timeline', icon: 'triangle-alert', keys: 'N', enabled: hasData, run: () => this.nextOver() },
      { id: 'go.nextgap', title: 'Go to the next gap (missing pictures)', group: 'Timeline', icon: 'link-2-off', enabled: () => this.store.gaps().length > 0, run: () => { const g = this.store.gaps().find(([a]) => a > this.view.playhead) ?? this.store.gaps()[0]; if (g) this.setPlayhead(g[0]); } },
      { id: 'zoom.reset', title: 'Show the whole session (reset zoom)', group: 'Timeline', icon: 'zoom-out', keys: 'Z', enabled: () => !!this.view.zoom, run: () => this.view.set('zoom', null) },
    );
    for (const sp of [0.25, 0.5, 1, 2, 4]) C.add({ id: `speed.${sp}`, title: `Replay speed ${sp}x`, group: 'Timeline', icon: 'fast-forward', enabled: replay, run: () => this.source.setSpeed(sp) });
    C.add(
      { id: 'grab', title: 'Grab the console screen', group: 'Capture', icon: 'camera', keys: 'G', enabled: () => this.source.kind !== 'idle', run: () => this.grabNow() },
      { id: 'grab.export', title: 'Export grab A as PNG', group: 'Capture', icon: 'download', keys: 'E', enabled: hasData, run: () => this.exportGrab('a') },
      { id: 'grab.exportb', title: 'Export grab B as PNG', group: 'Capture', icon: 'download', enabled: () => !!this.view.grabB, run: () => this.exportGrab('b') },
      { id: 'grab.swap', title: 'Swap grabs A and B', group: 'Capture', icon: 'redo-2', enabled: () => !!this.view.grabB, run: () => { const a = this.view.grabA; this.view.grabA = this.view.grabB; this.view.grabB = a; this.view.bump(); } },
      { id: 'compare.side', title: 'Compare side by side', group: 'Capture', icon: 'columns-2', run: () => this.view.set('compare', 'side') },
      { id: 'compare.diff', title: 'Compare as a difference', group: 'Capture', icon: 'diff', run: () => this.view.set('compare', 'diff') },
      { id: 'compare.wipe', title: 'Compare with a wipe', group: 'Capture', icon: 'split', run: () => this.view.set('compare', 'wipe') },
      { id: 'theme.toggle', title: 'Switch light or dark theme', group: 'View', icon: 'sun', keys: 'T', run: () => this.applyTheme(this.theme === 'dark' ? 'light' : 'dark') },
      { id: 'area.split.right', title: 'Split the focused area right', group: 'Areas', icon: 'square-split-horizontal', keys: 'Ctrl \\', enabled: () => !!this.focused, run: () => this.focused && this.split(this.focused, 'row') },
      { id: 'area.split.down', title: 'Split the focused area down', group: 'Areas', icon: 'square-split-vertical', enabled: () => !!this.focused, run: () => this.focused && this.split(this.focused, 'col') },
      { id: 'area.max', title: 'Maximize or restore the focused area', group: 'Areas', icon: 'maximize-2', keys: 'Ctrl M', enabled: () => !!this.focused, run: () => this.focused && this.toggleMax(this.focused) },
      { id: 'area.close', title: 'Close the focused area', group: 'Areas', icon: 'x', enabled: () => !!this.focused && !this.isRoot(this.focused), run: () => this.focused && this.close(this.focused) },
      { id: 'area.next', title: 'Focus the next area', group: 'Areas', icon: 'arrow-right', keys: 'Ctrl ]', run: () => this.focusNext() },
      { id: 'layout.reset', title: 'Reset this workspace layout', group: 'Areas', icon: 'rotate-ccw', run: () => this.resetLayout() },
    );
    for (const d of EDITORS) if (d.group !== 'Home') C.add({ id: `editor.${d.id}`, title: `Show ${d.title} in the focused area`, group: 'Editors', icon: d.icon, enabled: () => !!this.focused, run: () => this.focused && this.setEditor(this.focused, d.id) });
    C.add(
      { id: 'link.retry', title: 'Retry the link now', group: 'Link', icon: 'refresh-cw', keys: 'R', enabled: () => this.source.state === 'lost' || (this.source.kind === 'live' && this.source.state === 'unlinked'), run: () => this.source.retryNow() },
      { id: 'link.connect', title: 'Connect to a bridge...', group: 'Link', icon: 'plug', ask: { label: 'Bridge address', placeholder: 'http://127.0.0.1:52080', parse: (v) => (/^https?:\/\/\S+$/.test(v || 'http://127.0.0.1:52080') ? v || 'http://127.0.0.1:52080' : undefined) }, run: (u) => this.connect(u as string) },
      { id: 'link.local', title: 'Connect to the bridge on this PC', group: 'Link', icon: 'cable', run: () => this.connect(this.opt.bridge ?? 'http://127.0.0.1:52080') },
      { id: 'link.disconnect', title: 'Disconnect (no console linked)', group: 'Link', icon: 'link-2-off', enabled: () => this.source.kind !== 'idle', run: async () => { const last = this.source instanceof ReplaySource ? this.source : null; await this.setSource(new IdleSource(last)); } },
      { id: 'link.simloss', title: 'Simulate a lost link (replay demo)', group: 'Link', icon: 'wifi-off', enabled: replay, run: async () => { const r = await ReplaySource.fromUrl(this.opt.demoUrl, { lossAt: Math.max(2, this.store.maxN + 30) }); await this.setSource(r); r.seek(this.store.maxN || 1); r.play(); } },
      { id: 'session.demo', title: 'Open the demo recording', group: 'Sessions', icon: 'history', run: () => this.openDemo() },
      { id: 'session.open', title: 'Open a session file...', group: 'Sessions', icon: 'folder-open', keys: 'Ctrl O', run: async () => {
        const q = desktop(); let name = '', text = '';
        if (q) { const [f] = await q.openFiles('session').catch((e) => { this.toast('err', 'Could not open the file', String(e)); return []; }); if (!f) return; name = f.name; text = new TextDecoder().decode(f.bytes); }
        else { const f = await this.chooseFile('.jsonl,.ndjson,application/x-ndjson'); if (!f) return; name = f.name; text = await f.text(); }
        try { const r = new ReplaySource(parseSession(text), { label: name }); await this.setSource(r); if (this.pageId) this.setWorkspace('link'); } catch (e) { this.toast('err', `Could not open ${name}`, String(e)); } } },
      { id: 'console.pause', title: 'Pause the console', group: 'Console', icon: 'pause', enabled: () => this.source.kind === 'live', run: () => this.source.pause() },
      { id: 'console.resume', title: 'Resume the console', group: 'Console', icon: 'play', enabled: () => this.source.kind === 'live', run: () => this.source.play() },
      { id: 'console.warp', title: 'Warp to a preset...', group: 'Console', icon: 'crosshair', enabled: () => this.source.kind === 'live', ask: { label: 'Preset name the game registered', placeholder: 'e.g. start', parse: (v) => v || undefined }, run: async (p) => { const r = await this.source.command({ cmd: 'warp', preset: String(p) }); this.toast(r.ok ? 'ok' : 'err', r.ok ? `Warped to ${String(p)}` : 'Warp failed', r.error ?? ''); } },
      { id: 'runs.push', title: 'Push a build and run it...', group: 'Runs', icon: 'rocket', keys: 'Ctrl U', enabled: () => this.source.kind !== 'idle', run: async () => { const q = desktop(); if (q) { const [f] = await q.openFiles('build').catch(() => []); if (f) await this.pushBuild({ name: f.name, bytes: f.bytes }); return; } const f = await this.chooseFile('.elf,.bin,application/octet-stream'); if (f) await this.pushBuild(f); } },
      { id: 'memory.goto', title: 'Memory: go to address...', group: 'Debug', icon: 'binary', ask: { label: 'Address (hex)', placeholder: '8C010000', parse: (v) => { const n = parseInt(v.replace(/^0x/i, ''), 16); return Number.isNaN(n) ? undefined : n; } }, run: (a) => { this.setWorkspace('debug'); this.view.set('memAddr', a as number); } },
    );
  }
  /** Push arguments, remembered per program file name (newest last, at most 50 names). */
  private pushArgs: [string, string][] = store('pushArgs', []);
  /** the next push's arguments: the ones remembered for this file, else the ones last typed for a new file */
  argsFor(name: string): string { return this.pushArgs.find(([n]) => n === name)?.[1] ?? store('pushArgsNew', ''); }
  setArgsFor(name: string, args: string): void {
    if (!name) { save('pushArgsNew', args); return; }
    this.pushArgs = [...this.pushArgs.filter(([n]) => n !== name), [name, args] as [string, string]].slice(-50); save('pushArgs', this.pushArgs); save('pushArgsNew', args);
  }
  async pushBuild(f: File | { name: string; bytes: Uint8Array }): Promise<void> {
    const args = this.argsFor(f.name); this.setArgsFor(f.name, args);
    try { const r = await this.source.pushBuild(f, { args }); this.view.set('run', r.id); this.toast('info', `Pushed ${r.file}`, `${r.bytes.toLocaleString('en-GB')} B, sha256 ${r.sha256.slice(0, 12)}, ${r.state}${args ? `, arguments: ${args}` : ''}`); }
    catch (e) { this.toast('err', 'Push failed', String(e)); }
  }
  private nextOver(): void {
    const st = this.store; const ph = st.phases.filter((p) => p.budget && !p.total);
    for (let n = this.view.playhead + 1; n <= st.maxN; n++) if (ph.some((p) => st.value(p.key, n) > p.budget!)) { this.setPlayhead(n); return; }
    this.toast('info', 'No picture over budget after this one');
  }
  private focusNext(): void { if (!this.areas.length) return; const i = this.focused ? this.areas.indexOf(this.focused) : -1; const a = this.areas[(i + 1) % this.areas.length]; this.focus(a); a.titleBtn.focus(); }
  /** for tests: the current layout tree */
  get layoutTree(): LNode { return this.layout; }
  findArea(id: string): boolean { return !!findLeaf(this.layout, id); }
}
