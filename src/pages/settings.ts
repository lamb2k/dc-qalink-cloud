// Settings: devices, the bridge and Flycast (programs the desktop app starts), the remote link switch (designed with
// its four states; nothing connects anywhere yet), agents (MCP), appearance, this PC's network, about.
import type { App } from '../ui/app';
import { BRIDGE_API_VERSION, ENDPOINTS, uiDevice, type C1Device, type DeviceInfo } from '../data/bridge-api';
import { bget, DEFAULT_BRIDGE } from '../data/bridge-client';
import { SESSION_FORMAT_VERSION } from '../data/format';
import { MCP_TOOLS, MCP_TOOLS_VERSION } from '../data/mcp-tools';
import { desktop, type AppInfo, type AppSettings, type BuildsInfo, type Connection, type NetIf, type ProgramStatus } from '../platform/desktop';
import { MODEM_NO_DISC } from './setup';
import { esc, h, iconSvg, save, store } from '../ui/dom';
import { btn, empty } from '../editors/base';
import type { Page } from './page';

export type RemoteState = 'off' | 'connecting' | 'on' | 'refused';
export const remote = { state: (new URLSearchParams(location.search).get('remote') as RemoteState) || 'off', reason: '', v: 0 };
if (!['off', 'connecting', 'on', 'refused'].includes(remote.state)) remote.state = 'off';
if (remote.state === 'refused') remote.reason = 'No DC QA Link Cloud account is set up on this PC yet (milestone L3b).';
export function setRemote(on: boolean): void {
  if (!on) { remote.state = 'off'; remote.reason = ''; remote.v++; return; }
  remote.state = 'connecting'; remote.reason = ''; remote.v++;
  setTimeout(() => { if (remote.state !== 'connecting') return; remote.state = 'refused'; remote.reason = 'No DC QA Link Cloud account is set up on this PC yet (milestone L3b). Nothing left this PC.'; remote.v++; }, 1600);
}

export function mcpSnippets(info: AppInfo | null): { claude: string; codex: string } {
  const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const m = info?.mcp ?? { command: 'python', args: ['<dc-qalink>/pc/qalink_bridge.py', '--mcp', 'stdio', '--bridge', DEFAULT_BRIDGE, '--mcp-level', 'control'], env: {} };
  const env = Object.entries(m.env);
  const claude = `claude mcp add qalink${env.map(([k, v]) => ` -e ${k}=${v}`).join('')} -- ${[m.command, ...m.args].map(q).join(' ')}`;
  const codex = `[mcp_servers.qalink]\ncommand = ${JSON.stringify(m.command)}\nargs = [${m.args.map((a) => JSON.stringify(a)).join(', ')}]${env.length ? `\nenv = { ${env.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }` : ''}`;
  return { claude, codex };
}
export function snippet(app: App, label: string, text: string): HTMLElement {
  const copy = h('button', { class: 'icon-btn icon-btn-sm', title: 'Copy', 'aria-label': `Copy the ${label} snippet`, html: iconSvg('copy') });
  copy.addEventListener('click', () => { void navigator.clipboard?.writeText(text).then(() => app.toast('ok', `Copied the ${label} snippet`)); });
  return h('div', { class: 'snippet' }, h('pre', null, h('span', { class: 'lbl' }, label), text), copy);
}
export function switchEl(on: boolean, label: string, run: (v: boolean) => void, opt: { busy?: boolean; refused?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
  const s = h('button', { class: `switch${opt.busy ? ' is-busy' : ''}${opt.refused ? ' is-refused' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': label, disabled: !!opt.disabled });
  s.addEventListener('click', () => run(!on));
  return s;
}
export const deskOnly = () => h('span', { class: 'desk-only', html: iconSvg('app-window') }, 'In the desktop app');

export class SettingsPage implements Page {
  el = h('div', { class: 'page' });
  private v = 0; private built = '';
  private info: AppInfo | null = null; private settings: AppSettings | null = null; private progs: ProgramStatus[] = []; private nets: NetIf[] = [];
  private devices: DeviceInfo[] | null = null; private devFor = ''; private builds: BuildsInfo | null = null;
  private off: (() => void) | null = null;
  constructor(private app: App) {
    const q = desktop();
    if (q) {
      void Promise.all([q.info(), q.settings(), q.programs(), q.networkInterfaces(), q.builds()]).then(([i, s, p, n, b]) => { this.info = i; this.settings = s; this.progs = p; this.nets = n; this.builds = b; this.v++; });
      this.off = q.onProgram((s) => { this.progs = this.progs.map((x) => (x.id === s.id ? s : x)); this.v++; });
    }
  }
  destroy(): void { this.off?.(); }
  private async loadDevices(): Promise<void> {
    const k = `${this.app.source.kind}|${this.app.source.state}`; if (k === this.devFor) return; this.devFor = k;
    try { this.devices = (await bget<{ devices: C1Device[] }>(this.app.bridgeUrl, ENDPOINTS.devices, 1500)).devices.map(uiDevice).filter((d): d is DeviceInfo => !!d); } catch { this.devices = null; }
    this.v++;
  }
  frame(): void {
    void this.loadDevices();
    const k = `${this.v}|${remote.v}|${this.app.themeV}|${this.app.source.state}`; if (k === this.built) return; this.built = k;
    const head = h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'DC QA Link Cloud'), h('h1', null, 'Settings'), h('p', null, desktop() ? 'Saved in the app\'s own folder on this PC.' : 'Saved in this browser. The desktop app adds programs, files and this PC\'s network.')),
      h('div', { class: 'actions' }, btn('Set up a console', () => this.app.cmds.run('setup.open'), { icon: 'sparkles', primary: true })));
    const col = (...c: HTMLElement[]) => h('div', { class: 'col' }, ...c);
    this.el.replaceChildren(head, h('div', { class: 'grid-2' }, col(this.buildsCard(), this.devicesCard(), this.programsCard(), this.networkCard()), col(this.remoteCard(), this.appearanceCard(), this.aboutCard())), this.agentsCard());
  }

  private devicesCard(): HTMLElement {
    const t = h('table', { class: 'table dense' });
    const rows = this.devices ?? [];
    t.innerHTML = `<thead><tr><th>Device</th><th>Path</th><th>Address</th><th>Loader</th></tr></thead><tbody>${rows.map((d) => `<tr><td><span class="ellipsis strong">${esc(d.name)}</span></td><td class="muted">${d.transport === 'bba' ? 'broadband adapter' : 'modem, DreamPi'}</td><td class="mono">${esc(d.address)}</td><td class="mono muted">${esc(d.loader ?? '-')}</td></tr>`).join('')}</tbody>`;
    const body = this.devices === null
      ? empty('server', 'The bridge is not answering', `No bridge at ${this.app.bridgeUrl}. ${desktop() ? 'Start it under Programs.' : 'Start it on this PC (npm run bridge).'}`)
      : rows.length ? t : empty('monitor', 'No devices yet', 'Set up a console to find one.');
    return h('section', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('monitor') }, h('h2', null, 'Devices'), h('span', { class: 'meta' }, this.devices ? `${rows.length} known to the bridge` : 'bridge not answering')),
      h('div', { class: 'card-body flush' }, body),
      h('div', { class: 'card-foot' }, h('span', null, 'Consoles are found by the loader\'s beacon on the local network.'), btn('Find a console', () => this.app.openSetup('find'), { small: true, icon: 'search' })));
  }

  /** the set-up's answers, editable: how the console connects and the one folder it sees */
  private buildsCard(): HTMLElement {
    const q = desktop(); const b = this.builds; const k = (this.settings?.connection || '') as Connection | '';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'How the Dreamcast connects' });
    for (const [t, l] of [['bba', 'Adapter'], ['modem', 'Modem'], ['flycast', 'Flycast']] as const) {
      const x = h('button', { class: k === t ? 'is-on' : '', 'aria-pressed': String(k === t), disabled: !q }, l);
      x.addEventListener('click', async () => { if (!q) return; this.settings = await q.setSetting('connection', t); this.builds = await q.builds(); this.v++; this.app.toast('ok', 'Connection saved', 'A running bridge restarts with it.'); });
      seg.append(x);
    }
    const pick = (sample: boolean) => async () => { if (!q) return; try { this.builds = sample ? await q.useSample() : await q.chooseBuilds(); this.v++; } catch (e) { this.app.toast('err', 'Could not use that folder', String(e)); } };
    const body = h('div', { class: 'card-body' },
      h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'How the Dreamcast connects'), h('div', { class: 'd' }, k === 'modem' ? MODEM_NO_DISC : 'Asked by the set-up; change it here.')), h('div', { class: 'ctl' }, q ? seg : deskOnly())),
      h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Builds folder'), h('div', { class: 'd mono' }, b?.root ? (b.sample ? `the sample game: ${b.root}` : b.root) : 'not chosen'), h('div', { class: 'd' }, b?.root ? `Only this folder is shared with the console (${b.shared}).` : 'The bridge shares nothing until a folder is chosen.')),
        h('div', { class: 'ctl' }, q ? btn('Choose...', pick(false), { small: true, icon: 'folder-open' }) : deskOnly(), q && b?.sampleAvailable && !b.sample ? btn('Use the sample', pick(true), { small: true, icon: 'gamepad-2' }) : null)));
    return h('section', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('folder-open') }, h('h2', null, 'Console and builds'), h('span', { class: 'meta' }, b?.programs.length ? `${b.programs.length} program${b.programs.length > 1 ? 's' : ''}` : '')), body,
      h('div', { class: 'card-foot' }, h('span', null, 'The bridge serves the folder as /pc files, the network disc overlay and the asset root.'), btn('Run the set-up again', () => this.app.cmds.run('setup.open'), { small: true, icon: 'sparkles' })));
  }

  private remoteCard(): HTMLElement {
    const s = remote.state;
    const pill = s === 'on' ? `<span class="pill ok">${iconSvg('circle-check')}On</span>` : s === 'connecting' ? `<span class="pill warn">${iconSvg('loader-circle', 16, 'spin')}Connecting</span>` : s === 'refused' ? `<span class="pill err">${iconSvg('circle-x')}Refused</span>` : `<span class="pill">${iconSvg('circle')}Off</span>`;
    const sw = switchEl(s === 'on' || s === 'connecting', 'Remote link', (v) => setRemote(v), { busy: s === 'connecting', refused: s === 'refused' });
    const say: Record<RemoteState, string> = {
      off: 'Nothing leaves this PC. The console, the bridge and this app work on the local network only.',
      connecting: 'Opening one outgoing connection to DC QA Link Cloud. No port is opened on this network.',
      on: 'Linked to DC QA Link Cloud through one outgoing connection. A browser elsewhere and cloud agents with a token can reach this console. Every command is logged with who sent it.',
      refused: remote.reason || 'DC QA Link Cloud refused the connection.',
    };
    const states = h('div', { class: 'remote-states' }, ...(['off', 'connecting', 'on', 'refused'] as RemoteState[]).map((x) => h('div', { class: `remote-state${x === s ? ' is-current' : ''}`, html: `<span class="pill${x === 'on' ? ' ok' : x === 'connecting' ? ' warn' : x === 'refused' ? ' err' : ''}">${x === 'off' ? 'Off' : x === 'on' ? 'On' : x === 'connecting' ? 'Connecting' : 'Refused'}</span>` },
      x === 'off' ? 'Local only' : x === 'connecting' ? 'Dialling out' : x === 'on' ? 'Reachable with sign-in' : 'Not set up, or signed out')));
    return h('section', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('globe') }, h('h2', null, 'Remote link'), h('span', { class: 'meta', html: pill })),
      h('div', { class: 'card-body remote' },
        h('div', { class: 'remote-head' }, sw, h('div', null, h('div', { class: 't' }, 'Reach this console from elsewhere'), h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'DC QA Link Cloud on Cloudflare: sign-in on every page and call'))),
        h('div', { class: `callout${s === 'refused' ? ' err' : s === 'on' ? ' ok' : s === 'connecting' ? ' warn' : ''}`, html: iconSvg(s === 'refused' ? 'circle-x' : s === 'on' ? 'circle-check' : 'info') }, h('p', null, say[s], s === 'on' && new URLSearchParams(location.search).get('remote') === 'on' ? h('b', null, ' Design preview: nothing is connected.') : null)),
        states,
        h('dl', { class: 'kv' }, h('dt', null, 'Address'), h('dd', null, 'not set up (milestone L3b)'), h('dt', null, 'When on, leaves this PC'), h('dd', null, 'live data, grabs and sessions you upload'), h('dt', null, 'Never leaves'), h('dd', null, 'files on disk you did not send'))));
  }

  private programsCard(): HTMLElement {
    const q = desktop(); const body = h('div', { class: 'card-body' });
    const addr = h('input', { class: 'input mono', value: this.settings?.bridgeAddress ?? this.app.bridgeUrl, 'aria-label': 'Bridge address', style: 'width:calc(var(--w-field) - var(--s-8))' });
    addr.addEventListener('change', async () => {
      const v = addr.value.trim(); const ok = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(v); addr.classList.toggle('is-error', !ok);
      if (!ok) { this.app.toast('warn', 'The bridge runs on this PC', 'Use http://127.0.0.1:<port>. Reaching a console elsewhere is the remote link\'s job.'); return; }
      if (q) this.settings = await q.setSetting('bridgeAddress', v); save('bridge', v); this.app.toast('ok', 'Bridge address saved', v);
    });
    body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Bridge address'), h('div', { class: 'd' }, 'The bridge runs on this PC and talks to the console.')), h('div', { class: 'ctl' }, addr)));
    if (!q) {
      body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Start the bridge and Flycast'), h('div', { class: 'd' }, 'On the web page, start the bridge yourself: npm run bridge.')), h('div', { class: 'ctl' }, deskOnly())));
    } else {
      for (const p of this.progs) {
        const st = p.running ? `<span class="pill ok">${iconSvg('circle-dot')}running, pid ${p.pid}</span>` : p.configured ? `<span class="pill">${iconSvg('circle')}stopped${p.lastExit != null ? `, exit ${p.lastExit}` : ''}</span>` : `<span class="pill warn">${iconSvg('triangle-alert')}not set up</span>`;
        const ctl = h('div', { class: 'ctl', html: st });
        if (p.id === 'flycast') ctl.append(btn(p.configured ? 'Change' : 'Choose flycast.exe', async () => { this.progs = this.progs.map((x) => x.id === 'flycast' ? x : x); const s = await q.chooseFlycast(); this.progs = this.progs.map((x) => (x.id === s.id ? s : x)); this.v++; }, { small: true, icon: 'folder-open' }));
        ctl.append(p.running ? btn('Stop', () => void q.stopProgram(p.id), { small: true, icon: 'square' }) : btn('Start', () => void q.startProgram(p.id).catch((e) => this.app.toast('err', `Could not start ${p.label}`, String(e))), { small: true, icon: 'play', disabled: !p.configured }));
        body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, p.label), h('div', { class: 'd mono' }, p.detail)), ctl));
      }
      const auto = switchEl(!!this.settings?.startBridgeOnLaunch, 'Start the bridge when the app opens', async (v) => { this.settings = await q.setSetting('startBridgeOnLaunch', v); this.v++; });
      body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Start the bridge when the app opens'), h('div', { class: 'd' }, 'The app then links to it at once.')), h('div', { class: 'ctl' }, auto)));
      const lanSw = switchEl(!!this.settings?.consoleOnNetwork, 'Dreamcast on the network', async (v) => { this.settings = await q.setSetting('consoleOnNetwork', v); this.v++; this.app.toast('ok', v ? 'The bridge may talk to a Dreamcast on the network' : 'The bridge talks only to Flycast on this PC', 'Restart the bridge to apply.'); });
      body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Dreamcast on the network'), h('div', { class: 'd' }, 'Off: the bridge talks only to Flycast on this PC, and a console it hears is listed but never sent anything. Turn on to link a real Dreamcast. Tests and agents that start their own bridge keep it off.')), h('div', { class: 'ctl' }, lanSw)));
      const acSw = switchEl(this.settings?.autoconnect !== false, 'Link by itself', async (v) => { this.settings = await q.setSetting('autoconnect', v); this.v++; });
      body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Link by itself'), h('div', { class: 'd' }, 'Links to a console linked before (or the only one heard) when its loader beacons, and again when it comes back from a run or a reboot, on a new address too.')), h('div', { class: 'ctl' }, acSw)));
      if (this.settings?.flycastPrepared) body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Flycast settings for the app'), h('div', { class: 'd mono' }, this.settings.flycastPrepared)), h('div', { class: 'ctl' }, h('span', { class: 'pill ok' }, 'own copy'))));
    }
    return h('section', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('server') }, h('h2', null, 'Bridge and Flycast'), h('span', { class: 'meta' }, 'programs on this PC')), body,
      h('div', { class: 'card-foot' }, h('span', null, 'The bridge is dc-qalink\'s (contract 1) when the app finds it, else the mock bridge.')));
  }

  private agentsCard(): HTMLElement {
    const q = desktop(); const sn = mcpSnippets(this.info);
    const by = (l: string) => MCP_TOOLS.filter((t) => t.level === l).length;
    const sw = q ? switchEl(!!this.settings?.mcpLocal, 'Local MCP', async (v) => { this.settings = await q.setSetting('mcpLocal', v); this.v++; }) : deskOnly();
    return h('section', { class: 'card span-2' }, h('div', { class: 'card-head', html: iconSvg('bot') }, h('h2', null, 'Agents (MCP)'), h('span', { class: 'meta' }, `${MCP_TOOLS.length} tools, list ${MCP_TOOLS_VERSION}: ${by('read')} read, ${by('control')} control, ${by('run')} run code`)),
      h('div', { class: 'card-body' },
        h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Local MCP on this PC'), h('div', { class: 'd' }, 'Claude Code or Codex on this PC use the console as tools: link status, push and run, grab the screen, live summary, warp, pause and step, pad, memory, sessions. The agent gets the level in its command line (control here; run code must be given on purpose).')), h('div', { class: 'ctl' }, sw)),
        h('div', { class: 'grid-2', style: 'margin-top:var(--s-3)' }, snippet(this.app, 'Claude Code', sn.claude), snippet(this.app, 'Codex, ~/.codex/config.toml', sn.codex))));
  }

  private networkCard(): HTMLElement {
    const q = desktop();
    const lan = this.nets.find((n) => n.lan);
    const t = h('table', { class: 'table dense' });
    t.innerHTML = `<thead><tr><th>Interface</th><th>Address</th><th>Kind</th></tr></thead><tbody>${this.nets.filter((n) => n.family === 'IPv4').map((n) => `<tr${n === lan ? ' class="is-selected"' : ''}><td><span class="ellipsis" title="${esc(n.name)}">${esc(n.name)}</span></td><td class="mono">${esc(n.address)}</td><td>${n === lan ? `<span class="pill ok">${iconSvg('check')}local network</span>` : n.internal ? '<span class="pill">this PC only</span>' : n.virtual ? '<span class="pill">virtual</span>' : '<span class="pill">other</span>'}</td></tr>`).join('')}</tbody>`;
    return h('section', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('network') }, h('h2', null, 'This PC\'s network'), h('span', { class: 'meta' }, q ? (lan ? `console side: ${lan.address}` : 'no local network found') : '')),
      h('div', { class: 'card-body flush' }, q ? t : empty('network', 'In the desktop app', 'The desktop app lists this PC\'s network interfaces and picks the one the console can reach.')),
      h('div', { class: 'card-foot' }, h('span', null, 'The app changes no firewall settings.')));
  }

  private appearanceCard(): HTMLElement {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' });
    for (const [t, l] of [['dark', 'Dark'], ['light', 'Light']] as const) { const b = h('button', { class: this.app.theme === t ? 'is-on' : '', 'aria-pressed': String(this.app.theme === t) }, l); b.addEventListener('click', () => { this.app.applyTheme(t); this.v++; }); seg.append(b); }
    const tlH = store<number | null>('timeline.h', null);
    return h('section', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('palette') }, h('h2', null, 'Appearance')),
      h('div', { class: 'card-body' },
        h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Theme'), h('div', { class: 'd' }, 'Both meet contrast AA. T switches.')), h('div', { class: 'ctl' }, seg)),
        h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Workspace layouts'), h('div', { class: 'd' }, 'Each workspace keeps the areas you arranged.')), h('div', { class: 'ctl' }, btn('Reset all layouts', () => { for (const w of ['link', 'perf', 'assets', 'capture', 'debug', 'commands', 'home']) save(`layout.${w}.v1`, null); this.app.toast('ok', 'Layouts reset', 'Each workspace opens with its first layout.'); }, { small: true, icon: 'rotate-ccw' }))),
        h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'l' }, 'Timeline height'), h('div', { class: 'd' }, tlH ? `${tlH} px, set by dragging its top edge` : 'Fits its lanes. Drag its top edge to change it.')), h('div', { class: 'ctl' }, btn('Fit to lanes', () => { this.app.resetTimeline(); this.v++; }, { small: true, disabled: !tlH })))));
  }

  private aboutCard(): HTMLElement {
    const i = this.info;
    return h('section', { class: 'card' }, h('div', { class: 'card-head', html: iconSvg('info') }, h('h2', null, 'About')),
      h('div', { class: 'card-body' }, h('dl', { class: 'kv' },
        h('dt', null, 'App'), h('dd', null, i ? `DC QA Link Cloud ${i.version}, desktop${i.packaged ? '' : ' (from source)'}` : 'DC QA Link Cloud, web page'),
        h('dt', null, 'Built on'), h('dd', null, 'dc-qalink 0.2 (in progress)'),
        h('dt', null, 'Notice'), h('dd', null, 'Independent tool; not affiliated with Sega.'),
        h('dt', null, 'Bridge API'), h('dd', null, BRIDGE_API_VERSION),
        h('dt', null, 'Session format'), h('dd', null, String(SESSION_FORMAT_VERSION)),
        h('dt', null, 'MCP tool list'), h('dd', null, MCP_TOOLS_VERSION),
        ...(i ? [h('dt', null, 'Electron'), h('dd', null, `${i.electron} (Chromium ${i.chrome}, Node ${i.node})`), h('dt', null, 'Data folder'), h('dd', { title: i.dataDir }, i.dataDir)] : []))));
  }
}
