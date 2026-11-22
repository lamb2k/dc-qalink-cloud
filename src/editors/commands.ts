// The Commands workspace: warp presets (from the running game through the bridge, or from a presets file), pause and
// step, the reset ladder, test options, a virtual pad, pad scripts and the history of what was sent. Commands go to a
// linked console only; in replay every control says so instead of pretending.
import type { App } from '../ui/app';
import type { CommandRequest, GameRegistry, PadButton, TestOption } from '../data/bridge-api';
import { registry } from '../data/bridge-client';
import { parsePadScript } from '../data/padscript';
import { desktop } from '../platform/desktop';
import { download, esc, h, iconSvg } from '../ui/dom';
import { openDialog } from '../ui/dialog';
import { btn, empty, toolBtn, type Editor, type EditorDef } from './base';

interface Hist { t: string; label: string; ok: boolean | null; detail: string; n?: number }
const S = {
  reg: null as GameRegistry | null, regFrom: '', regFor: '', regV: 0, loading: false, handle: '',
  hist: [] as Hist[], histV: 0,
  held: new Set<PadButton>(), stick: [0, 0] as [number, number], lt: 0, rt: 0, padV: 0,
  script: '', scriptName: '', scriptV: 0,
};
const linked = (app: App) => app.source.kind === 'live' && app.source.state === 'linked';
const now = () => new Date().toTimeString().slice(0, 8);

function parseRegistry(text: string, from: string): void {
  const v = JSON.parse(text) as GameRegistry & { format?: string };
  if (!Array.isArray(v.presets)) throw new Error('no "presets" list in the file');
  S.reg = { program: v.program ?? '', presets: v.presets, options: v.options ?? [], scripts: v.scripts ?? [] };
  S.regFrom = from; S.regV++;
  if (!S.script && S.reg.scripts[0]) { S.script = S.reg.scripts[0].text; S.scriptName = S.reg.scripts[0].name; S.scriptV++; }
}
async function loadRegistry(app: App, force = false): Promise<void> {
  const key = `${app.source.kind}|${app.source.state === 'linked'}`;
  if (S.loading || (!force && key === S.regFor)) return;
  S.loading = true; S.regFor = key;
  try {
    if (linked(app)) { const r = await registry(app.bridgeUrl); S.reg = r; S.regFrom = 'the running program (bridge)'; S.regV++; if (!S.script && r.scripts[0]) { S.script = r.scripts[0].text; S.scriptName = r.scripts[0].name; S.scriptV++; } }
    else if (!S.handle) { const r = await fetch(`${import.meta.env.BASE_URL}example-presets.json`); parseRegistry(await r.text(), 'example-presets.json'); }
  } catch (e) { app.toast('err', 'Could not read the warp presets', String(e)); }
  finally { S.loading = false; }
}
async function openPresetsFile(app: App): Promise<void> {
  const q = desktop();
  try {
    if (q) {
      const [f] = await q.openFiles('presets'); if (!f) return;
      parseRegistry(new TextDecoder().decode(f.bytes), f.name); S.handle = f.handle;
      await q.watch(f.handle); app.toast('ok', `Presets from ${f.name}`, 'Watching the file: saving it updates this list.');
    } else {
      const i = h('input', { type: 'file', accept: '.json', class: 'sr-only' }); document.body.append(i);
      i.addEventListener('change', async () => { const f = i.files?.[0]; i.remove(); if (!f) return; try { parseRegistry(await f.text(), f.name); S.handle = 'web'; app.toast('ok', `Presets from ${f.name}`); } catch (e) { app.toast('err', `Could not read ${f.name}`, String(e)); } });
      i.click();
    }
  } catch (e) { app.toast('err', 'Could not read the presets file', String(e)); }
}
let watching = false;
function watchPresets(app: App): void {
  const q = desktop(); if (!q || watching) return; watching = true;
  q.onFileChanged(async (handle, name) => { if (handle !== S.handle) return; try { parseRegistry(new TextDecoder().decode((await q.reread(handle)).bytes), name); app.toast('info', `${name} changed`, 'Warp presets reloaded.'); } catch (e) { app.toast('err', `${name} could not be read`, String(e)); } });
}

export async function send(app: App, c: CommandRequest, label: string, quiet = false): Promise<boolean> {
  if (!linked(app)) { if (!quiet) app.toast('warn', 'No console linked', 'Commands go to a linked console. Connect to the bridge first (Ctrl K, "Connect").'); return false; }
  const e: Hist = { t: now(), label, ok: null, detail: 'sent' }; S.hist.unshift(e); if (S.hist.length > 200) S.hist.pop(); S.histV++;
  try {
    const r = await app.source.command(c); e.ok = r.ok; e.detail = r.ok ? 'done' : r.error ?? 'refused'; e.n = r.n; S.histV++;
    if (!r.ok && !quiet) app.toast('err', `${label}: refused`, r.error ?? '');
    return r.ok;
  } catch (err) { e.ok = false; e.detail = String(err); S.histV++; if (!quiet) app.toast('err', `${label} failed`, String(err)); return false; }
}

function replayNote(app: App): HTMLElement {
  const el = h('div', { class: 'replay-note', html: iconSvg('info') });
  el.append(h('span', null, app.source.kind === 'replay' ? 'Replay: these controls send to a linked console. Showing the example presets file.' : 'No console linked: these controls send to a linked console.'));
  const b = btn('Connect', () => app.cmds.run('link.local'), { small: true, icon: 'plug' }); b.style.marginLeft = 'auto'; el.append(b);
  return el;
}

// ------------------------------------------------------------------ warp presets
class Warp implements Editor {
  el = h('div', { class: 'with-bar' }); tools: HTMLElement[]; private filter = h('input', { class: 'input', placeholder: 'Find a preset', 'aria-label': 'Find a preset', spellcheck: 'false' });
  private list = h('div', { class: 'grow-body scroll' }); private note = h('div'); private built = '';
  constructor(private app: App) {
    this.tools = [toolBtn('folder-open', 'Open a presets file', () => void openPresetsFile(app)), toolBtn('refresh-cw', 'Read the presets again', () => { S.handle = ''; void loadRegistry(app, true); })];
    this.el.append(this.note, h('div', { class: 'filter-bar' }, this.filter), this.list);
    this.filter.addEventListener('input', () => { this.built = ''; });
    watchPresets(app);
  }
  meta(): string { return S.reg ? `${S.reg.presets.length} presets, from ${S.regFrom}` : 'reading'; }
  frame(): void {
    void loadRegistry(this.app);
    const k = `${S.regV}|${linked(this.app)}|${this.filter.value}`; if (k === this.built) return; this.built = k;
    this.note.replaceChildren(...(linked(this.app) ? [] : [replayNote(this.app)]));
    const q = this.filter.value.trim().toLowerCase();
    const ps = (S.reg?.presets ?? []).filter((p) => !q || `${p.label} ${p.id} ${p.group ?? ''} ${p.detail ?? ''}`.toLowerCase().includes(q));
    if (!ps.length) { this.list.replaceChildren(empty('crosshair', S.reg ? 'No preset matches' : 'No presets yet', S.reg ? 'Clear the search to see them all.' : 'The running program registers its presets with the link, or open a presets file.')); return; }
    const t = h('table', { class: 'table dense cmd-list' }); const tb = h('tbody');
    t.innerHTML = '<thead><tr><th>Preset</th><th>Id</th><th>What it does</th><th></th></tr></thead>';
    let g = '';
    for (const p of ps) {
      if ((p.group ?? '') !== g) { g = p.group ?? ''; tb.append(h('tr', { class: 'grp-row' }, h('td', { colspan: '4' }, g || 'Other'))); }
      const go = () => void send(this.app, { cmd: 'warp', preset: p.id }, `Warp to ${p.label}`);
      const tr = h('tr', { class: 'click', tabindex: '0', title: 'Enter or double-click to warp' });
      tr.innerHTML = `<td><span class="ellipsis strong">${esc(p.label)}</span></td><td class="mono muted">${esc(p.id)}</td><td class="muted"><span class="ellipsis" title="${esc(p.detail ?? '')}">${esc(p.detail ?? '')}</span></td>`;
      const b = btn('Warp', go, { small: true, icon: 'crosshair', disabled: !linked(this.app) });
      tr.append(h('td', { style: 'text-align:right' }, b));
      tr.addEventListener('dblclick', go); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      tb.append(tr);
    }
    t.append(tb); this.list.replaceChildren(t);
  }
}

// ------------------------------------------------------------------ console control and test options
class Control implements Editor {
  el = h('div'); bodyClass = 'scroll'; private built = ''; private count = h('input', { class: 'input mono', value: '1', 'aria-label': 'Pictures to step', inputmode: 'numeric' });
  constructor(private app: App) {}
  meta(): string { return linked(this.app) ? `${this.app.source.playing ? 'running' : 'paused'}` : 'not linked'; }
  frame(): void {
    void loadRegistry(this.app);
    const k = `${S.regV}|${linked(this.app)}|${this.app.source.playing}`; if (k === this.built) return; this.built = k;
    const on = linked(this.app); const A = this.app;
    const run = h('div', { class: 'ctl-sec' }, h('div', { class: 'section-title', html: iconSvg('square-play') }, 'Console'),
      h('div', { class: 'ctl-row' },
        btn('Pause', () => void send(A, { cmd: 'pause' }, 'Pause'), { small: true, icon: 'pause', disabled: !on }),
        btn('Resume', () => void send(A, { cmd: 'resume' }, 'Resume'), { small: true, icon: 'play', disabled: !on }),
        h('span', { class: 'sep-v' }), this.count,
        btn('Step', () => { const n = Math.max(1, Math.min(600, parseInt(this.count.value, 10) || 1)); void send(A, { cmd: 'step', count: n }, `Step ${n} picture${n > 1 ? 's' : ''}`); }, { small: true, icon: 'step-forward', disabled: !on })));
    const reset = h('div', { class: 'ctl-sec' }, h('div', { class: 'section-title', html: iconSvg('rotate-ccw') }, 'Back to the loader'),
      h('div', { class: 'ctl-row' },
        btn('Ask the program', () => void send(A, { cmd: 'reset', level: 'return' }, 'Reset: return'), { small: true, disabled: !on }),
        btn('Watchdog', () => void send(A, { cmd: 'reset', level: 'watchdog' }, 'Reset: watchdog'), { small: true, disabled: !on }),
        btn('Power plug', async () => { const ok = await openDialog({ title: 'Cut the power?', icon: 'triangle-alert', text: 'The smart plug turns the console off and on. Anything not saved on the console is lost.', fields: [], ok: 'Cut the power' }); if (ok) void send(A, { cmd: 'reset', level: 'power' }, 'Reset: power plug'); }, { small: true, icon: 'plug', disabled: !on })),
      h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'Each step is stronger than the one before; use the next only when the last did not bring the loader back.'));
    const opts = h('div', { class: 'ctl-sec' }, h('div', { class: 'section-title', html: iconSvg('sliders-horizontal') }, `Test options${S.reg?.program ? `, ${S.reg.program}` : ''}`));
    for (const o of S.reg?.options ?? []) opts.append(this.option(o, on));
    if (!S.reg?.options.length) opts.append(h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'The program registered no test options.'));
    this.el.replaceChildren(run, opts, reset); // the Warp presets area carries the one 'not linked' note
  }
  private option(o: TestOption, on: boolean): HTMLElement {
    const A = this.app; let ctl: HTMLElement;
    if (o.type === 'bool') {
      const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!o.value), 'aria-label': o.label, disabled: !on });
      sw.addEventListener('click', async () => { const v = !(sw.getAttribute('aria-checked') === 'true'); if (await send(A, { cmd: 'option', name: o.name, value: v }, `${o.label}: ${v ? 'on' : 'off'}`)) { o.value = v; sw.setAttribute('aria-checked', String(v)); } });
      ctl = sw;
    } else if (o.type === 'enum') {
      const s = h('select', { class: 'select', 'aria-label': o.label, disabled: !on }); for (const v of o.values ?? []) s.append(h('option', { value: v }, v)); s.value = String(o.value);
      s.addEventListener('change', () => { void send(A, { cmd: 'option', name: o.name, value: s.value }, `${o.label}: ${s.value}`).then((ok) => { if (ok) o.value = s.value; }); });
      ctl = h('span', { class: 'select-wrap', html: iconSvg('chevron-down') }); ctl.prepend(s);
    } else {
      const i = h('input', { class: 'input mono', value: String(o.value), 'aria-label': o.label, inputmode: 'numeric', disabled: !on, title: `${o.min ?? ''} to ${o.max ?? ''}` });
      i.addEventListener('change', () => { const n = parseInt(i.value, 10); if (Number.isNaN(n) || (o.min != null && n < o.min) || (o.max != null && n > o.max)) { i.classList.add('is-error'); A.toast('warn', `${o.label}: ${o.min} to ${o.max}`); return; } i.classList.remove('is-error'); void send(A, { cmd: 'option', name: o.name, value: n }, `${o.label}: ${n}`).then((ok) => { if (ok) o.value = n; }); });
      ctl = i;
    }
    return h('div', { class: 'opt-row' }, h('span', null, o.label, h('span', { class: 'faint mono', style: 'margin-left:var(--s-2);font-size:var(--fs-xs)' }, o.name)), ctl);
  }
}

// ------------------------------------------------------------------ virtual pad
const KEYMAP: Record<string, PadButton> = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', z: 'A', x: 'B', a: 'X', s: 'Y', Enter: 'START' };
class Pad implements Editor {
  el: HTMLElement; private readout = h('div', { class: 'pad-readout' }); private btns = new Map<PadButton, HTMLButtonElement>();
  private knob = h('i'); private stickEl = h('div', { class: 'stick', role: 'slider', 'aria-label': 'Analogue stick', tabindex: '0' }); private lastSent = 0; private pending = false; private shown = -1;
  private note = h('div');
  constructor(private app: App) {
    const pb = (b: PadButton, label: string = b, cls = '') => { const x = h('button', { class: `pbtn ${cls}`, 'aria-label': b, 'aria-pressed': 'false', title: b }, label); this.btns.set(b, x);
      x.addEventListener('pointerdown', (e) => { e.preventDefault(); x.setPointerCapture(e.pointerId); S.held.add(b); this.changed(); });
      const up = () => { if (S.held.delete(b)) this.changed(); }; x.addEventListener('pointerup', up); x.addEventListener('pointercancel', up); return x; };
    const cell = (x?: HTMLElement) => x ?? h('span');
    const dpad = h('div', { class: 'dpad' }, cell(), pb('UP', '▲'), cell(), pb('LEFT', '◀'), cell(), pb('RIGHT', '▶'), cell(), pb('DOWN', '▼'), cell());
    const face = h('div', { class: 'face' }, cell(), pb('Y'), cell(), pb('X'), cell(), pb('B'), cell(), pb('A'), cell());
    const trig = (side: 'lt' | 'rt') => { const r = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '0', 'aria-label': side === 'lt' ? 'Left trigger' : 'Right trigger' }); r.addEventListener('input', () => { S[side] = Number(r.value); this.changed(); }); r.addEventListener('change', () => { r.value = '0'; S[side] = 0; this.changed(); }); return h('label', { class: `trig ${side === 'rt' ? 'r' : ''}` }, h('span', { class: 'pad-cap' }, side === 'lt' ? 'L trigger' : 'R trigger'), r); };
    this.stickEl.append(this.knob);
    this.stickEl.addEventListener('pointerdown', (e) => {
      this.stickEl.setPointerCapture(e.pointerId); this.stickEl.classList.add('is-held');
      const mv = (m: PointerEvent) => { const r = this.stickEl.getBoundingClientRect(); let x = ((m.clientX - r.left) / r.width) * 2 - 1, y = ((m.clientY - r.top) / r.height) * 2 - 1; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } S.stick = [Math.round(x * 100) / 100, Math.round(y * 100) / 100]; this.changed(); };
      const up = () => { this.stickEl.classList.remove('is-held'); S.stick = [0, 0]; this.changed(); this.stickEl.removeEventListener('pointermove', mv); this.stickEl.removeEventListener('pointerup', up); };
      mv(e); this.stickEl.addEventListener('pointermove', mv); this.stickEl.addEventListener('pointerup', up);
    });
    const start = pb('START', 'Start', 'start');
    this.el = h('div', { class: 'with-bar' }, this.note, h('div', { class: 'grow-body' }, h('div', { class: 'pad', tabindex: '0', 'aria-label': 'Virtual pad: arrows, Z A, X B, A X, S Y, Enter Start' },
      trig('lt'), trig('rt'),
      h('div', { class: 'grp' }, dpad, h('span', { class: 'pad-cap' }, 'd-pad: arrows')), h('div', { class: 'grp' }, this.stickEl, h('span', { class: 'pad-cap' }, 'stick: drag')),
      h('div', { class: 'grp' }, start, h('span', { class: 'pad-cap' }, 'Enter')), h('div', { class: 'grp' }, face, h('span', { class: 'pad-cap' }, 'Z A · X B · A X · S Y')),
      this.readout)));
    const padEl = this.el.querySelector('.pad') as HTMLElement;
    padEl.addEventListener('keydown', (e) => { const b = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()]; if (!b || e.repeat) return; e.preventDefault(); e.stopPropagation(); S.held.add(b); this.changed(); });
    padEl.addEventListener('keyup', (e) => { const b = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()]; if (!b) return; e.stopPropagation(); S.held.delete(b); this.changed(); });
  }
  meta(): string { return linked(this.app) ? 'held until released' : 'not linked'; }
  private changed(): void { S.padV++; const t = performance.now(); if (t - this.lastSent > 50) this.flush(); else if (!this.pending) { this.pending = true; setTimeout(() => { this.pending = false; this.flush(); }, 50); } }
  private flush(): void { this.lastSent = performance.now(); void send(this.app, { cmd: 'pad', state: { buttons: [...S.held], stick: S.stick, lt: S.lt, rt: S.rt } }, `Pad: ${[...S.held].join(' ') || 'released'}`, true); }
  frame(): void {
    const k = S.padV * 2 + (linked(this.app) ? 1 : 0); if (k === this.shown) return; this.shown = k;
    for (const [b, x] of this.btns) { const on = S.held.has(b); x.classList.toggle('is-held', on); x.setAttribute('aria-pressed', String(on)); }
    this.knob.style.left = `${50 + S.stick[0] * 38}%`; this.knob.style.top = `${50 + S.stick[1] * 38}%`;
    this.readout.textContent = `${[...S.held].join(' ') || 'nothing held'} · stick ${S.stick[0].toFixed(2)} ${S.stick[1].toFixed(2)} · L ${S.lt.toFixed(2)} R ${S.rt.toFixed(2)}`;
  }
}

// ------------------------------------------------------------------ pad scripts
class Scripts implements Editor {
  el: HTMLElement; private ta = h('textarea', { 'aria-label': 'Pad script', spellcheck: 'false' }); private sel = h('select', { class: 'select', 'aria-label': 'Pad script' });
  private status = h('span'); private runBtn: HTMLButtonElement; private built = ''; tools: HTMLElement[];
  constructor(private app: App) {
    this.runBtn = btn('Run on the console', () => void this.run(), { small: true, primary: true, icon: 'play' });
    const selWrap = h('span', { class: 'select-wrap', html: iconSvg('chevron-down') }); selWrap.prepend(this.sel);
    const top = h('div', { class: 'bar' }, selWrap, h('span', { class: 'grow' }), btn('Format help', () => app.toast('info', 'Pad script: one step a line', '<pictures> then what is held: - (nothing), A B X Y START UP DOWN LEFT RIGHT, stick x y, lt v, rt v. # starts a comment.'), { small: true, ghost: true, icon: 'info' }));
    this.el = h('div', { class: 'script-ed' }, top, this.ta, h('div', { class: 'bar' }, this.status, h('span', { class: 'grow' }), this.runBtn));
    this.tools = [toolBtn('download', 'Save the script as a file', () => download(`${S.scriptName || 'pad-script'}.txt`, new Blob([this.ta.value], { type: 'text/plain' })))];
    this.ta.addEventListener('input', () => { S.script = this.ta.value; this.check(); });
    this.sel.addEventListener('change', () => { const s = S.reg?.scripts.find((x) => x.name === this.sel.value); S.script = s?.text ?? '# new pad script\n'; S.scriptName = s?.name ?? 'new'; S.scriptV++; });
  }
  meta(): string { return S.scriptName || 'new script'; }
  private check(): void {
    const p = parsePadScript(this.ta.value);
    this.status.className = p.errors.length ? 'err' : 'muted';
    this.status.innerHTML = p.errors.length ? `${iconSvg('circle-alert')} line ${p.errors[0].line}: ${esc(p.errors[0].msg)}` : `${p.steps.length} steps, ${p.pictures} pictures (${(p.pictures / (this.app.store.rate || 30)).toFixed(1)} s)`;
    this.runBtn.disabled = !!p.errors.length || !p.steps.length || !linked(this.app);
  }
  private async run(): Promise<void> { const p = parsePadScript(this.ta.value); if (p.errors.length) return; await send(this.app, { cmd: 'pad', steps: p.steps }, `Pad script ${S.scriptName || ''} (${p.pictures} pictures)`); }
  frame(): void {
    void loadRegistry(this.app);
    const k = `${S.regV}|${S.scriptV}|${linked(this.app)}`; if (k === this.built) return; this.built = k;
    this.sel.replaceChildren(...(S.reg?.scripts ?? []).map((s) => h('option', { value: s.name }, s.name)), h('option', { value: '' }, 'New script'));
    this.sel.value = S.scriptName && S.reg?.scripts.some((s) => s.name === S.scriptName) ? S.scriptName : '';
    if (this.ta.value !== S.script) this.ta.value = S.script;
    this.check();
  }
}

// ------------------------------------------------------------------ history
class History implements Editor {
  el = h('div'); bodyClass = 'scroll'; private built = -1; tools: HTMLElement[];
  constructor(private app: App) { this.tools = [toolBtn('trash-2', 'Clear the history', () => { S.hist = []; S.histV++; })]; }
  meta(): string { return `${S.hist.length} sent`; }
  frame(): void {
    if (S.histV === this.built) return; this.built = S.histV;
    if (!S.hist.length) { this.el.replaceChildren(empty('history', 'Nothing sent yet', linked(this.app) ? 'Warps, steps, options and pad input appear here with the console\'s answer.' : 'Commands appear here once a console is linked.')); return; }
    this.el.innerHTML = `<table class="table dense"><thead><tr><th>Time</th><th>Command</th><th>Answer</th><th class="num">Picture</th></tr></thead><tbody>${S.hist.map((x) =>
      `<tr><td class="mono muted">${x.t}</td><td><span class="ellipsis" title="${esc(x.label)}">${esc(x.label)}</span></td><td>${x.ok == null ? `<span class="pill">${iconSvg('loader-circle', 16, 'spin')}sent</span>` : x.ok ? `<span class="pill ok">${iconSvg('check')}${esc(x.detail)}</span>` : `<span class="pill err" title="${esc(x.detail)}">${iconSvg('circle-x')}<span class="ellipsis">${esc(x.detail)}</span></span>`}</td><td class="num">${x.n ?? '-'}</td></tr>`).join('')}</tbody></table>`;
  }
}

export const commandEditors: EditorDef[] = [
  { id: 'warp', title: 'Warp presets', icon: 'crosshair', group: 'Commands', create: (app) => new Warp(app) },
  { id: 'control', title: 'Console control', icon: 'sliders-horizontal', group: 'Commands', create: (app) => new Control(app) },
  { id: 'pad', title: 'Virtual pad', icon: 'gamepad-2', group: 'Commands', create: (app) => new Pad(app) },
  { id: 'padscripts', title: 'Pad scripts', icon: 'file-code', group: 'Commands', create: (app) => new Scripts(app) },
  { id: 'cmdlog', title: 'Sent commands', icon: 'history', group: 'Commands', create: (app) => new History(app) },
];
