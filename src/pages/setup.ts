// Set up a console: the first-run flow, in the app's own look. Short steps, each skippable, progress on the left,
// resumable (kept in this app's storage), reachable again from Settings and the command palette.
// Steps that need the real bridge (dc-qalink 0.2) run against the mock bridge today and say so in the hand-back.
import type { App } from '../ui/app';
import { ENDPOINTS, uiRun, type C1Run, type C1Still, type Discovery, type RunRecord } from '../data/bridge-api';
import type { GrabRecord } from '../data/format';
import { bbytes, bget, bpost, discovery } from '../data/bridge-client';
import { desktop, type AppInfo, type NetIf, type ProgramStatus } from '../platform/desktop';
import { download, esc, h, iconSvg, save, store } from '../ui/dom';
import { btn } from '../editors/base';
import { deskOnly, mcpSnippets, snippet, switchEl } from './settings';
import type { Page } from './page';

export type StepId = 'welcome' | 'connection' | 'loader' | 'flycast' | 'find' | 'test' | 'agents' | 'done';
interface SetupState { step: StepId; console: boolean; flycast: boolean; transport: 'bba' | 'modem'; done: StepId[]; skipped: StepId[]; finished: boolean }
const fresh = (): SetupState => ({ step: 'welcome', console: true, flycast: false, transport: 'bba', done: [], skipped: [], finished: false });
export const setupState = (): SetupState => ({ ...fresh(), ...store<Partial<SetupState>>('setup', {}) });
const TITLES: Record<StepId, [string, string]> = {
  welcome: ['Welcome', 'What you will link'], connection: ['Connection', 'Adapter or modem, this PC\'s network'], loader: ['The loader disc', 'Once, on the SD card or a disc'],
  flycast: ['Flycast', 'Point at flycast.exe'], find: ['Find the console', 'Wait for the loader\'s beacon'], test: ['First test', 'Push, run, grab the screen'],
  agents: ['Agents', 'Optional: MCP for Claude Code or Codex'], done: ['Done', 'Into the Link workspace'],
};

type FindState = { kind: 'nobridge' | 'waiting' | 'seen' | 'linking' | 'linked'; address?: string; ip?: string; device?: string; label?: string };
type TestState = { kind: 'idle' | 'running' | 'passed' | 'failed'; run?: RunRecord; grab?: GrabRecord; error?: string };

export class SetupPage implements Page {
  el = h('div', { class: 'page' });
  private s: SetupState; private v = 0; private built = '';
  private info: AppInfo | null = null; private nets: NetIf[] = []; private fly: ProgramStatus | null = null; private flyDir = ''; private mcpOn = false;
  private find: FindState = { kind: 'waiting' }; private poll = 0; private test: TestState = { kind: 'idle' };
  private offProg: (() => void) | null = null;
  constructor(private app: App, at?: StepId) {
    this.s = setupState(); if (at && TITLES[at]) this.s.step = at;
    if (!this.steps().includes(this.s.step)) this.s.step = 'welcome';
    const q = desktop();
    if (q) {
      void Promise.all([q.info(), q.networkInterfaces(), q.programs(), q.settings()]).then(([i, n, p, st]) => { this.info = i; this.nets = n; this.fly = p.find((x) => x.id === 'flycast') ?? null; this.flyDir = st.flycastPrepared; this.mcpOn = st.mcpLocal; this.v++; });
      this.offProg = q.onProgram((p) => { if (p.id === 'flycast') { this.fly = p; this.v++; } });
    }
    this.poll = window.setInterval(() => { if (this.s.step === 'find') void this.discover(); }, 1000);
    if (this.s.step === 'find') void this.discover();
  }
  destroy(): void { clearInterval(this.poll); this.offProg?.(); }
  private persist(): void { save('setup', this.s); this.v++; }
  steps(): StepId[] { return ['welcome', ...(this.s.console ? ['connection', 'loader'] as StepId[] : []), ...(this.s.flycast ? ['flycast'] as StepId[] : []), 'find', 'test', 'agents', 'done']; }
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
      const d: Discovery = await discovery(this.app.bridgeUrl);
      const want = this.s.console ? 'console' : 'flycast';
      // the one the bridge linked by itself (autoconnect) first, then the kind the person set up
      const hit = d.seen.find((x) => x.chosen) ?? d.seen.find((x) => x.kind === want) ?? (this.s.flycast ? d.seen.find((x) => x.kind === 'flycast') : undefined);
      const nk: FindState = hit ? { kind: hit.chosen && this.app.source.kind === 'live' ? 'linked' : 'seen', address: hit.address, ip: hit.address, device: hit.id, label: hit.kind === 'console' ? `Dreamcast, ${hit.transport === 'bba' ? 'broadband adapter' : 'modem'}` : 'Flycast on this PC' } : { kind: 'waiting' };
      if (nk.kind !== this.find.kind || nk.address !== this.find.address) { this.find = nk; this.v++; }
    } catch { if (this.find.kind !== 'nobridge') { this.find = { kind: 'nobridge' }; this.v++; } }
  }
  private async link(): Promise<void> {
    if (!this.find.device) return; this.find = { ...this.find, kind: 'linking' }; this.v++;
    try { await bpost(this.app.bridgeUrl, ENDPOINTS.link, { console_ip: this.find.ip, device: this.find.device }); this.find = { ...this.find, kind: 'linked' }; if (this.app.source.kind !== 'live') await this.app.connect(this.app.bridgeUrl); }
    catch (e) { this.find = { ...this.find, kind: 'seen' }; this.app.toast('err', 'Could not link', String(e)); }
    this.v++;
  }
  private async startBridge(): Promise<void> {
    const q = desktop(); if (!q) return;
    try { await q.startProgram('bridge'); this.app.toast('ok', 'Bridge started', 'Listening for the console.'); setTimeout(() => void this.discover(), 800); }
    catch (e) { this.app.toast('err', 'Could not start the bridge', String(e)); }
  }
  async runTest(): Promise<void> {
    this.test = { kind: 'running' }; this.v++;
    try {
      // the bridge's self test pushes dc-qalink's test program, which sends one picture of its screen and its report
      let c1 = await bpost<C1Run>(this.app.bridgeUrl, ENDPOINTS.selftest, {}, 30000); let r = uiRun(c1); this.test = { kind: 'running', run: r }; this.v++;
      const end = Date.now() + 120000;
      while (['queued', 'sending', 'running'].includes(c1.state) && Date.now() < end) { await new Promise((x) => setTimeout(x, 500)); c1 = await bget<C1Run>(this.app.bridgeUrl, ENDPOINTS.run(c1.id)); r = uiRun(c1); this.test = { kind: 'running', run: r }; this.v++; }
      let g: GrabRecord | undefined;
      if (c1.stills.length) {
        const st = await bget<C1Still>(this.app.bridgeUrl, `${ENDPOINTS.still(c1.stills[0])}.json`);
        const png = await bbytes(this.app.bridgeUrl, ENDPOINTS.still(st.id));
        let b = ''; for (let i = 0; i < png.bytes.length; i += 0x8000) b += String.fromCharCode(...png.bytes.subarray(i, i + 0x8000));
        g = { t: 'grab', n: st.picture, w: st.width, h: st.height, fmt: 'png', data: btoa(b), label: `still ${st.id} (${st.tier})` } as GrabRecord;
      }
      this.test = { kind: r.state === 'passed' && g ? 'passed' : 'failed', run: r, grab: g, error: r.state === 'passed' ? (g ? '' : 'No picture came back.') : `The test program ended "${c1.state}"${c1.error ? `: ${c1.error}` : ''}.` };
    } catch (e) { this.test = { ...this.test, kind: 'failed', error: String(e) }; }
    this.v++;
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
    const k = `${this.v}|${this.app.themeV}`; if (k === this.built) return; this.built = k;
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
        const choice = (key: 'console' | 'flycast', ic: string, t: string, d: string) => {
          const c = h('button', { class: 'choice', 'aria-pressed': String(this.s[key]), html: iconSvg(ic, 20) }, h('span', { class: 't' }, t), h('span', { class: 'box', html: this.s[key] ? iconSvg('check') : '' }), h('span', { class: 'd' }, d));
          c.addEventListener('click', () => { this.s[key] = !this.s[key]; this.persist(); }); return c;
        };
        return [lead('QA Link Cloud links this PC to a Dreamcast while it runs: push a build, watch its timings live, grab its screen, warp, pause and step. It works offline, on this PC\'s network.'),
          h('div', { class: 'section-title' }, 'What will you link? Pick one or both.'),
          h('div', { class: 'choice-grid' }, choice('console', 'gamepad-2', 'A real Dreamcast', 'With the broadband adapter or a modem through the DreamPi. You will put the loader disc on its SD card once.'), choice('flycast', 'monitor', 'Flycast on this PC', 'Quick to start, no hardware. The app runs Flycast with its own copy of the settings it needs.')),
          h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'Every step can be skipped and done later from Settings, or with Ctrl K, "Set up a console".')];
      }
      case 'connection': {
        const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'How the console connects' });
        for (const [t, l] of [['bba', 'Broadband adapter'], ['modem', 'Modem, through the DreamPi']] as const) { const b = h('button', { class: this.s.transport === t ? 'is-on' : '', 'aria-pressed': String(this.s.transport === t) }, l); b.addEventListener('click', () => { this.s.transport = t; this.persist(); }); seg.append(b); }
        const lan = this.nets.find((n) => n.lan);
        const t = h('table', { class: 'table dense' });
        t.innerHTML = `<thead><tr><th>This PC's network</th><th>Address</th><th></th></tr></thead><tbody>${this.nets.filter((n) => n.family === 'IPv4').slice(0, 6).map((n) => `<tr${n === lan ? ' class="is-selected"' : ''}><td><span class="ellipsis">${esc(n.name)}</span></td><td class="mono">${esc(n.address)}</td><td>${n === lan ? `<span class="pill ok">${iconSvg('check')}picked: the local network</span>` : n.internal ? '<span class="pill">this PC only</span>' : n.virtual ? '<span class="pill">virtual, not used</span>' : '<span class="pill">not used</span>'}</td></tr>`).join('')}</tbody>`;
        return [lead(this.s.transport === 'bba' ? 'Plug the broadband adapter into the same router as this PC (or straight into this PC). The bridge listens for the console on the local network.' : 'The DreamPi answers the modem\'s call and passes it to this PC over the local network. The modem is slow: you get a summary each second, not every picture.'),
          seg,
          q ? (this.nets.length ? h('div', { class: 'card' }, h('div', { class: 'card-body flush' }, t)) : h('div', { class: 'faint' }, 'Reading this PC\'s network...')) : h('div', { class: 'callout', html: iconSvg('app-window') }, h('p', null, 'The desktop app lists this PC\'s network and picks the one the console can reach. On the web page, the bridge picks it.')),
          call('shield', 'warn', h('b', null, 'One Windows question may appear. '), 'When the bridge first listens for the console, Windows can ask whether QA Link Cloud may use networks. Tick ', h('b', null, 'Private networks'), ', leave Public unticked, and choose ', h('b', null, 'Allow'), '. The app changes no firewall settings itself.')];
      }
      case 'loader': return [
        lead('The loader is a small program the Dreamcast boots from the SD card once. It waits for builds from this PC, runs them, and comes back when they end, so you never swap cards again.'),
        h('div', { class: 'ctl-row' }, btn('Save the loader disc...', () => void this.saveLoader(), { primary: true, icon: 'disc-3' }), h('span', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'You pick the folder. The image comes from the bridge.')),
        h('div', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('hard-drive') }, h('h2', null, 'Put it on the SD card (GDEMU)')),
          h('div', { class: 'card-body' }, h('ol', { class: 'steps-ol' },
            h('li', null, 'Open the ', h('b', null, 'openMenu builder'), ' (GDMenu Card Manager) with the SD card in this PC.'),
            h('li', null, h('b', null, 'Add'), ' the loader disc image you saved, and give it the name ', h('b', null, 'QA Link loader'), '.'),
            h('li', null, 'Press ', h('b', null, 'Save'), ' so the builder rebuilds the menu, then eject the card.'),
            h('li', null, 'Put the card in the GDEMU, start the Dreamcast and pick ', h('b', null, 'QA Link loader'), '.')))),
        call('info', '', 'No GDEMU? Burn the same image to a CD-R instead. ', h('b', null, 'The app never writes an SD card or a disc itself.'))];
      case 'flycast': {
        const st = this.fly;
        return [lead('Point the app at flycast.exe. The app keeps its own copy of the settings it needs (the broadband adapter switched on) in its own folder, and never changes your own Flycast settings.'),
          q ? h('div', { class: 'card' }, h('div', { class: 'card-body' },
            h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'flycast.exe'), h('div', { class: 'd mono' }, st?.configured ? st.detail : 'not chosen yet')), h('div', { class: 'ctl' }, btn(st?.configured ? 'Change' : 'Choose flycast.exe', async () => { this.fly = await q.chooseFlycast(); this.v++; }, { small: true, icon: 'folder-open' }))),
            h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'The app\'s Flycast settings'), h('div', { class: 'd mono' }, this.flyDir || 'not made yet')), h('div', { class: 'ctl' }, btn(this.flyDir ? 'Made' : 'Make them', async () => { const r = await q.prepareFlycast(); this.flyDir = r.dir; this.v++; A.toast('ok', 'Flycast settings ready', r.note); }, { small: true, icon: 'settings', disabled: !!this.flyDir }))),
            h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Start Flycast'), h('div', { class: 'd' }, 'Then load the loader disc image in it.')), h('div', { class: 'ctl' }, st?.running ? h('span', { class: 'pill ok' }, `running, pid ${st.pid}`) : btn('Start', () => void q.startProgram('flycast').catch((e) => A.toast('err', 'Could not start Flycast', String(e))), { small: true, icon: 'play', disabled: !st?.configured || !this.flyDir })))))
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
        const t = this.test; const r = t.run?.report;
        const left = h('div', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('rocket') }, h('h2', null, 'Test program'), h('span', { class: 'meta' }, t.run ? `${t.run.file}, ${t.run.state}` : 'qalink-test.elf')),
          h('div', { class: 'card-body' }, t.run ? h('dl', { class: 'kv' }, h('dt', null, 'Sent'), h('dd', null, `${t.run.bytes.toLocaleString('en-GB')} B, hash ${t.run.sha256.slice(0, 12)} checked`), h('dt', null, 'State'), h('dd', null, t.run.state),
            ...(r ? [h('dt', null, 'Ran'), h('dd', null, `${r.seconds} s, ${r.pictures} pictures, exit ${r.exit}`), ...r.numbers.flatMap((x) => [h('dt', null, x.label), h('dd', null, `${x.value} ${x.unit}`)]), h('dt', null, 'Tier'), h('dd', null, r.tier)] : []))
            : h('div', { class: 'faint' }, 'A small program from the bridge: it draws a test picture, reports its timings and returns to the loader.')));
        const right = h('div', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('camera') }, h('h2', null, 'Screen grab'), h('span', { class: 'meta' }, t.grab ? `picture ${t.grab.n}, ${t.grab.w}x${t.grab.h}` : '')),
          h('div', { class: 'card-body' }, h('div', { class: 'test-grab' }, t.grab?.data ? h('img', { src: `data:image/png;base64,${t.grab.data}`, alt: 'The console\'s picture' }) : t.kind === 'running' ? 'Running...' : 'The picture appears here.')));
        const verdict = t.kind === 'passed' ? h('div', { class: 'verdict ok', html: iconSvg('circle-check', 20) }, h('span', null, h('b', null, 'Passed. '), 'The console ran the test program, reported back and sent its picture.'))
          : t.kind === 'failed' ? h('div', { class: 'verdict err', html: iconSvg('circle-x', 20) }, h('span', null, h('b', null, 'Failed. '), t.error ?? '', ' Check the steps on "Find the console", then run it again.')) : null;
        return [lead('Push the small test program, run it, read its report and grab the screen. If this passes, the link works end to end. On the broadband adapter it takes about 15 seconds: the push about 1 s, the run and report about 10 s, the grab under 1 s.'),
          h('div', { class: 'ctl-row' }, btn(t.kind === 'idle' ? 'Run the test' : 'Run it again', () => void this.runTest(), { primary: true, icon: 'play', disabled: t.kind === 'running' })),
          verdict, h('div', { class: 'test-grid' }, left, right)];
      }
      case 'agents': {
        const sn = mcpSnippets(this.info);
        return [lead('Optional. Agents such as Claude Code or Codex on this PC can use the console as tools: push and run a build, grab the screen, read the live summary, warp, pause and step.'),
          h('div', { class: 'card' }, h('div', { class: 'card-body' }, h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Local MCP'), h('div', { class: 'd' }, 'Tools at the "control" level: they can read and steer, not push code. Raise it in the command line on purpose.')),
            h('div', { class: 'ctl' }, q ? switchEl(this.mcpOn, 'Local MCP', async (v) => { await q.setSetting('mcpLocal', v); this.mcpOn = v; this.v++; }) : deskOnly())))),
          snippet(A, 'Claude Code: run once in a terminal', sn.claude), snippet(A, 'Codex: add to ~/.codex/config.toml', sn.codex),
          h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'The remote link stays off: when on, it lets a browser elsewhere and cloud agents reach this console through QA Link Cloud. Settings has the switch.')];
      }
      case 'done': {
        const items: [string, string][] = [
          [this.s.console ? 'gamepad-2' : 'monitor', [this.s.console ? `A real Dreamcast, ${this.s.transport === 'bba' ? 'broadband adapter' : 'modem through the DreamPi'}` : '', this.s.flycast ? 'Flycast on this PC' : ''].filter(Boolean).join(' and ')],
          ['radio', this.find.kind === 'linked' ? `Linked to ${this.find.address}` : 'Not linked yet: the Link workspace links when the console calls'],
          ['rocket', this.test.kind === 'passed' ? 'First test passed' : 'First test not run'],
          ['bot', this.mcpOn ? 'Local MCP on' : 'Agents: off (Settings has it)'],
        ];
        return [lead('That is all. The Link workspace is the home of the app: live timings, the console\'s screen, the log and the timeline.'),
          h('ul', { class: 'check-ul' }, ...items.map(([ic, t]) => h('li', { html: iconSvg(ic) }, t))),
          h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'Run this again any time: Settings, or Ctrl K, "Set up a console".')];
      }
    }
  }
}
