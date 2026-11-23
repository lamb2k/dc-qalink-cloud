import { openDialog } from '../ui/dialog';
// Debug: Runs (push a build, its report, history), Memory (hex view at the playhead) and Watched values.
// Replay uses a mock runner and mock memory; live speaks the bridge's /runs and /memory/read.
import type { App } from '../ui/app';
import type { RunRecord } from '../data/bridge-api';
import { esc, h, iconSvg, int, num } from '../ui/dom';
import { btn, empty, toolBtn, Watch, type Editor, type EditorDef } from './base';

const runsCache: { list: RunRecord[]; at: number; src: unknown } = { list: [], at: 0, src: null };
async function refreshRuns(app: App, force = false): Promise<RunRecord[]> {
  if (!force && runsCache.src === app.source && performance.now() - runsCache.at < 800) return runsCache.list;
  runsCache.at = performance.now(); runsCache.src = app.source;
  try { runsCache.list = await app.source.runs(); } catch { runsCache.list = []; }
  return runsCache.list;
}
const stateKind = (s: RunRecord['state']) => (s === 'passed' ? 'ok' : s === 'failed' || s === 'crashed' ? 'err' : s === 'running' || s === 'pushing' ? 'warn' : 'info');
const stateIcon = (s: RunRecord['state']) => (s === 'passed' ? 'circle-check' : s === 'failed' || s === 'crashed' ? 'circle-x' : s === 'queued' ? 'clock' : 'loader-circle');

class Runs implements Editor {
  el = h('div'); bodyClass = 'scroll'; tools: HTMLElement[]; private built = ''; private tick = 0;
  private input = h('input', { type: 'file', class: 'sr-only', accept: '.elf,.bin' });
  // push arguments: kept outside the rebuilt list so typing is never interrupted; remembered per program file
  private argsLabel = h('label', { class: 'l', for: 'run-args' });
  private args = h('input', { id: 'run-args', class: 'input mono', type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'none', maxlength: '500' }) as HTMLInputElement;
  private argsProg = '';
  private list = h('div');
  constructor(private app: App) {
    this.args.addEventListener('input', () => app.setArgsFor(this.argsProg, this.args.value));
    this.el.append(h('div', { class: 'run-args' }, this.argsLabel, this.args), this.list);
    this.tools = [toolBtn('rocket', 'Push a build and run it (Ctrl U)', () => this.input.click()), toolBtn('refresh-cw', 'Refresh', () => { void refreshRuns(app, true).then(() => { this.built = ''; }); })];
    this.input.addEventListener('change', async () => { const f = this.input.files?.[0]; if (f) { await app.pushBuild(f); await refreshRuns(app, true); this.built = ''; } this.input.value = ''; });
  }
  meta(): string { return `${runsCache.list.length} runs`; }
  frame(): void {
    if (++this.tick % 30 === 0 || runsCache.src !== this.app.source) void refreshRuns(this.app).then(() => {});
    const list = runsCache.list;
    const k = `${list.map((r) => r.id + r.state).join(',')}|${this.app.view.run}|${this.app.source.kind}`; if (k === this.built) return; this.built = k;
    if (!this.app.view.run && list[0]) this.app.view.run = list[0].id;
    const drop = h('div', { class: 'drop run-drop', tabindex: '0', role: 'button', 'aria-label': 'Drop a build to push and run it' },
      h('span', { class: 't', html: iconSvg('file-up') }, 'Drop a build to push and run'),
      h('span', null, this.app.source.kind === 'live' ? 'Sent to the bridge with its SHA-256; the loader checks it before running.' : 'Mock runner in replay: the hash and size are real, the run is not.'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('is-over'); const f = e.dataTransfer?.files?.[0]; if (f) { await this.app.pushBuild(f); await refreshRuns(this.app, true); this.built = ''; } });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.input.click(); } });
    const t = h('table', { class: 'table dense' });
    t.innerHTML = `<thead><tr><th>Run</th><th>Build</th><th>Device</th><th>State</th><th class="num">When</th></tr></thead><tbody>${list.map((r) =>
      `<tr class="click${r.id === this.app.view.run ? ' is-selected' : ''}" data-id="${esc(r.id)}" tabindex="0"><td class="mono">${esc(r.id)}</td><td><span class="ellipsis" title="${esc(r.file)} · ${int(r.bytes)} B · ${esc(r.sha256)}">${esc(r.file)}</span></td><td><span class="ellipsis" title="${esc(r.device)}">${esc(r.device)}</span></td><td><span class="pill ${stateKind(r.state)}">${iconSvg(stateIcon(r.state), 16, r.state === 'running' || r.state === 'pushing' ? 'spin' : '')}${r.state}</span></td><td class="num muted" title="${esc(r.queuedAt)}">${esc(r.queuedAt.slice(11, 16))}</td></tr>`).join('')}</tbody>`;
    t.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => { const go = () => this.app.view.set('run', tr.dataset.id!); tr.addEventListener('click', go); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); });
    this.argsProg = list.find((r) => r.id === this.app.view.run)?.file ?? '';
    this.argsLabel.textContent = this.argsProg ? `Arguments for ${this.argsProg}` : 'Arguments for the next push';
    this.args.title = 'Sent with each push of this program; the loader hands them to it (the MCP push takes the same args)';
    if (document.activeElement !== this.args) this.args.value = this.app.argsFor(this.argsProg);
    this.list.replaceChildren(drop, list.length ? t : empty('rocket', 'No runs yet', 'Push a build to run it on the linked device.'), this.input);
  }
}

class RunReport implements Editor {
  el = h('div', { class: 'pane-pad' }); bodyClass = 'scroll'; private built = '';
  constructor(private app: App) {}
  meta(): string { return this.app.view.run || 'no run selected'; }
  frame(): void {
    const r = runsCache.list.find((x) => x.id === this.app.view.run);
    const k = `${r?.id}|${r?.state}|${!!r?.report}`; if (k === this.built) return; this.built = k;
    if (!r) { this.el.replaceChildren(empty('file-text', 'No run selected', 'Pick a run in Runs to read its report.')); return; }
    const rep = r.report;
    let html = `<div class="row"><span class="pill ${stateKind(r.state)}">${iconSvg(stateIcon(r.state))}${r.state}</span><span class="strong ellipsis" title="${esc(r.file)}">${esc(r.file)}</span><span class="grow"></span><span class="muted" style="font-size:var(--fs-xs)">by ${esc(r.by)}</span></div>
      <dl class="props"><dt>Device</dt><dd title="${esc(r.device)}">${esc(r.device)}</dd><dt>Size</dt><dd>${int(r.bytes)} B</dd><dt>SHA-256</dt><dd title="${esc(r.sha256)}">${esc(r.sha256.slice(0, 16))}...</dd><dt>Arguments</dt><dd class="mono" title="${esc(r.args ?? '')}">${r.args ? esc(r.args) : '<span class="faint">none</span>'}</dd><dt>Queued</dt><dd>${esc(r.queuedAt.replace('T', ' ').slice(0, 19))}</dd>${r.endedAt ? `<dt>Ended</dt><dd>${esc(r.endedAt.replace('T', ' ').slice(0, 19))}</dd>` : ''}</dl>`;
    if (!rep) html += `<div class="muted">${r.state === 'queued' ? 'Waiting for the device.' : 'Running; the report appears when it ends.'}</div>`;
    else {
      html += `<div class="section-title">${iconSvg('file-text')}Report · <span class="faint">${esc(rep.tier)}</span></div><dl class="props"><dt>Exit</dt><dd class="${rep.exit ? 'over' : ''}">${rep.exit ?? 'none (crashed)'}</dd><dt>Seconds</dt><dd>${rep.seconds}</dd><dt>Pictures</dt><dd>${int(rep.pictures)}</dd>${rep.numbers.map((n) => `<dt>${esc(n.label)}</dt><dd>${n.value.toFixed(2)} ${esc(n.unit)}</dd>`).join('')}</dl>`;
      if (rep.notes.length) html += `<ul style="margin:0;padding-left:var(--s-4);color:var(--text-muted);font-size:var(--fs-sm)">${rep.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
      if (rep.crash) {
        const c = rep.crash;
        html += `<div class="section-title" style="color:var(--err)">${iconSvg('circle-alert')}Crash</div><dl class="props"><dt>PC</dt><dd>${esc(c.pc)}</dd><dt>PR (return)</dt><dd>${esc(c.pr)}</dd><dt>Symbol</dt><dd>${esc(c.symbol)}</dd></dl>`;
        if (c.source) html += `<div class="faint mono" style="font-size:var(--fs-xs)">${esc(c.source.file)}:${c.source.line}</div><pre class="code">${c.source.text.map((t, i) => { const no = c.source!.line - c.source!.at + i; return `<div class="cl${i === c.source!.at ? ' at' : ''}"><span class="no">${no}</span><span>${esc(t)}</span></div>`; }).join('')}</pre>`;
      }
    }
    this.el.innerHTML = html;
  }
}

/** memory read at the playhead, cached per (address, picture) */
const memCache = new Map<string, Uint8Array>();
async function readMem(app: App, addr: number, len: number, n: number): Promise<Uint8Array> {
  const k = `${addr}|${len}|${n}|${app.source.kind}`; const c = memCache.get(k); if (c) return c;
  const r = await app.source.readMemory(addr, len, n); const s = atob(r.data); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  memCache.set(k, b); while (memCache.size > 64) memCache.delete(memCache.keys().next().value!);
  return b;
}
const hx = (v: number, w: number) => v.toString(16).toUpperCase().padStart(w, '0');

class Memory implements Editor {
  el: HTMLElement; tools: HTMLElement[];
  private list = h('div', { class: 'vlist hex', tabindex: '0', 'aria-label': 'Memory, 16 bytes a row' });
  private spacer = h('div', { class: 'vlist-spacer' }); private rows = h('div', { class: 'vlist-rows' });
  private addr = h('input', { class: 'input mono', 'aria-label': 'Go to address (hex)', placeholder: '8C010000' });
  private w = new Watch(); private v = 0; private data: Uint8Array | null = null; private prev: Uint8Array | null = null; private loaded = '';
  private readonly SPAN = 64 * 1024;
  constructor(private app: App) {
    this.list.append(this.spacer); this.spacer.append(this.rows);
    const go = h('form', { class: 'goto' }, this.addr, btn('Go', () => {}, { small: true }));
    go.addEventListener('submit', (e) => { e.preventDefault(); const a = parseInt(this.addr.value.replace(/^0x/i, ''), 16); if (!Number.isNaN(a)) { app.view.set('memAddr', a & ~15); this.list.scrollTop = 0; } });
    this.el = h('div', { class: 'with-bar' }, h('div', { class: 'filter-bar' }, go, h('span', { class: 'grow' }), h('span', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'changed since the previous picture in amber')), h('div', { class: 'grow-body' }, this.list));
    this.tools = [toolBtn('copy', 'Copy the visible rows', () => { void navigator.clipboard?.writeText(this.rows.innerText); app.toast('ok', 'Copied the visible rows'); })];
    this.list.addEventListener('scroll', () => this.v++);
    this.w.observe(this.list);
  }
  meta(): string { return `${hx(this.app.view.memAddr, 8)} + 64 KB · picture ${this.app.view.playhead}${this.app.source.kind === 'live' ? '' : ' · mock memory'}`; }
  frame(force: boolean): void {
    const base = this.app.view.memAddr; const n = this.app.view.playhead; const k = `${base}|${n}|${this.app.source.kind}`;
    if (k !== this.loaded) {
      this.loaded = k;
      void Promise.all([readMem(this.app, base, this.SPAN, n), readMem(this.app, base, this.SPAN, Math.max(0, n - 1))]).then(([d, p]) => { this.data = d; this.prev = p; this.v++; }).catch((e) => { this.data = null; this.app.toast('err', 'Memory read failed', String(e)); });
    }
    if (!this.w.changed(this.app, String(this.v)) && !force) return;
    if (this.app.source.kind === 'idle') { this.rows.replaceChildren(empty('binary', 'No console linked', 'Memory reads need a linked console or a recording.')); return; }
    const rh = num('--lh-sm'); const total = this.SPAN / 16; this.spacer.style.height = `${total * rh}px`;
    const top = this.list.scrollTop, H = this.list.clientHeight; const a = Math.max(0, Math.floor(top / rh) - 4), b = Math.min(total, Math.ceil((top + H) / rh) + 4);
    this.rows.style.transform = `translateY(${a * rh}px)`;
    const d = this.data, p = this.prev; let html = '';
    for (let r = a; r < b; r++) {
      let bytes = '', asc = '';
      for (let i = 0; i < 16; i++) {
        const o = r * 16 + i; const v = d ? d[o] : 0; const ch = p && d && p[o] !== d[o];
        const s = d ? hx(v, 2) : '..'; bytes += (ch ? `<span class="chg">${s}</span>` : s) + (i === 7 ? '  ' : ' ');
        asc += d ? (v >= 32 && v < 127 ? esc(String.fromCharCode(v)) : '.') : ' ';
      }
      html += `<div class="hr"><span class="addr">${hx(this.app.view.memAddr + r * 16, 8)}</span><span class="bytes">${bytes}</span><span class="asc">${asc}</span></div>`;
    }
    this.rows.innerHTML = html;
  }
  destroy(): void { this.w.stop(); }
}

interface WatchDef { name: string; addr: number; type: 'u32' | 'u16' | 'f32' }
const watches: WatchDef[] = [
  { name: 'picture counter', addr: 0x8c010100, type: 'u32' }, { name: 'objects alive', addr: 0x8c010104, type: 'u32' },
  { name: 'heap top', addr: 0x8c010108, type: 'u32' }, { name: 'textures resident', addr: 0x8c01010c, type: 'u32' },
];
class WatchList implements Editor {
  el = h('div'); bodyClass = 'scroll'; private loaded = ''; private vals: (number | null)[][] = []; private v = 0; private shown = '';
  tools: HTMLElement[];
  constructor(private app: App) { this.tools = [toolBtn('plus', 'Watch an address', () => this.add())]; }
  private async add(): Promise<void> {
    const hexOk = (v: string) => (/^(0x)?[0-9a-f]{1,8}$/i.test(v) ? '' : 'Give the address in hex, up to 8 digits, e.g. 8C010100.');
    const r = await openDialog({ title: 'Watch an address', icon: 'eye', text: 'The value is read at the playhead and at the picture before it, so you see what changed.', ok: 'Watch', grid: true, fields: [
      { key: 'addr', label: 'Address (hex)', value: '8C010100', mono: true, check: hexOk },
      { key: 'type', label: 'Read as', kind: 'select', options: [['u32', '32-bit whole number'], ['u16', '16-bit whole number'], ['f32', '32-bit decimal (float)']] },
      { key: 'name', label: 'Name (optional)', placeholder: 'e.g. picture counter', check: (v) => (v.length > 40 ? 'At most 40 characters.' : '') },
    ] });
    if (!r) return;
    const n = parseInt(r.addr.replace(/^0x/i, ''), 16);
    watches.push({ name: r.name || `0x${hx(n, 8)}`, addr: n, type: r.type as WatchDef['type'] }); this.loaded = '';
    this.app.toast('ok', `Watching 0x${hx(n, 8)}`, r.name || r.type);
  }
  meta(): string { return `${watches.length} values at picture ${this.app.view.playhead}`; }
  frame(): void {
    const n = this.app.view.playhead; const k = `${n}|${watches.length}|${this.app.source.kind}`;
    if (k !== this.loaded) {
      this.loaded = k;
      void Promise.all(watches.map(async (w) => { const [c, p] = await Promise.all([readMem(this.app, w.addr, 4, n), readMem(this.app, w.addr, 4, Math.max(0, n - 1))]); const dv = (b: Uint8Array) => new DataView(b.buffer); const rd = (b: Uint8Array) => (b.length < 4 ? null : w.type === 'f32' ? dv(b).getFloat32(0, true) : w.type === 'u16' ? dv(b).getUint16(0, true) : dv(b).getUint32(0, true)); return [rd(c), rd(p)]; }))
        .then((v) => { this.vals = v; this.v++; }).catch(() => {});
    }
    const sk = `${this.v}|${this.app.themeV}`; if (sk === this.shown) return; this.shown = sk;
    if (this.app.source.kind === 'idle') { this.el.replaceChildren(empty('eye', 'No console linked', 'Watched values read memory at the playhead.')); return; }
    this.el.innerHTML = `<table class="table dense"><thead><tr><th>Name</th><th>Address</th><th class="num">Value</th><th class="num">Change</th></tr></thead><tbody>${watches.map((w, i) => {
      const [c, p] = this.vals[i] ?? [null, null]; const d = c != null && p != null ? c - p : null;
      return `<tr><td><span class="ellipsis" title="${esc(w.name)} (${w.type})">${esc(w.name)}</span></td><td class="mono muted" title="${w.type}">${hx(w.addr, 8)}</td><td class="num">${c == null ? '-' : w.type === 'u32' && c > 0x80000000 ? '0x' + hx(c, 8) : int(c)}</td><td class="num${d ? '' : ' muted'}" style="${d ? 'color:var(--warn)' : ''}">${d == null ? '-' : d === 0 ? '0' : (d > 0 ? '+' : '') + int(d)}</td></tr>`;
    }).join('')}</tbody></table><div class="faint" style="padding:var(--s-2) var(--s-3);font-size:var(--fs-xs)">${this.app.source.kind === 'live' ? 'Read from the console through the bridge.' : 'Mock memory: the bridge does not read memory yet; values are generated per picture.'}</div>`;
  }
}

export const debugEditors: EditorDef[] = [
  { id: 'runs', title: 'Runs', icon: 'rocket', group: 'Debug', create: (app) => new Runs(app) },
  { id: 'runreport', title: 'Run report', icon: 'file-text', group: 'Debug', create: (app) => new RunReport(app) },
  { id: 'memory', title: 'Memory', icon: 'binary', group: 'Debug', create: (app) => new Memory(app) },
  { id: 'watch', title: 'Watched values', icon: 'eye', group: 'Debug', create: (app) => new WatchList(app) },
];
