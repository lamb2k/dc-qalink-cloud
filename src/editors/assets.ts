import { desktop } from '../platform/desktop';
// Assets: drop a model or texture, see what the Dreamcast would pay, the PC preview beside the console's view.
// The console side is a labelled mock until the link sends assets (plan 2a, milestone L5b). Sizes are computed.
import type { App } from '../ui/app';
import { esc, fitCanvas, h, iconSvg, int, rgbOf } from '../ui/dom';
import { empty, toolBtn, Watch, type Editor, type EditorDef } from './base';
import { blitFit, render, torusMesh, type Cam } from './pictures';

const VRAM = 8 * 1024 * 1024, RAM = 16 * 1024 * 1024, STRIP_VERT = 32;
type AState = 'live' | 'sent' | 'converting' | 'refused' | 'checked';
interface Asset { name: string; kind: 'model' | 'texture'; state: AState; tris: number; strips: number; stripVerts: number; texW: number; texH: number; note: string; mock: boolean }
const torus = torusMesh();
const texBytes = (w: number, h: number) => { let b = 0; for (let s = Math.max(w, h); s >= 1; s >>= 1) b += Math.max(1, (w * s) / Math.max(w, h)) * Math.max(1, (h * s) / Math.max(w, h)) * 2; return Math.round(b); };
const assets: Asset[] = [
  { name: 'torus_checker.gltf', kind: 'model', state: 'live', tris: torus.T.length, strips: torus.strips, stripVerts: torus.stripVerts, texW: 256, texH: 256, note: 'RGB565, twiddled, 9 mip levels', mock: true },
  { name: 'uv_sphere_32.obj', kind: 'model', state: 'sent', tris: 1984, strips: 32, stripVerts: 32 * 33 * 2, texW: 0, texH: 0, note: 'no texture', mock: true },
  { name: 'checker_512.png', kind: 'texture', state: 'converting', tris: 0, strips: 0, stripVerts: 0, texW: 512, texH: 512, note: 'to twiddled VQ 512x512 + mip maps', mock: true },
  { name: 'sphere_dense_512.obj', kind: 'model', state: 'refused', tris: 524288, strips: 512, stripVerts: 512 * 513 * 2, texW: 0, texH: 0, note: 'refused before sending', mock: true },
];
let version = 0;
const ram = (a: Asset) => a.stripVerts * STRIP_VERT;
const vram = (a: Asset) => (a.texW ? texBytes(a.texW, a.texH) : 0);
const fits = (a: Asset) => ram(a) <= RAM / 4 && vram(a) <= VRAM / 2;
const pill = (s: AState) => ({ live: ['ok', 'circle-check', 'live on console'], sent: ['info', 'upload', 'sent'], converting: ['warn', 'loader-circle', 'converting'], refused: ['err', 'circle-x', 'over budget'], checked: ['', 'check', 'checked, not sent'] } as const)[s];

async function addFile(app: App, f: File): Promise<void> {
  const lower = f.name.toLowerCase(); let a: Asset;
  if (lower.endsWith('.png')) {
    let w = 0, hh = 0; try { const bm = await createImageBitmap(f); w = bm.width; hh = bm.height; bm.close(); } catch { app.toast('err', `${f.name} is not a readable PNG`); return; }
    a = { name: f.name, kind: 'texture', state: 'checked', tris: 0, strips: 0, stripVerts: 0, texW: w, texH: hh, note: `${w}x${hh} as RGB565 twiddled + mip maps`, mock: false };
  } else if (lower.endsWith('.obj')) {
    const text = await f.text(); let v = 0, t = 0; for (const line of text.split('\n')) { if (line.startsWith('v ')) v++; else if (line.startsWith('f ')) t += Math.max(1, line.trim().split(/\s+/).length - 3); }
    const sv = Math.round(t * 1.1 + 2);
    a = { name: f.name, kind: 'model', state: 'checked', tris: t, strips: Math.max(1, Math.round(t / 40)), stripVerts: sv, texW: 0, texH: 0, note: `${int(v)} vertices; strips estimated at 1.1 a triangle`, mock: false };
  } else { app.toast('warn', `${f.name}: not a PNG or OBJ`, 'glTF arrives with the converter (plan 2a).'); return; }
  if (!fits(a)) { a.state = 'refused'; a.note = 'over budget, not sent'; }
  assets.unshift(a); app.view.set('asset', 0); version++;
  app.toast(a.state === 'refused' ? 'err' : 'ok', a.state === 'refused' ? `${f.name} refused: over budget` : `${f.name} checked`, 'Not sent: the link does not take assets yet. Numbers are computed here.');
}

// The desktop app reads dropped files through window.qalink (the main process checks the path and the kind) and
// watches them: saving the file in the modelling program checks it again. The web page reads the File itself.
const watched = new Map<string, string>(); // handle -> name
let listening = false;
async function dropFile(app: App, f: File): Promise<void> {
  const q = desktop();
  if (!q) { await addFile(app, f); return; }
  try {
    const o = await q.readDropped(f, 'asset');
    await addFile(app, new File([o.bytes as BlobPart], o.name, { lastModified: o.modified }));
    if (!watched.has(o.handle)) { watched.set(o.handle, o.name); await q.watch(o.handle); }
    if (!listening) {
      listening = true;
      q.onFileChanged(async (handle, name) => {
        if (!watched.has(handle)) return;
        const n = await q.reread(handle); const i = assets.findIndex((a) => a.name === name && !a.mock); if (i >= 0) assets.splice(i, 1);
        await addFile(app, new File([n.bytes as BlobPart], n.name)); app.toast('info', `${name} changed on disk`, 'Checked again against the budget.');
      });
    }
  } catch (e) { app.toast('err', `Could not read ${f.name}`, String(e)); }
}

class AssetList implements Editor {
  el = h('div'); bodyClass = 'scroll'; tools: HTMLElement[]; private built = '';
  private input = h('input', { type: 'file', accept: '.png,.obj', class: 'sr-only', multiple: true });
  constructor(private app: App) {
    this.tools = [toolBtn('plus', 'Add a model or texture', () => this.input.click())];
    this.input.addEventListener('change', async () => { for (const f of this.input.files ?? []) await addFile(app, f); this.input.value = ''; });
  }
  meta(): string { return `${assets.length} assets`; }
  frame(): void {
    const k = `${version}|${this.app.view.asset}`; if (k === this.built) return; this.built = k;
    const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Drop a model or texture, or press Enter to choose a file' },
      h('span', { class: 't', html: iconSvg('file-up') }, 'Drop a model or texture'), h('span', null, 'PNG or OBJ. Checked against the console budget on this PC. Sending waits for the link (mock).'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('is-over'); for (const f of e.dataTransfer?.files ?? []) await dropFile(this.app, f); });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.input.click(); } });
    const rows = assets.map((a, i) => {
      const [k, ic, t] = pill(a.state);
      const r = h('div', { class: 'asset' + (i === this.app.view.asset ? ' is-selected' : ''), tabindex: '0', role: 'option', 'aria-selected': String(i === this.app.view.asset) });
      r.innerHTML = `<span class="thumb">${iconSvg(a.kind === 'texture' ? 'image' : 'box')}</span><span class="ellipsis strong" title="${esc(a.name)}">${esc(a.name)}</span><span class="pill ${k}">${iconSvg(ic, 16, a.state === 'converting' ? 'spin' : '')}${t}</span><span class="sub ellipsis" title="${esc(a.note)}">${a.tris ? `${int(a.tris)} tris · ${int(a.strips)} strips · ` : ''}${esc(a.note)}</span>`;
      r.addEventListener('click', () => this.app.view.set('asset', i));
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.app.view.set('asset', i); });
      return r;
    });
    this.el.replaceChildren(drop, ...rows, this.input);
  }
}

const cam: Cam = { yaw: (35 * Math.PI) / 180, pitch: (28 * Math.PI) / 180, dist: 3.1, fov: (50 * Math.PI) / 180 };
let camV = 0;
class Viewport implements Editor {
  el: HTMLElement; tools?: HTMLElement[]; private cv = h('canvas', { class: 'fill' }); private w = new Watch(); private note = h('span', { class: 'area-note' }); private lbl = h('span', { class: 'area-note left top' });
  constructor(private app: App, private dc: boolean) {
    this.el = h('div', { class: 'fill' }, this.cv, this.note, this.lbl);
    this.cv.setAttribute('aria-label', dc ? 'On the Dreamcast (mock render)' : 'PC preview, drag to orbit');
    if (!dc) {
      this.tools = [toolBtn('rotate-ccw', 'Reset the camera', () => { cam.yaw = (35 * Math.PI) / 180; cam.pitch = (28 * Math.PI) / 180; camV++; })];
      this.cv.addEventListener('pointerdown', (e) => {
        this.cv.setPointerCapture(e.pointerId); let lx = e.clientX, ly = e.clientY;
        const mv = (m: PointerEvent) => { cam.yaw += (m.clientX - lx) * 0.01; cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch + (m.clientY - ly) * 0.01)); lx = m.clientX; ly = m.clientY; camV++; };
        const up = () => { this.cv.removeEventListener('pointermove', mv); this.cv.removeEventListener('pointerup', up); };
        this.cv.addEventListener('pointermove', mv); this.cv.addEventListener('pointerup', up);
      });
    } else this.tools = [];
    this.w.observe(this.el);
  }
  meta(): string { const a = assets[this.app.view.asset]; return this.dc ? (a?.state === 'refused' ? 'not sent' : 'mock, same camera') : 'one camera with the console'; }
  private shown = '';
  frame(force: boolean): void {
    if (!this.w.changed(this.app, `${camV}|${version}`) && !force) return;
    const a = assets[this.app.view.asset]; const { g, w, h: hh } = fitCanvas(this.cv);
    const refused = a?.state === 'refused';
    const show = this.dc && refused ? 'refused' : 'render';
    if (show !== this.shown) { this.shown = show; this.el.querySelector('.empty')?.remove(); }
    if (this.dc && refused) {
      g.clearRect(0, 0, w, hh); this.note.hidden = true; this.lbl.hidden = true;
      if (!this.el.querySelector('.empty')) this.el.append(h('div', { class: 'fill-center' }, empty('circle-x', 'Not sent: over the console budget', `${a.name} needs ${int(ram(a))} B of main memory for its strips alone; the console has ${int(RAM)} B in all, and live assets get a quarter. Reduce it to about 20,000 triangles, or split it.`, [], true)));
      return;
    }
    this.el.querySelector('.fill-center')?.remove(); this.note.hidden = false; this.lbl.hidden = false;
    const cols = { bg: this.dc ? [0, 0, 0] : rgbOf('--n-1'), colA: rgbOf('--n-11'), colB: rgbOf('--accent-solid') };
    if (this.dc) { const img = render(torus, cam, { w: 640, h: 480, nearest: true, rgb565: true, ...cols }); blitFit(g, w, hh, img); this.note.textContent = 'mock, not a console capture · 640x480 · nearest · 16-bit'; this.lbl.textContent = ''; this.lbl.hidden = true; }
    else { const img = render(torus, cam, { w: Math.max(64, Math.round(w)), h: Math.max(48, Math.round(hh)), ...cols }); g.drawImage(img, 0, 0, w, hh); this.note.textContent = a ? `${a.name} shown as the sample torus` : ''; this.lbl.textContent = `orbit yaw ${((cam.yaw * 180) / Math.PI).toFixed(1)} pitch ${((cam.pitch * 180) / Math.PI).toFixed(1)} distance ${cam.dist.toFixed(2)} fov 50`; }
  }
  destroy(): void { this.w.stop(); }
}

class Sync implements Editor {
  el = h('div'); bodyClass = 'scroll'; private built = '';
  constructor(private app: App) {}
  meta(): string { return assets[this.app.view.asset]?.name ?? ''; }
  frame(): void {
    const k = `${version}|${this.app.view.asset}`; if (k === this.built) return; this.built = k;
    const a = assets[this.app.view.asset]; if (!a) { this.el.replaceChildren(empty('refresh-cw', 'Nothing selected', 'Pick an asset to see its steps.')); return; }
    const st = (c: string, t: string) => `<span class="pill ${c}">${t}</span>`;
    const refused = a.state === 'refused';
    const rows: [string, string, string][] = [[`Read ${a.name}`, a.kind === 'model' ? `${int(a.tris)} triangles` : `${a.texW} x ${a.texH}`, st('ok', 'done')]];
    if (a.kind === 'model') rows.push(['Build strips', `${int(a.strips)} strips, ${int(a.stripVerts)} strip vertices, ${int(ram(a))} B`, st('ok', 'done')]);
    if (a.texW) rows.push(['Convert texture', `${a.texW} x ${a.texH} RGB565, twiddled, mip maps, ${int(vram(a))} B`, st(a.state === 'converting' ? 'warn' : 'ok', a.state === 'converting' ? 'running' : 'done')]);
    rows.push(['Check budget', `main ${int(ram(a))} B of ${int(RAM / 4)} B, graphics ${int(vram(a))} B of ${int(VRAM / 2)} B`, st(refused ? 'err' : 'ok', refused ? 'refused' : 'fits')]);
    rows.push(['Send to console', refused ? 'not sent' : a.mock ? `broadband adapter, ${int(ram(a) + vram(a))} B (mock)` : 'waits for the link to take assets', st(refused || !a.mock ? '' : a.state === 'live' ? 'ok' : 'info', refused ? 'skipped' : !a.mock ? 'not yet' : a.state === 'live' ? 'sent' : a.state)]);
    if (a.state === 'live') rows.push(['Console grab', '640x480, same camera', st('ok', 'in sync (mock)')]);
    this.el.innerHTML = `<table class="table dense"><thead><tr><th>Step</th><th>Detail</th><th>State</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="mono muted"><span class="ellipsis" title="${esc(r[1])}">${esc(r[1])}</span></td><td>${r[2]}</td></tr>`).join('')}</tbody></table>
      <div class="faint" style="padding:var(--s-2) var(--s-3);font-size:var(--fs-xs)">Sizes are computed (32 B a strip vertex, 16-bit texels with a mip chain). Live assets may use a quarter of main memory and half of graphics memory. The console side is a mock until the link sends assets.</div>`;
  }
}

class AssetProps implements Editor {
  el = h('div'); bodyClass = 'scroll'; private built = '';
  constructor(private app: App) {}
  meta(): string { return 'what the Dreamcast pays'; }
  frame(): void {
    const k = `${version}|${this.app.view.asset}`; if (k === this.built) return; this.built = k;
    const a = assets[this.app.view.asset]; if (!a) { this.el.replaceChildren(); return; }
    const meter = (label: string, v: number, max: number, text: string) => `<div style="display:grid;gap:var(--s-1);margin-bottom:var(--s-3)"><div class="row" style="font-size:var(--fs-xs)"><span class="muted">${label}</span><span class="grow"></span><span class="mono strong">${text}</span></div><div class="meter${v > max ? ' over' : v > max * 0.8 ? ' warn' : ''}"><i style="width:${Math.min(100, (v / max) * 100).toFixed(1)}%"></i></div></div>`;
    const [kc, ic, t] = pill(a.state);
    this.el.innerHTML = `<div class="prop-section"><div class="section-title">${iconSvg(a.kind === 'texture' ? 'image' : 'box')}<span class="ellipsis" title="${esc(a.name)}">${esc(a.name)}</span></div><span class="pill ${kc}">${iconSvg(ic)}${t}</span></div>
      ${a.kind === 'model' ? `<div class="prop-section"><dl class="props"><dt>Triangles</dt><dd>${int(a.tris)}</dd><dt>Strips</dt><dd>${int(a.strips)}</dd><dt>Strip vertices</dt><dd>${int(a.stripVerts)}</dd><dt>Bytes a strip vertex</dt><dd>${STRIP_VERT}</dd></dl></div>` : ''}
      ${a.texW ? `<div class="prop-section"><div class="section-title">${iconSvg('image')}Texture</div><dl class="props"><dt>Format</dt><dd>RGB565, twiddled</dd><dt>Size</dt><dd>${a.texW} x ${a.texH}</dd><dt>Bytes with mips</dt><dd>${int(vram(a))}</dd></dl></div>` : ''}
      <div class="prop-section"><div class="section-title">${iconSvg('memory-stick')}Budget for live assets</div>
        ${meter('Main memory, a quarter of 16 MB', ram(a), RAM / 4, `${int(ram(a))} B`)}
        ${meter('Graphics memory, half of 8 MB', vram(a), VRAM / 2, `${int(vram(a))} B`)}
        ${meter('Time to draw, budget 14.0 ms', 0, 14, 'not measured')}
        ${a.state === 'refused' ? `<div class="field"><span class="err">${iconSvg('circle-alert')}Over budget: not sent.</span></div>` : ''}
        <div class="faint" style="font-size:var(--fs-xs)">Draw time appears once the console has drawn it. ${a.mock ? 'This entry is sample data.' : 'Computed from your file on this PC.'}</div></div>`;
  }
}

export const assetEditors: EditorDef[] = [
  { id: 'assetlist', title: 'Asset browser', icon: 'box', group: 'Assets', create: (app) => new AssetList(app) },
  { id: 'preview', title: 'PC preview', icon: 'monitor', group: 'Assets', create: (app) => new Viewport(app, false) },
  { id: 'dcview', title: 'On the Dreamcast', icon: 'gamepad-2', group: 'Assets', create: (app) => new Viewport(app, true) },
  { id: 'sync', title: 'Sync', icon: 'refresh-cw', group: 'Assets', create: (app) => new Sync(app) },
  { id: 'assetprops', title: 'Asset properties', icon: 'settings', group: 'Assets', create: (app) => new AssetProps(app) },
];
