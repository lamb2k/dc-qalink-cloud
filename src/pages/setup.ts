// Set up a console: the first-run flow, in the app's own look. Short steps, each skippable, progress on the left,
// resumable (kept in this app's storage), reachable again from Settings and the command palette.
// The order: how the Dreamcast is connected (adapter, modem through the DreamPi, or Flycast only); where the builds are
// (adapter and Flycast: that folder is all the console sees, or the bundled sample game; the modem has no network disc);
// the network and the loader on the SD card; find the console; the first run (push the sample, live data, a grab); and
// what to try next (swap the texture, the menu, the crash button, RESET). Settings keeps every answer editable.
import type { App } from '../ui/app';
import { ENDPOINTS, uiDiscovery, uiRun, type C1Discovery, type C1Run, type C1Still, type Discovery, type LiveSummary, type PadStep, type RunRecord } from '../data/bridge-api';
import type { GrabRecord } from '../data/format';
import { bbytes, bget, bpost, pushProgram, sendCommand } from '../data/bridge-client';
import { desktop, type AppInfo, type BuildsInfo, type Connection, type NetIf, type ProgramStatus } from '../platform/desktop';
import { download, esc, h, iconSvg, save, store } from '../ui/dom';
import { btn } from '../editors/base';
import { deskOnly, mcpSnippets, snippet, switchEl } from './settings';
import type { Page } from './page';

export type StepId = 'welcome' | 'builds' | 'connection' | 'loader' | 'flycast' | 'find' | 'test' | 'agents' | 'done';
interface SetupState { step: StepId; kind: Connection; console: boolean; flycast: boolean; transport: 'bba' | 'modem'; done: StepId[]; skipped: StepId[]; finished: boolean }
const fresh = (): SetupState => ({ step: 'welcome', kind: 'bba', console: true, flycast: false, transport: 'bba', done: [], skipped: [], finished: false });
/** the one line on why the modem gets no network disc (also on Settings) */
export const MODEM_NO_DISC = 'Over the modem, builds are pushed and run, but the network disc is skipped: the modem is too slow to read a disc through.';
const LOADER_URL = 'https://github.com/lamb2k/dc-qalink/releases';
export const setupState = (): SetupState => ({ ...fresh(), ...store<Partial<SetupState>>('setup', {}) });
const TITLES: Record<StepId, [string, string]> = {
  welcome: ['Connection', 'How your Dreamcast connects'], builds: ['Your builds', 'The folder the console sees'], connection: ['Network', 'This PC\'s network'], loader: ['The loader disc', 'Once, on the SD card or a disc'],
  flycast: ['Flycast', 'Point at flycast.exe'], find: ['Find the console', 'Wait for the loader\'s beacon'], test: ['First run', 'Push the sample, live data, a grab'],
  agents: ['Agents', 'Optional: MCP for Claude Code or Codex'], done: ['Try it', 'What to try next'],
};

// heard: the address the bridge hears the loader from (what its own auto-link chooses by; for Flycast, this PC's)
type FindState = { kind: 'nobridge' | 'waiting' | 'seen' | 'linking' | 'linked'; address?: string; ip?: string; heard?: string; device?: string; label?: string };
type TestState = { kind: 'idle' | 'running' | 'passed' | 'failed'; run?: RunRecord; grab?: GrabRecord; error?: string; summary?: LiveSummary; times?: Record<string, number>; program?: string };
type TryState = { busy: string; line: string; grab?: GrabRecord; crash?: { pc: string; pr: string; event: string } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// what the first run and "Try it" found, kept outside the page: the page is made again when the app goes live (and on
// every visit), and work under way keeps reporting into this
const live = { v: 0, find: { kind: 'waiting' } as FindState, test: { kind: 'idle' } as TestState, tryIt: { busy: '', line: '' } as TryState, runId: '' };

export class SetupPage implements Page {
  el = h('div', { class: 'page' });
  private s: SetupState; private v = 0; private built = '';
  private info: AppInfo | null = null; private nets: NetIf[] = []; private fly: ProgramStatus | null = null; private flyDir = ''; private mcpOn = false;
  private poll = 0;
  private get find(): FindState { return live.find; } private set find(f: FindState) { live.find = f; }
  private get test(): TestState { return live.test; } private set test(t: TestState) { live.test = t; }
  private get tryIt(): TryState { return live.tryIt; } private set tryIt(t: TryState) { live.tryIt = t; }
  private get runId(): string { return live.runId; } private set runId(r: string) { live.runId = r; }
  private bump(): void { this.v++; live.v++; }
  private offProg: (() => void) | null = null;
  private builds: BuildsInfo | null = null;
  constructor(private app: App, at?: StepId) {
    this.s = setupState(); if (!this.s.kind) this.s.kind = this.s.flycast && !this.s.console ? 'flycast' : this.s.transport;
    if (at && TITLES[at]) this.s.step = at;
    if (!this.steps().includes(this.s.step)) this.s.step = 'welcome';
    const q = desktop();
    if (q) {
      void Promise.all([q.info(), q.networkInterfaces(), q.programs(), q.settings(), q.builds()]).then(([i, n, p, st, b]) => { this.info = i; this.nets = n; this.fly = p.find((x) => x.id === 'flycast') ?? null; this.flyDir = st.flycastPrepared; this.mcpOn = st.mcpLocal; this.builds = b; this.bump(); });
      this.offProg = q.onProgram((p) => { if (p.id === 'flycast') { this.fly = p; this.bump(); } });
    }
    this.poll = window.setInterval(() => { if (this.s.step === 'find') void this.discover(); }, 1000);
    if (this.s.step === 'find') void this.discover();
  }
  destroy(): void { clearInterval(this.poll); this.offProg?.(); }
  private persist(): void { save('setup', this.s); this.bump(); }
  /** the modem has no builds step: builds are pushed only, the network disc is skipped (MODEM_NO_DISC) */
  steps(): StepId[] { return ['welcome', ...(this.s.kind !== 'modem' ? ['builds'] as StepId[] : []), ...(this.s.console ? ['connection', 'loader'] as StepId[] : []), ...(this.s.flycast ? ['flycast'] as StepId[] : []), 'find', 'test', 'agents', 'done']; }
  private setKind(k: Connection): void {
    this.s.kind = k; this.s.console = k !== 'flycast'; this.s.flycast = k === 'flycast'; if (k !== 'flycast') this.s.transport = k; this.persist();
    const q = desktop(); if (q) void q.setSetting('connection', k).then(() => q.builds()).then((b) => { this.builds = b; this.bump(); });
  }
  private async pickBuilds(sample: boolean): Promise<void> {
    const q = desktop(); if (!q) return;
    try { this.builds = sample ? await q.useSample() : await q.chooseBuilds(); this.bump(); if (this.builds.root) this.app.toast('ok', sample ? 'The sample game is your builds folder' : 'Builds folder chosen', 'Only this folder is shared with the console.'); }
    catch (e) { this.app.toast('err', 'Could not use that folder', String(e)); }
  }
  go(step: StepId): void { this.s.step = step; this.persist(); if (step === 'find') void this.discover(); }
  private next(skip = false): void {
    const st = this.steps(); const i = st.indexOf(this.s.step);
    const list = skip ? 'skipped' : 'done'; const other = skip ? 'done' : 'skipped';
    if (!this.s[list].includes(this.s.step)) this.s[list].push(this.s.step); this.s[other] = this.s[other].filter((x) => x !== this.s.step);
    this.go(st[Math.min(st.length - 1, i + 1)]);
  }
  private back(): void { const st = this.steps(); this.go(st[Math.max(0, st.indexOf(this.s.step) - 1)]); }

  // ---- bridge work
  private async discover(): Promise<void> {
    if (this.find.kind === 'linking' || this.find.kind === 'linked') return;
    try {
      const raw = await bget<C1Discovery>(this.app.bridgeUrl, ENDPOINTS.discovery, 1500); const d: Discovery = uiDiscovery(raw);
      const want = this.s.console ? 'console' : 'flycast';
      // the one the bridge linked by itself (autoconnect) first, then the kind the person set up
      const hit = d.seen.find((x) => x.chosen) ?? d.seen.find((x) => x.kind === want) ?? (this.s.flycast ? d.seen.find((x) => x.kind === 'flycast') : undefined);
      if (hit?.chosen && this.app.source.kind !== 'live') void this.app.connect(this.app.bridgeUrl);
      const nk: FindState = hit ? { kind: hit.chosen ? 'linked' : 'seen', address: hit.address, ip: hit.address, heard: raw.seen.find((x) => x.id === hit.id)?.address, device: hit.id, label: hit.kind === 'console' ? `Dreamcast, ${hit.transport === 'bba' ? 'broadband adapter' : 'modem'}` : 'Flycast on this PC' } : { kind: 'waiting' };
      if (nk.kind !== this.find.kind || nk.address !== this.find.address) { this.find = nk; this.bump(); }
    } catch { if (this.find.kind !== 'nobridge') { this.find = { kind: 'nobridge' }; this.bump(); } }
  }
  private async link(): Promise<void> {
    if (!this.find.device) return; this.find = { ...this.find, kind: 'linking' }; this.bump();
    try { await bpost(this.app.bridgeUrl, ENDPOINTS.link, { address: this.find.heard ?? this.find.ip, device: this.find.device }); this.find = { ...this.find, kind: 'linked' }; if (this.app.source.kind !== 'live') await this.app.connect(this.app.bridgeUrl); }
    catch (e) { this.find = { ...this.find, kind: 'seen' }; this.app.toast('err', 'Could not link', String(e)); }
    this.bump();
  }
  private async startBridge(): Promise<void> {
    const q = desktop(); if (!q) return;
    try { await q.startProgram('bridge'); this.app.toast('ok', 'Bridge started', 'Listening for the console.'); setTimeout(() => void this.discover(), 800); }
    catch (e) { this.app.toast('err', 'Could not start the bridge', String(e)); }
  }
  /** the first run: the builds folder's program (the sample first) pushed, live data read, the screen grabbed */
  async runFirst(): Promise<void> {
    const q = desktop(); const B = this.app.bridgeUrl;
    if (!q || !this.builds?.root) return this.runTest();
    this.test = { kind: 'running', times: {} }; this.bump();
    const t0 = performance.now(); const times: Record<string, number> = {}; const mark = (k: string) => { times[k] = Math.round(performance.now() - t0) / 1000; };
    try {
      const b = await q.builds(); this.builds = b;
      const name = b.programs.includes('demo3d.elf') ? 'demo3d.elf' : b.programs[0];
      if (!name) throw new Error('There is no program (.elf) in the builds folder.');
      const f = await q.readBuild(name);
      if (this.app.source.kind !== 'live') await this.app.connect(B);
      let r = await pushProgram(B, name, f.bytes, {}); mark('pushed'); this.runId = r.id; this.test = { kind: 'running', run: r, times, program: name }; this.bump();
      const end = Date.now() + 60000;
      while (['queued', 'pushing'].includes(r.state) && Date.now() < end) { await sleep(250); r = uiRun(await bget<C1Run>(B, ENDPOINTS.run(r.id))); }
      if (r.state !== 'running') throw new Error(`The program ended "${r.bridgeState}" before it ran${r.error ? `: ${r.error}` : ''}.`);
      mark('running'); this.test = { ...this.test, run: r }; this.bump();
      let sm: LiveSummary | undefined;
      for (let i = 0; i < 40 && !(sm && sm.pictures > 60); i++) { await sleep(250); try { sm = await bget<LiveSummary>(B, ENDPOINTS.summary); } catch { /* not yet */ } }
      if (!sm || !sm.pictures) throw new Error('No live data came back.');
      mark('live'); this.test = { ...this.test, summary: sm }; this.bump();
      const g = await this.grab(); mark('grab');
      this.test = { kind: g ? 'passed' : 'failed', run: r, grab: g, summary: sm, times, program: name, error: g ? '' : 'No picture came back.' };
      this.tryIt = { ...this.tryIt, grab: g };
    } catch (e) { this.test = { ...this.test, kind: 'failed', error: String((e as Error).message ?? e), times }; }
    this.bump();
  }
  private async grab(): Promise<GrabRecord | undefined> {
    const B = this.app.bridgeUrl;
    // the client reads the shown frame buffer in pieces: the game paused for the read keeps the picture whole
    // a program just started links a moment after its first pictures: "no program linked" (409) is tried again for 10 s
    let st: C1Still | undefined;
    for (let i = 0; !st; i++) {
      const paused = (await sendCommand(B, { cmd: 'pause' }).catch(() => ({ ok: false }))).ok;
      try { await sleep(100); st = await bpost<C1Still>(B, ENDPOINTS.stills, {}, 40000); }
      catch (e) { if (i >= 20 || !/no program linked/.test(String((e as Error).message))) throw e; await sleep(400); }
      finally { if (paused) await sendCommand(B, { cmd: 'resume' }).catch(() => undefined); }
    }
    const png = await bbytes(B, ENDPOINTS.still(st.id));
    let b = ''; for (let i = 0; i < png.bytes.length; i += 0x8000) b += String.fromCharCode(...png.bytes.subarray(i, i + 0x8000));
    return { t: 'grab', n: st.picture, w: st.width, h: st.height, fmt: 'png', data: btoa(b), label: `still ${st.id} (${st.tier})` } as GrabRecord;
  }
  // ---- what to try next (the done page): each one a few seconds on the adapter
  private async tryRun(label: string, fn: () => Promise<string>): Promise<void> {
    this.tryIt = { ...this.tryIt, busy: label, line: `${label}...` }; this.bump();
    const t0 = performance.now();
    try { const line = await fn(); this.tryIt = { ...this.tryIt, busy: '', line: `${line} (${((performance.now() - t0) / 1000).toFixed(1)} s)` }; }
    catch (e) { this.tryIt = { ...this.tryIt, busy: '', line: `${label}: ${String((e as Error).message ?? e)}` }; }
    this.bump();
  }
  private async pad(steps: PadStep[]): Promise<void> { const r = await sendCommand(this.app.bridgeUrl, { cmd: 'pad', steps }); if (!r.ok) throw new Error(r.error ?? 'the program refused the pad'); }
  private async waitRun(id: string, states: string[], ms: number): Promise<C1Run> {
    const end = Date.now() + ms; let r = await bget<C1Run>(this.app.bridgeUrl, ENDPOINTS.run(id));
    while (!states.includes(r.state) && Date.now() < end) { await sleep(250); r = await bget<C1Run>(this.app.bridgeUrl, ENDPOINTS.run(id)); }
    return r;
  }
  private async reset(): Promise<string> {
    const r = await bpost<{ ok: boolean; rung?: string; way_back?: string; run?: string }>(this.app.bridgeUrl, ENDPOINTS.reset, { level: 'return' }, 60000);
    if (!r.ok) throw new Error('RESET did not bring the loader back');
    for (let i = 0; i < 80; i++) { try { const st = await bget<{ link: string; active_run: string | null }>(this.app.bridgeUrl, ENDPOINTS.status); if (st.link === 'up' && !st.active_run) break; } catch { /* the bridge is busy */ } await sleep(250); }
    return `RESET: back at the loader (${r.rung ?? 'reset'}${r.way_back ? `, ${r.way_back}` : ''})`;
  }
  private async pushAgain(): Promise<string> {
    const st = await bget<{ active_run: string | null }>(this.app.bridgeUrl, ENDPOINTS.status);
    if (st.active_run) await this.reset();
    await this.runFirst();
    if (this.test.kind !== 'passed') throw new Error(this.test.error || 'the push did not pass');
    return `Pushed ${this.test.program} again: running ${this.test.times?.running ?? '?'} s, grab ${this.test.times?.grab ?? '?'} s after the push`;
  }
  async runTest(): Promise<void> {
    this.test = { kind: 'running' }; this.bump();
    try {
      // the bridge's self test pushes dc-qalink's test program, which sends one picture of its screen and its report
      let c1 = await bpost<C1Run>(this.app.bridgeUrl, ENDPOINTS.selftest, {}, 30000); let r = uiRun(c1); this.test = { kind: 'running', run: r }; this.bump();
      const end = Date.now() + 120000;
      while (['queued', 'sending', 'running'].includes(c1.state) && Date.now() < end) { await new Promise((x) => setTimeout(x, 500)); c1 = await bget<C1Run>(this.app.bridgeUrl, ENDPOINTS.run(c1.id)); r = uiRun(c1); this.test = { kind: 'running', run: r }; this.bump(); }
      let g: GrabRecord | undefined;
      if (c1.stills.length) {
        const st = await bget<C1Still>(this.app.bridgeUrl, `${ENDPOINTS.still(c1.stills[0])}.json`);
        const png = await bbytes(this.app.bridgeUrl, ENDPOINTS.still(st.id));
        let b = ''; for (let i = 0; i < png.bytes.length; i += 0x8000) b += String.fromCharCode(...png.bytes.subarray(i, i + 0x8000));
        g = { t: 'grab', n: st.picture, w: st.width, h: st.height, fmt: 'png', data: btoa(b), label: `still ${st.id} (${st.tier})` } as GrabRecord;
      }
      this.test = { kind: r.state === 'passed' && g ? 'passed' : 'failed', run: r, grab: g, error: r.state === 'passed' ? (g ? '' : 'No picture came back.') : `The test program ended "${c1.state}"${c1.error ? `: ${c1.error}` : ''}.` };
    } catch (e) { this.test = { ...this.test, kind: 'failed', error: String(e) }; }
    this.bump();
  }
  private async saveLoader(): Promise<void> {
    try {
      const { name, bytes } = await bbytes(this.app.bridgeUrl, ENDPOINTS.loader);
      const q = desktop();
      if (q) { const r = await q.saveFile('loader', name, bytes); if (r.saved) this.app.toast('ok', `Saved ${r.name}`, 'Now put it on the SD card (the steps below).'); }
      else download(name, new Blob([bytes as BlobPart]));
    } catch (e) { this.app.toast('err', 'The bridge did not hand over the loader disc', `${String(e)}. Start the bridge first.`); }
  }
  private finish(): void {
    this.s.finished = true; if (!this.s.done.includes('done')) this.s.done.push('done'); this.persist();
    if (this.app.source.kind !== 'live') void this.app.connect(this.app.bridgeUrl);
    this.app.setWorkspace('link');
  }

  frame(): void {
    const k = `${this.v}|${live.v}|${this.app.themeV}`; if (k === this.built) return; this.built = k;
    const st = this.steps(); const i = st.indexOf(this.s.step);
    const doneN = st.filter((x) => this.s.done.includes(x)).length;
    const rail = h('nav', { class: 'setup-rail', 'aria-label': 'Set-up steps' },
      h('div', { class: 'prog' }, h('span', null, `Step ${i + 1} of ${st.length} · ${doneN} done${this.s.skipped.length ? `, ${this.s.skipped.filter((x) => st.includes(x)).length} skipped` : ''}`), h('div', { class: 'meter' }, h('i', { style: `width:${((i + 1) / st.length) * 100}%` }))));
    st.forEach((id, n) => {
      const cls = `step-item${id === this.s.step ? ' is-current' : ''}${this.s.done.includes(id) ? ' is-done' : ''}${this.s.skipped.includes(id) ? ' is-skipped' : ''}`;
      const b = h('button', { class: cls, 'aria-current': id === this.s.step ? 'step' : null, html: `<span class="n">${this.s.done.includes(id) ? iconSvg('check') : n + 1}</span>` }, h('span', null, TITLES[id][0], h('span', { class: 's' }, this.s.skipped.includes(id) ? 'skipped' : TITLES[id][1])));
      b.addEventListener('click', () => this.go(id)); rail.append(b);
    });
    const main = h('section', { class: 'setup-main', 'aria-live': 'polite' }, ...this.body(this.s.step));
    const last = this.s.step === 'done';
    const foot = h('div', { class: 'setup-foot' },
      i > 0 ? btn('Back', () => this.back(), { icon: 'arrow-left' }) : null, h('span', { class: 'grow' }),
      !last && this.s.step !== 'welcome' ? btn('Skip this step', () => this.next(true), { ghost: true }) : null,
      last ? btn('Open the Link workspace', () => this.finish(), { primary: true, icon: 'link-2' }) : btn(this.s.step === 'welcome' ? 'Start' : 'Continue', () => this.next(), { primary: true, icon: 'arrow-right', disabled: this.s.step === 'welcome' && !this.s.console && !this.s.flycast }));
    main.append(foot);
    const head = h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Set up a console'), h('h1', null, TITLES[this.s.step][0])),
      h('div', { class: 'actions' }, btn('Close', () => { this.persist(); this.app.setWorkspace('link'); }, { ghost: true, icon: 'x' })));
    this.el.replaceChildren(head, h('div', { class: 'setup' }, rail, main));
  }

  private body(step: StepId): (HTMLElement | null)[] {
    const A = this.app; const q = desktop();
    const lead = (t: string) => h('p', { class: 'lead' }, t);
    const call = (ic: string, cls: string, ...kids: (Node | string)[]) => h('div', { class: `callout ${cls}`, html: iconSvg(ic) }, h('p', null, ...kids));
    switch (step) {
      case 'welcome': {
        const choice = (k: Connection, ic: string, t: string, d: string) => {
          const on = this.s.kind === k;
          const c = h('button', { class: 'choice', 'aria-pressed': String(on), 'data-kind': k, html: iconSvg(ic, 20) }, h('span', { class: 't' }, t), h('span', { class: 'box', html: on ? iconSvg('check') : '' }), h('span', { class: 'd' }, d));
          c.addEventListener('click', () => this.setKind(k)); return c;
        };
        return [lead('DC QA Link Cloud links this PC to a Dreamcast while it runs: push a build, watch its timings live, grab its screen, warp, pause and step. It works offline, on this PC\'s network.'),
          h('div', { class: 'section-title' }, 'How is your Dreamcast connected?'),
          h('div', { class: 'choice-grid three' },
            choice('bba', 'cable', 'Broadband adapter', 'The fastest: live data every picture, and builds can read their disc from this PC.'),
            choice('modem', 'plug', 'Modem with a DreamPi', 'Pushes builds and sends a summary each second. Slower: no network disc.'),
            choice('flycast', 'monitor', 'Flycast only', 'No hardware: Flycast on this PC with its broadband adapter switched on.')),
          h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'Every step can be skipped and done later from Settings, or with Ctrl K, "Set up a console".')];
      }
      case 'builds': {
        const b = this.builds;
        const where = b?.root ? (b.sample ? 'The sample game (your own copy in the app\'s folder)' : b.root) : 'not chosen yet';
        return [lead('Where do you keep your builds? Pick the folder your Dreamcast programs and their disc files are built into. The bridge serves it to the console: programs to push, files under /pc, and the network disc, so a changed file shows on the next push with no SD card change.'),
          q ? h('div', { class: 'card' }, h('div', { class: 'card-body' },
            h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Builds folder'), h('div', { class: 'd mono', 'data-root': b?.root ?? '' }, where)),
              h('div', { class: 'ctl' }, btn(b?.root && !b.sample ? 'Change...' : 'Choose a folder...', () => void this.pickBuilds(false), { small: true, icon: 'folder-open' }))),
            h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Start with the sample game'), h('div', { class: 'd' }, 'A small 3D game from dc-qalink (example/demo3d): a craft, a tiled floor, cubes to collect. Its texture and model load from the network disc, so you can change them here and see it on the next push.')),
              h('div', { class: 'ctl' }, b?.sample ? h('span', { class: 'pill ok', html: `${iconSvg('check')}in use` }) : btn('Use the sample', () => void this.pickBuilds(true), { small: true, icon: 'gamepad-2', primary: !b?.root, disabled: !b?.sampleAvailable }))),
            b?.root ? h('div', { class: 'faint', style: 'font-size:var(--fs-xs)', 'data-programs': b.programs.join(' ') }, `Programs found: ${b.programs.length ? b.programs.join(', ') : 'none yet'}.`) : null))
            : h('div', { class: 'callout', html: iconSvg('app-window') }, h('p', null, 'Choosing a folder needs the desktop app. On the web page, start the bridge with --files, --overlay and --asset-root naming your builds folder.')),
          call('shield', 'ok', h('b', null, 'Only this folder is shared with the console. '), 'Nothing else on this PC can be opened from it.')];
      }
      case 'connection': {
        const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'How the console connects' });
        for (const [t, l] of [['bba', 'Broadband adapter'], ['modem', 'Modem, through the DreamPi']] as const) { const b = h('button', { class: this.s.transport === t ? 'is-on' : '', 'aria-pressed': String(this.s.transport === t) }, l); b.addEventListener('click', () => this.setKind(t)); seg.append(b); }
        const lan = this.nets.find((n) => n.lan);
        const t = h('table', { class: 'table dense' });
        t.innerHTML = `<thead><tr><th>This PC's network</th><th>Address</th><th></th></tr></thead><tbody>${this.nets.filter((n) => n.family === 'IPv4').slice(0, 6).map((n) => `<tr${n === lan ? ' class="is-selected"' : ''}><td><span class="ellipsis">${esc(n.name)}</span></td><td class="mono">${esc(n.address)}</td><td>${n === lan ? `<span class="pill ok">${iconSvg('check')}picked: the local network</span>` : n.internal ? '<span class="pill">this PC only</span>' : n.virtual ? '<span class="pill">virtual, not used</span>' : '<span class="pill">not used</span>'}</td></tr>`).join('')}</tbody>`;
        return [lead(this.s.transport === 'bba' ? 'Plug the broadband adapter into the same router as this PC (or straight into this PC). The bridge listens for the console on the local network.' : 'The DreamPi answers the modem\'s call and passes it to this PC over the local network. The modem is slow: you get a summary each second, not every picture.'),
          seg,
          this.s.transport === 'modem' ? call('info', '', h('b', null, 'No network disc. '), MODEM_NO_DISC) : null,
          q ? (this.nets.length ? h('div', { class: 'card' }, h('div', { class: 'card-body flush' }, t)) : h('div', { class: 'faint' }, 'Reading this PC\'s network...')) : h('div', { class: 'callout', html: iconSvg('app-window') }, h('p', null, 'The desktop app lists this PC\'s network and picks the one the console can reach. On the web page, the bridge picks it.')),
          call('shield', 'warn', h('b', null, 'One Windows question may appear. '), 'When the bridge first listens for the console, Windows can ask whether DC QA Link Cloud may use networks. Tick ', h('b', null, 'Private networks'), ', leave Public unticked, and choose ', h('b', null, 'Allow'), '. The app changes no firewall settings itself.')];
      }
      case 'loader': return [
        lead('The loader is a small program the Dreamcast boots from the SD card once. It waits for builds from this PC, runs them, and comes back when they end, so you never swap cards again.'),
        h('div', { class: 'ctl-row' }, btn('Save the loader disc...', () => void this.saveLoader(), { primary: true, icon: 'disc-3' }), h('span', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'You pick the folder. The image comes from the bridge.')),
        snippet(A, 'Or download the loader disc (the dc-qalink releases page)', LOADER_URL),
        h('div', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('hard-drive') }, h('h2', null, 'Put it on the SD card (GDEMU)')),
          h('div', { class: 'card-body' }, h('ol', { class: 'steps-ol' },
            h('li', null, 'Put the GDEMU\'s SD card in this PC and open the card manager that builds its ', h('b', null, 'openMenu'), ' (GDMenu Card Manager).'),
            h('li', null, h('b', null, 'Add'), ' the loader disc image you saved, and give it the name ', h('b', null, 'QA Link loader'), '.'),
            h('li', null, 'Press ', h('b', null, 'Save'), ' so the builder rebuilds the menu, then eject the card.'),
            h('li', null, 'Put the card in the GDEMU, start the Dreamcast and pick ', h('b', null, 'QA Link loader'), '.')))),
        call('info', '', 'No GDEMU? Burn the same image to a CD-R instead. ', h('b', null, 'The app never writes an SD card or a disc itself.'))];
      case 'flycast': {
        const st = this.fly;
        return [lead('Point the app at flycast.exe. The app keeps its own copy of the settings it needs (the broadband adapter switched on) in its own folder, and never changes your own Flycast settings.'),
          q ? h('div', { class: 'card' }, h('div', { class: 'card-body' },
            h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'flycast.exe'), h('div', { class: 'd mono' }, st?.configured ? st.detail : 'not chosen yet')), h('div', { class: 'ctl' }, btn(st?.configured ? 'Change' : 'Choose flycast.exe', async () => { this.fly = await q.chooseFlycast(); this.bump(); }, { small: true, icon: 'folder-open' }))),
            h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'The app\'s Flycast settings'), h('div', { class: 'd mono' }, this.flyDir || 'not made yet')), h('div', { class: 'ctl' }, btn(this.flyDir ? 'Made' : 'Make them', async () => { const r = await q.prepareFlycast(); this.flyDir = r.dir; this.bump(); A.toast('ok', 'Flycast settings ready', r.note); }, { small: true, icon: 'settings', disabled: !!this.flyDir }))),
            h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Start Flycast'), h('div', { class: 'd' }, 'Starts the bridge first, then Flycast: load the loader disc image in it.')), h('div', { class: 'ctl' }, st?.running ? h('span', { class: 'pill ok' }, `running, pid ${st.pid}`) : btn('Start', () => void q.startProgram('flycast').catch((e) => A.toast('err', 'Could not start Flycast', String(e))), { small: true, icon: 'play', disabled: !st?.configured || !this.flyDir })))))
            : h('div', { class: 'callout', html: iconSvg('app-window') }, h('p', null, 'Starting Flycast needs the desktop app. On the web page, start Flycast yourself with the loader disc and the broadband adapter on.'))];
      }
      case 'find': {
        const f = this.find; const busy = f.kind === 'waiting' || f.kind === 'linking';
        const big = f.kind === 'nobridge' ? 'The bridge is not running' : f.kind === 'waiting' ? 'Waiting for the loader\'s beacon' : f.kind === 'seen' ? `Seen at ${f.address}` : f.kind === 'linking' ? `Linking to ${f.address}` : `Linked: ${f.label}`;
        const sub = f.kind === 'nobridge' ? `Nothing answers at ${A.bridgeUrl}.` : f.kind === 'waiting' ? `Listening on this PC's network${this.nets.find((n) => n.lan) ? ` (${this.nets.find((n) => n.lan)!.address})` : ''}. Start the loader on the console.` : f.kind === 'seen' ? `${f.label}, loader answering.` : f.kind === 'linking' ? 'Asking the loader to link.' : `${f.address}. Live data flows to the Link workspace.`;
        const pill = f.kind === 'linked' ? `<span class="pill ok">${iconSvg('circle-check')}linked</span>` : f.kind === 'seen' ? `<span class="pill info">${iconSvg('radio')}seen</span>` : f.kind === 'nobridge' ? `<span class="pill err">${iconSvg('circle-x')}no bridge</span>` : `<span class="pill warn">${iconSvg('loader-circle', 16, 'spin')}waiting</span>`;
        const act = f.kind === 'seen' ? btn('Link', () => void this.link(), { primary: true, icon: 'link-2' }) : f.kind === 'nobridge' ? (q ? btn('Start the bridge', () => void this.startBridge(), { primary: true, icon: 'play' }) : h('span', { class: 'mono faint', style: 'font-size:var(--fs-xs)' }, 'npm run bridge')) : null;
        return [lead('Start the loader on the console (or Flycast). It calls out on the local network every second; the bridge hears it and the app shows it here.'),
          h('div', { class: 'live-state', html: iconSvg(f.kind === 'linked' ? 'circle-check' : busy ? 'loader-circle' : f.kind === 'nobridge' ? 'server' : 'radio', 20, busy ? 'spin' : '') }, h('div', null, h('div', { class: 'big' }, big, ' ', h('span', { html: pill })), h('div', { class: 'sub' }, sub)), act),
          h('details', { class: 'card', open: f.kind !== 'linked' }, h('summary', { class: 'card-head', html: iconSvg('list-checks') }, h('h2', null, 'Not found?')),
            h('div', { class: 'card-body' }, h('ul', { class: 'check-ul' },
              ...[['cable', 'The network cable is in the broadband adapter and in the router (or this PC).'], ['circle-dot', 'The adapter\'s link light is on.'], ['wifi', 'This PC is on the same network as the console, not a guest or VPN network.'], ['tv', 'The loader\'s screen shows its address, the PC it heard and a beacon count. The address should start like this PC\'s; a count that stays at 0 means the beacon is not reaching this PC.'], ['shield', 'If Windows asked about networks, Private networks was allowed.']].map(([ic, t]) => h('li', { html: iconSvg(ic) }, t)))))];
      }
      case 'test': {
        const t = this.test; const r = t.run?.report; const first = !!(q && this.builds?.root);
        const sm = t.summary; const frame = sm?.phases.find((p) => p.key === 'frame') ?? sm?.phases[sm.phases.length - 1];
        const left = h('div', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('rocket') }, h('h2', null, first ? 'The sample game' : 'Test program'), h('span', { class: 'meta' }, t.run ? `${t.run.file}, ${t.run.state}` : first ? (this.builds?.programs.includes('demo3d.elf') ? 'demo3d.elf' : this.builds?.programs[0] ?? 'no program') : 'qalink-test.elf')),
          h('div', { class: 'card-body' }, t.run ? h('dl', { class: 'kv', 'data-first-run': t.kind }, h('dt', null, 'Sent'), h('dd', null, `${t.run.bytes.toLocaleString('en-GB')} B, hash ${t.run.sha256.slice(0, 12)} checked`), h('dt', null, 'State'), h('dd', null, t.run.state),
            ...(t.times ? Object.entries(t.times).map(([k, v]) => [h('dt', null, k === 'pushed' ? 'Pushed' : k === 'running' ? 'Running' : k === 'live' ? 'Live data' : 'Grab'), h('dd', null, `${v.toFixed(1)} s after the push began`)]).flat() : []),
            ...(sm ? [h('dt', null, 'Pictures'), h('dd', null, sm.pictures.toLocaleString('en-GB')), ...(frame ? [h('dt', null, frame.label), h('dd', null, `${frame.mean.toFixed(2)} ms mean, worst ${frame.worst.toFixed(2)} ms`)] : []), ...sm.guards.map((g) => [h('dt', null, g.name), h('dd', null, String(g.value))]).flat(), h('dt', null, 'Tier'), h('dd', null, sm.tier)] : []),
            ...(r ? [h('dt', null, 'Ran'), h('dd', null, `${r.seconds} s, ${r.pictures} pictures, exit ${r.exit}`), ...r.numbers.flatMap((x) => [h('dt', null, x.label), h('dd', null, `${x.value} ${x.unit}`)])] : []))
            : h('div', { class: 'faint' }, first ? 'Pushes the program from your builds folder, waits for its live data and grabs its screen. It keeps running: the next page has things to try with it.' : 'A small program from the bridge: it draws a test picture, reports its timings and returns to the loader.')));
        const right = h('div', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('camera') }, h('h2', null, 'Screen grab'), h('span', { class: 'meta' }, t.grab ? `picture ${t.grab.n}, ${t.grab.w}x${t.grab.h}` : '')),
          h('div', { class: 'card-body' }, h('div', { class: 'test-grab' }, t.grab?.data ? h('img', { src: `data:image/png;base64,${t.grab.data}`, alt: 'The console\'s picture' }) : t.kind === 'running' ? 'Running...' : 'The picture appears here.')));
        const verdict = t.kind === 'passed' ? h('div', { class: 'verdict ok', html: iconSvg('circle-check', 20) }, h('span', null, h('b', null, 'Passed. '), first ? 'The console runs your build, sends live data and its picture.' : 'The console ran the test program, reported back and sent its picture.'))
          : t.kind === 'failed' ? h('div', { class: 'verdict err', html: iconSvg('circle-x', 20) }, h('span', null, h('b', null, 'Failed. '), t.error ?? '', ' Check the steps on "Find the console", then run it again.')) : null;
        return [lead(first ? 'Push the program from your builds folder, read its live data and grab its screen. On the broadband adapter this takes a few seconds.' : 'Push the small test program, run it, read its report and grab the screen. If this passes, the link works end to end. On the broadband adapter it takes about 15 seconds: the push about 1 s, the run and report about 10 s, the grab under 1 s.'),
          h('div', { class: 'ctl-row' }, btn(t.kind === 'idle' ? (first ? 'Push and run' : 'Run the test') : 'Run it again', () => void this.runFirst(), { primary: true, icon: 'play', disabled: t.kind === 'running' })),
          verdict, h('div', { class: 'test-grid' }, left, right)];
      }
      case 'agents': {
        const sn = mcpSnippets(this.info);
        return [lead('Optional. Agents such as Claude Code or Codex on this PC can use the console as tools: push and run a build, grab the screen, read the live summary, warp, pause and step.'),
          h('div', { class: 'card' }, h('div', { class: 'card-body' }, h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Local MCP'), h('div', { class: 'd' }, 'Tools at the "control" level: they can read and steer, not push code. Raise it in the command line on purpose.')),
            h('div', { class: 'ctl' }, q ? switchEl(this.mcpOn, 'Local MCP', async (v) => { await q.setSetting('mcpLocal', v); this.mcpOn = v; this.bump(); }) : deskOnly())))),
          snippet(A, 'Claude Code: run once in a terminal', sn.claude), snippet(A, 'Codex: add to ~/.codex/config.toml', sn.codex),
          h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'The remote link stays off: when on, it lets a browser elsewhere and cloud agents reach this console through DC QA Link Cloud. Settings has the switch.')];
      }
      case 'done': {
        const items: [string, string][] = [
          [this.s.console ? 'gamepad-2' : 'monitor', this.s.kind === 'flycast' ? 'Flycast on this PC' : `A real Dreamcast, ${this.s.kind === 'bba' ? 'broadband adapter' : 'modem through the DreamPi'}`],
          ['folder-open', this.s.kind === 'modem' ? 'Builds pushed only: no network disc over the modem' : this.builds?.root ? `Builds folder: ${this.builds.sample ? 'the sample game' : this.builds.root}` : 'No builds folder yet (Settings has it)'],
          ['radio', this.find.kind === 'linked' ? `Linked to ${this.find.address}` : 'Not linked yet: the Link workspace links when the console calls'],
          ['rocket', this.test.kind === 'passed' ? 'First run passed' : 'First run not done'],
        ];
        const T = this.tryIt; const busy = !!T.busy; const live = this.test.kind === 'passed';
        const row = (ic: string, t: string, d: string, b: HTMLElement | null) => h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l', html: iconSvg(ic) + esc(t) }), h('div', { class: 'd' }, d)), h('div', { class: 'ctl' }, b));
        const card = h('div', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('sparkles') }, h('h2', null, 'Try it'), h('span', { class: 'meta', 'data-try': T.line }, T.line)),
          h('div', { class: 'card-body' },
            this.builds?.sample ? row('image', 'Swap the texture', 'The floor is DEMO3D/FLOOR.BMP in the builds folder: paint it in any program, or swap in the second floor here. The next push shows it, no SD card change.', btn('Swap the floor', () => void this.tryRun('Swap', async () => { const r = await desktop()!.swapSampleTexture(); return `${r.changed} changed on this PC (${r.bytes.toLocaleString('en-GB')} B): push again to see it`; }), { small: true, disabled: busy })) : null,
            row('upload', 'Push again', 'RESET, push the build again and grab the screen.', btn('Push again', () => void this.tryRun('Push again', () => this.pushAgain()), { small: true, disabled: busy || !q })),
            row('menu', 'Open the menu', 'On the pad: L + R + START. The QA Link menu shows the link, the log, a snapshot and the game\'s own page.', btn('Open it from here', () => void this.tryRun('Menu', async () => { await this.pad([{ buttons: ['START'], lt: 1, rt: 1, frames: 20 }, { buttons: [], frames: 20 }]); await sleep(1200); this.tryIt.grab = await this.grab(); return 'The menu is open on the console'; }), { small: true, disabled: busy || !live })),
            row('triangle-alert', 'The crash button', 'In the menu: R to the Demo page, then A on "Crash now". The run comes back crashed, with its report and the registers.', btn('Press it from here', () => void this.tryRun('Crash', async () => {
              const run = this.runId; await this.pad([{ buttons: [], rt: 1, frames: 12 }, { buttons: [], frames: 12 }]); await sleep(600); await this.pad([{ buttons: ['A'], frames: 12 }, { buttons: [], frames: 12 }]);
              const r = await this.waitRun(run, ['crashed', 'done', 'lost', 'timeout', 'reset'], 60000); const c = r.crash ?? r.summary?.crash;
              if (c) this.tryIt.crash = { pc: c.pc, pr: c.pr, event: c.event };
              return r.state === 'crashed' ? `Crashed, as asked: event ${c?.event ?? '?'}, PC ${c?.pc ?? '?'}, PR ${c?.pr ?? '?'}; the loader is back` : `The run ended "${r.state}"`; }), { small: true, disabled: busy || !live })),
            row('rotate-ccw', 'RESET', 'Brings the console back to the loader from any program, ready for the next push.', btn('RESET', () => void this.tryRun('RESET', () => this.reset()), { small: true, disabled: busy || !q })),
            T.grab?.data ? h('div', { class: 'test-grab' }, h('img', { src: `data:image/png;base64,${T.grab.data}`, alt: 'The console\'s picture' })) : null));
        return [lead('That is all. The Link workspace is the home of the app: live timings, the console\'s screen, the log and the timeline. Here are a few things to try with the sample first.'),
          h('ul', { class: 'check-ul' }, ...items.map(([ic, t]) => h('li', { html: iconSvg(ic) }, t))), card,
          h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'Run this again any time: Settings, or Ctrl K, "Set up a console".')];
      }
    }
  }
}
