import { desktop } from '../platform/desktop';
// Assets: drop a model or texture, see what the Dreamcast would pay, the PC preview beside the console's view.
// The console side is a labelled mock until the link sends assets (plan 2a, milestone L5b). Sizes are computed.
// The build's own disc (lane ql-disc): the Asset browser lists the files of the network disc's manifest (base and
// overlay, the side each is read from, its hash); a file opened is decoded (data/assetdec.ts: PVR, PNG, OBJ, glTF, and
// plugins for a game's own formats) and becomes an asset of the same list, shown in the same two views with the same
// camera. The Disc panel shows the overlay, the manifest and the program's reads with their times.
import type { App } from '../ui/app';
import { esc, fitCanvas, h, iconSvg, int, rgbOf, fmt } from '../ui/dom';
import { empty, toolBtn, Watch, type Editor, type EditorDef } from './base';
import { blitFit, render, torusMesh, type Cam, type Mesh } from './pictures';
import { ENDPOINTS, type C1Disc, type C1DiscFile } from '../data/bridge-api';
import type { DiscRecord } from '../data/format';
import { decoderFor, listDecoders, loadPlugins, type DecodedAsset, type DecodedMesh } from '../data/assetdec';

const VRAM = 8 * 1024 * 1024, RAM = 16 * 1024 * 1024, STRIP_VERT = 32;
type AState = 'live' | 'sent' | 'converting' | 'refused' | 'checked';
interface Asset {
  name: string; kind: 'model' | 'texture'; state: AState; tris: number; strips: number; stripVerts: number; texW: number; texH: number; note: string; mock: boolean;
  /** ql-disc, all optional: a file of the build's disc (its path, the side it is read from, its hash) and its decoded form */
  source?: 'drop' | 'disc'; path?: string; side?: 'pc' | 'disc'; sha256?: string; decoded?: DecodedAsset;
}
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
const vram = (a: Asset) => (a.decoded?.textures[0] ? a.decoded.textures[0].vramBytes : a.texW ? texBytes(a.texW, a.texH) : 0);
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

// ---------------------------------------------------------------- the build's disc (lane ql-disc)
const disc = { m: null as C1Disc | null, reads: [] as DiscRecord[], loaded: new Set<string>(), at: 0, busy: false, err: '', v: 0, plugins: false, filter: '' };
const bridgeOn = (app: App) => app.source.kind === 'live';
/** The manifest and the program's reads, every 2 s while a bridge is linked. A path the program opened is "loaded". */
async function refreshDisc(app: App): Promise<void> {
  if (disc.busy || performance.now() - disc.at < 2000 || !bridgeOn(app)) return;
  disc.busy = true; disc.at = performance.now();
  const base = app.bridgeUrl.replace(/\/$/, '');
  try {
    if (!disc.plugins) { disc.plugins = true; const p = await loadPlugins(base); if (p.length) app.toast('info', `Asset plugins: ${p.join(', ')}`, 'Loaded from the bridge\'s plugin folder.'); }
    const m = (await (await fetch(base + ENDPOINTS.disc)).json()) as C1Disc;
    const r = (await (await fetch(base + ENDPOINTS.discReads + '?limit=2000')).json()) as { reads: DiscRecord[] };
    const key = `${m.sha256}|${r.reads.length}|${r.reads[r.reads.length - 1]?.s ?? ''}`;
    if (key !== `${disc.m?.sha256}|${disc.reads.length}|${disc.reads[disc.reads.length - 1]?.s ?? ''}`) {
      disc.m = m; disc.reads = r.reads; disc.loaded = new Set(r.reads.map((x) => (x.path ?? '').toUpperCase())); disc.v++;
    }
    disc.err = '';
  } catch (e) { if (!disc.err) { disc.err = String(e); disc.v++; } }
  finally { disc.busy = false; }
}
function toMesh(d: DecodedMesh): Mesh {
  const n = d.positions.length / 3; let cx = 0, cy = 0, cz = 0; for (let i = 0; i < n; i++) { cx += d.positions[i * 3]; cy += d.positions[i * 3 + 1]; cz += d.positions[i * 3 + 2]; }
  cx /= n || 1; cy /= n || 1; cz /= n || 1; let r = 1e-6;
  for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(d.positions[i * 3] - cx, d.positions[i * 3 + 1] - cy, d.positions[i * 3 + 2] - cz));
  const s = 1.3 / r; const V: Mesh['V'] = []; const T: number[][] = [];
  const nrm = d.normals ?? new Float32Array(n * 3);
  if (!d.normals) for (let t = 0; t + 2 < d.indices.length; t += 3) {   // face normals summed per vertex
    const [a, b, c] = [d.indices[t], d.indices[t + 1], d.indices[t + 2]]; const p = (k: number, j: number) => d.positions[k * 3 + j];
    const ux = p(b, 0) - p(a, 0), uy = p(b, 1) - p(a, 1), uz = p(b, 2) - p(a, 2), vx = p(c, 0) - p(a, 0), vy = p(c, 1) - p(a, 1), vz = p(c, 2) - p(a, 2);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const k of [a, b, c]) { nrm[k * 3] += nx; nrm[k * 3 + 1] += ny; nrm[k * 3 + 2] += nz; }
  }
  for (let i = 0; i < n; i++) { const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1; V.push({ p: [(d.positions[i * 3] - cx) * s, (d.positions[i * 3 + 1] - cy) * s, (d.positions[i * 3 + 2] - cz) * s], n: [nrm[i * 3] / l, nrm[i * 3 + 1] / l, nrm[i * 3 + 2] / l], uv: d.uvs ? [d.uvs[i * 2] * 4, d.uvs[i * 2 + 1] * 4] : [0, 0] }); }
  for (let t = 0; t + 2 < d.indices.length; t += 3) T.push([d.indices[t], d.indices[t + 1], d.indices[t + 2]]);
  return { V, T, strips: Math.max(1, Math.round(T.length / 40)), stripVerts: Math.round(T.length * 1.1 + 2) };
}
const meshes = new WeakMap<DecodedAsset, Mesh>();
const meshOf = (a: Asset): Mesh => { const d = a.decoded; if (!d?.mesh) return torus; let m = meshes.get(d); if (!m) { m = toMesh(d.mesh); meshes.set(d, m); } return m; };
const texCanvas = new WeakMap<object, HTMLCanvasElement>();
function mipCanvas(a: Asset, level = 0): HTMLCanvasElement | null {
  const t = a.decoded?.textures[0]; const mp = t?.mips[Math.min(level, (t?.mips.length ?? 1) - 1)]; if (!t || !mp) return null;
  let cv = texCanvas.get(mp); if (cv) return cv;
  cv = document.createElement('canvas'); cv.width = mp.w; cv.height = mp.h; cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(mp.rgba), mp.w, mp.h), 0, 0); texCanvas.set(mp, cv); return cv;
}
async function openDiscFile(app: App, f: C1DiscFile): Promise<void> {
  const base = app.bridgeUrl.replace(/\/$/, ''); const name = f.path.split('/').pop() ?? f.path;
  const dec = decoderFor(f.path);
  if (!dec) { app.toast('warn', `${name}: no decoder for this file type`, `Built in: ${listDecoders().map((d) => d.exts.join(' ')).join(', ')}. A game's own formats come as plugins in the bridge's --asset-plugins folder.`); return; }
  try {
    const get = async (p: string) => { const r = await fetch(base + ENDPOINTS.discFile(p)); if (!r.ok) throw new Error(`${p}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
    const d = await dec.decode(await get(f.path), name, { sibling: async (n) => { try { return await get(dir + n); } catch { return null; } } });
    const t = d.textures[0]; const tris = d.mesh ? d.mesh.indices.length / 3 : 0;
    const a: Asset = { name, kind: d.kind, state: 'checked', tris, strips: Math.max(tris ? 1 : 0, Math.round(tris / 40)), stripVerts: tris ? Math.round(tris * 1.1 + 2) : 0, texW: t?.width ?? 0, texH: t?.height ?? 0,
      note: t ? `${t.format}, ${t.layout}, ${t.mips.length} mip level${t.mips.length === 1 ? '' : 's'}` : `${d.decoder}: ${int(tris)} triangles; strips estimated at 1.1 a triangle`, mock: false,
      source: 'disc', path: f.path, side: f.side, sha256: f.sha256, decoded: d };
    if (!fits(a)) { a.state = 'refused'; a.note = 'over the live-asset budget'; }
    const i = assets.findIndex((x) => x.source === 'disc' && x.path === f.path); if (i >= 0) assets.splice(i, 1);
    assets.unshift(a); app.view.set('asset', 0); version++;
  } catch (e) { app.toast('err', `Could not open ${name}`, String(e)); }
}

class AssetList implements Editor {
  el = h('div'); bodyClass = 'scroll'; tools: HTMLElement[]; private built = '';
  private input = h('input', { type: 'file', accept: '.png,.obj', class: 'sr-only', multiple: true });
  private find = h('input', { class: 'input', type: 'search', placeholder: 'Filter the disc', 'aria-label': 'Filter the disc\'s files' });
  constructor(private app: App) {
    this.tools = [toolBtn('plus', 'Add a model or texture', () => this.input.click())];
    this.input.addEventListener('change', async () => { for (const f of this.input.files ?? []) await addFile(app, f); this.input.value = ''; });
    this.find.addEventListener('input', () => { disc.filter = this.find.value.trim().toUpperCase(); disc.v++; });
  }
  meta(): string { const n = disc.m?.files.length ?? 0; return `${assets.length} assets${n ? ` · disc ${int(n)} files` : ''}`; }
  frame(): void {
    void refreshDisc(this.app);
    const k = `${version}|${this.app.view.asset}|${disc.v}|${bridgeOn(this.app)}`; if (k === this.built) return; this.built = k;
    const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Drop a model or texture, or press Enter to choose a file' },
      h('span', { class: 't', html: iconSvg('file-up') }, 'Drop a model or texture'), h('span', null, 'PNG or OBJ. Checked against the console budget on this PC. Sending waits for the link (mock).'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('is-over'); for (const f of e.dataTransfer?.files ?? []) await dropFile(this.app, f); });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.input.click(); } });
    const rows = assets.map((a, i) => {
      const [k, ic, t] = pill(a.state);
      const loaded = a.path && disc.loaded.has(a.path.toUpperCase());
      const r = h('div', { class: 'asset' + (i === this.app.view.asset ? ' is-selected' : ''), tabindex: '0', role: 'option', 'aria-selected': String(i === this.app.view.asset) });
      r.innerHTML = `<span class="thumb">${iconSvg(a.kind === 'texture' ? 'image' : 'box')}</span><span class="ellipsis strong" title="${esc(a.path ?? a.name)}">${esc(a.name)}</span><span class="pill ${loaded ? 'ok' : k}">${loaded ? `${iconSvg('circle-dot')}loaded by the program` : `${iconSvg(ic, 16, a.state === 'converting' ? 'spin' : '')}${t}`}</span><span class="sub ellipsis" title="${esc(a.note)}">${a.source === 'disc' ? `disc, from ${a.side === 'pc' ? 'the PC' : 'GDEMU'} · ` : ''}${a.tris ? `${int(a.tris)} tris · ${int(a.strips)} strips · ` : ''}${esc(a.note)}</span>`;
      r.addEventListener('click', () => this.app.view.set('asset', i));
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.app.view.set('asset', i); });
      return r;
    });
    this.el.replaceChildren(drop, ...rows, this.discSection(), this.input);
  }
  private discSection(): HTMLElement {
    const m = disc.m; const sec = h('div', { class: 'prop-section' }, h('div', { class: 'section-title', html: iconSvg('disc-3') }, h('span', null, 'The build\'s disc')));
    if (!bridgeOn(this.app)) { sec.append(h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'Link to a bridge that serves a network disc to list its files here.')); return sec; }
    if (!m || !m.mode) { sec.append(h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, m?.note ?? (disc.err ? `The bridge did not answer: ${disc.err}` : 'Reading the manifest...'))); return sec; }
    sec.append(h('div', { class: 'muted', style: 'font-size:var(--fs-xs);margin-bottom:var(--s-2)' }, `${m.mode === 'whole' ? 'Whole disc from the PC' : 'Overlay on the GDEMU disc'} · ${int(m.count ?? m.files.length)} files, ${int(m.served ?? 0)} from the PC · manifest ${m.sha256?.slice(0, 12) ?? '-'}`), this.find);
    const list = m.files.filter((f) => !disc.filter || f.path.toUpperCase().includes(disc.filter)).slice(0, 400);
    for (const f of list) {
      const loaded = disc.loaded.has(f.path.toUpperCase()); const canOpen = !!decoderFor(f.path);
      const r = h('div', { class: 'asset' + (canOpen ? '' : ' is-muted'), tabindex: '0', role: 'option', title: `${f.path}\n${f.sha256}` });
      r.innerHTML = `<span class="thumb">${iconSvg(/\.(pvr|png)$/i.test(f.path) ? 'image' : /\.(obj|gltf|glb)$/i.test(f.path) ? 'box' : 'file-text')}</span><span class="ellipsis strong">${esc(f.path)}</span><span class="pill ${f.side === 'pc' ? 'info' : ''}">${f.side === 'pc' ? (f.changed ? (f.new ? 'new, from the PC' : 'changed, from the PC') : 'from the PC') : 'from GDEMU'}</span><span class="sub ellipsis mono">${int(f.size)} B · ${f.sha256.slice(0, 12)}${loaded ? ' · loaded by the program' : ''}${canOpen ? '' : ' · no decoder'}</span>`;
      const go = () => { if (canOpen) void openDiscFile(this.app, f); };
      r.addEventListener('click', go); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      sec.append(r);
    }
    if (list.length === 400) sec.append(h('div', { class: 'faint', style: 'font-size:var(--fs-xs)' }, 'The first 400 shown: filter to find others.'));
    return sec;
  }
}

/** The camera both views share: plain data (yaw, pitch, distance, field of view in radians), what plan L5b sends. */
const cam: Cam = { yaw: (35 * Math.PI) / 180, pitch: (28 * Math.PI) / 180, dist: 3.1, fov: (50 * Math.PI) / 180 };
let camV = 0;
let mipView = 0;
class Viewport implements Editor {
  el: HTMLElement; tools?: HTMLElement[]; private cv = h('canvas', { class: 'fill' }); private w = new Watch(); private note = h('span', { class: 'area-note' }); private lbl = h('span', { class: 'area-note left top' });
  constructor(private app: App, private dc: boolean) {
    this.el = h('div', { class: 'fill' }, this.cv, this.note, this.lbl);
    this.cv.setAttribute('aria-label', dc ? 'On the Dreamcast (mock render)' : 'PC preview, drag to orbit');
    if (!dc) {
      this.tools = [toolBtn('rotate-ccw', 'Reset the camera', () => { cam.yaw = (35 * Math.PI) / 180; cam.pitch = (28 * Math.PI) / 180; camV++; }),
        toolBtn('layers', 'Next mip level (textures)', () => { mipView++; camV++; })];
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
    if (a?.decoded?.kind === 'texture') {   // a decoded texture: its mip level, nearest, on both sides (the console's grab comes with L5b)
      const t = a.decoded.textures[0]; const lv = mipView % Math.max(1, t.mips.length); const tc = mipCanvas(a, lv);
      g.clearRect(0, 0, w, hh); if (tc) blitFit(g, w, hh, tc, 'fit', 1, undefined, false);
      this.note.textContent = this.dc ? 'mock: the PC decode, not a console capture' : `${t.format} · ${t.layout} · level ${lv + 1} of ${t.mips.length}, ${t.mips[lv]?.w} x ${t.mips[lv]?.h}${t.note ? ' · ' + t.note : ''}`;
      this.lbl.textContent = ''; this.lbl.hidden = true; return;
    }
    const mesh = meshOf(a ?? assets[0]);
    if (this.dc) { const img = render(mesh, cam, { w: 640, h: 480, nearest: true, rgb565: true, ...cols }); blitFit(g, w, hh, img); this.note.textContent = 'mock, not a console capture · 640x480 · nearest · 16-bit'; this.lbl.textContent = ''; this.lbl.hidden = true; }
    else { const img = render(mesh, cam, { w: Math.max(64, Math.round(w)), h: Math.max(48, Math.round(hh)), ...cols }); g.drawImage(img, 0, 0, w, hh); this.note.textContent = a ? (a.decoded ? `${a.name} (${a.decoded.decoder}), checker material` : `${a.name} shown as the sample torus`) : ''; this.lbl.textContent = `orbit yaw ${((cam.yaw * 180) / Math.PI).toFixed(1)} pitch ${((cam.pitch * 180) / Math.PI).toFixed(1)} distance ${cam.dist.toFixed(2)} fov 50`; }
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
    if (a.texW) rows.push(['Convert texture', a.decoded?.textures[0] && a.decoded.decoder === 'pvr' ? `already Dreamcast form: ${a.decoded.textures[0].format}, ${a.decoded.textures[0].layout}, ${int(vram(a))} B` : `${a.texW} x ${a.texH} RGB565, twiddled, mip maps, ${int(vram(a))} B`, st(a.state === 'converting' ? 'warn' : 'ok', a.state === 'converting' ? 'running' : 'done')]);
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
    const k = `${version}|${this.app.view.asset}|${disc.v}`; if (k === this.built) return; this.built = k;
    const a = assets[this.app.view.asset]; if (!a) { this.el.replaceChildren(); return; }
    const meter = (label: string, v: number, max: number, text: string) => `<div style="display:grid;gap:var(--s-1);margin-bottom:var(--s-3)"><div class="row" style="font-size:var(--fs-xs)"><span class="muted">${label}</span><span class="grow"></span><span class="mono strong">${text}</span></div><div class="meter${v > max ? ' over' : v > max * 0.8 ? ' warn' : ''}"><i style="width:${Math.min(100, (v / max) * 100).toFixed(1)}%"></i></div></div>`;
    const [kc, ic, t] = pill(a.state);
    const tx = a.decoded?.textures[0];
    const dl = (rows: [string, string][]) => `<dl class="props">${rows.map(([x, y]) => `<dt>${esc(x)}</dt><dd>${esc(y)}</dd>`).join('')}</dl>`;
    this.el.innerHTML = `<div class="prop-section"><div class="section-title">${iconSvg(a.kind === 'texture' ? 'image' : 'box')}<span class="ellipsis" title="${esc(a.name)}">${esc(a.name)}</span></div><span class="pill ${kc}">${iconSvg(ic)}${t}</span></div>
      ${a.source === 'disc' ? `<div class="prop-section"><div class="section-title">${iconSvg('disc-3')}On the build's disc</div>${dl([['Path', a.path ?? ''], ['Read from', a.side === 'pc' ? 'the PC (overlay or whole disc)' : 'GDEMU (the console\'s own disc)'], ['SHA-256', (a.sha256 ?? '').slice(0, 16) + '...'], ['Loaded by the program', a.path && disc.loaded.has(a.path.toUpperCase()) ? 'yes' : 'not seen'], ['Decoder', a.decoded?.decoder ?? '-'], ...(a.decoded?.info ?? [])])}</div>` : ''}
      ${a.kind === 'model' ? `<div class="prop-section"><dl class="props"><dt>Triangles</dt><dd>${int(a.tris)}</dd><dt>Strips</dt><dd>${int(a.strips)}</dd><dt>Strip vertices</dt><dd>${int(a.stripVerts)}</dd><dt>Bytes a strip vertex</dt><dd>${STRIP_VERT}</dd>${a.decoded?.mesh ? `<dt>Materials</dt><dd>${esc(a.decoded.mesh.materials.map((m) => m.name + (m.texture ? ` (${m.texture})` : '')).join(', ') || 'none')}</dd>` : ''}</dl></div>` : ''}
      ${a.texW ? `<div class="prop-section"><div class="section-title">${iconSvg('image')}Texture</div><dl class="props"><dt>Format</dt><dd>${esc(tx ? tx.format : 'RGB565')}, ${esc(tx ? tx.layout : 'twiddled')}</dd><dt>Size</dt><dd>${a.texW} x ${a.texH}</dd>${tx ? `<dt>Mip levels</dt><dd>${tx.mips.length}: ${esc(tx.mips.map((m) => `${m.w}x${m.h}`).join(' '))}</dd>` : ''}<dt>Bytes${tx?.vramBytes ? ' in graphics memory' : ' with mips'}</dt><dd>${int(vram(a))}</dd></dl>${tx?.note ? `<div class="faint" style="font-size:var(--fs-xs)">${esc(tx.note)}</div>` : ''}</div>` : ''}
      <div class="prop-section"><div class="section-title">${iconSvg('memory-stick')}Budget for live assets</div>
        ${meter('Main memory, a quarter of 16 MB', ram(a), RAM / 4, `${int(ram(a))} B`)}
        ${meter('Graphics memory, half of 8 MB', vram(a), VRAM / 2, `${int(vram(a))} B`)}
        ${meter('Time to draw, budget 14.0 ms', 0, 14, 'not measured')}
        ${a.state === 'refused' ? `<div class="field"><span class="err">${iconSvg('circle-alert')}Over budget: not sent.</span></div>` : ''}
        <div class="faint" style="font-size:var(--fs-xs)">Draw time appears once the console has drawn it. ${a.mock ? 'This entry is sample data.' : a.source === 'disc' ? 'Decoded from the build\'s disc on this PC.' : 'Computed from your file on this PC.'}</div></div>`;
  }
}

/** The network disc: what is served, the manifest, and the program's reads with their times (lane ql-disc). */
class DiscPanel implements Editor {
  el = h('div'); bodyClass = 'scroll'; private built = '';
  constructor(private app: App) {}
  meta(): string { const m = disc.m; return m?.mode ? `${m.mode === 'whole' ? 'whole disc' : 'overlay'} · ${int(disc.reads.length)} reads` : 'no network disc'; }
  frame(): void {
    void refreshDisc(this.app);
    const k = `${disc.v}|${bridgeOn(this.app)}`; if (k === this.built) return; this.built = k;
    const m = disc.m;
    if (!bridgeOn(this.app) || !m?.mode) { this.el.replaceChildren(empty('disc-3', 'No network disc', bridgeOn(this.app) ? (m?.note ?? 'Reading the bridge...') : 'Link to a bridge started with --disc <folder or .gdi/.iso> and --overlay <folder>. A program that mounts lib/dcql_disc then reads /cd from it.')); return; }
    const st = m.stats; const pr = st?.program_reads ?? {}; const rq = st?.request_ms;
    const side = (s: string) => pr[s] ? `${int(pr[s].records)} reads, ${int(pr[s].bytes)} B in ${fmt(pr[s].ms, 1)} ms${pr[s].MBps != null ? ` (${fmt(pr[s].MBps, 2)} MB/s)` : ''}` : 'none';
    const served = m.files.filter((f) => f.side === 'pc');
    const reads = disc.reads.filter((r) => r.op === 'read').slice(-200).reverse();
    this.el.innerHTML = `<div class="prop-section"><div class="section-title">${iconSvg('disc-3')}${m.mode === 'whole' ? 'Whole disc from the PC' : 'Overlay on the console\'s disc'}</div>
      <dl class="props"><dt>Base</dt><dd class="mono"><span class="ellipsis" title="${esc(m.base?.path ?? '')}">${esc(m.base ? `${m.base.kind} ${m.base.path}${m.base.volume ? ` (${m.base.volume})` : ''}` : 'none (every overlay file is served)')}</span></dd>
      <dt>Overlay</dt><dd class="mono"><span class="ellipsis" title="${esc(m.overlay?.path ?? '')}">${esc(m.overlay ? `${m.overlay.path}, ${m.overlay.files} files` : 'none')}</span></dd>
      <dt>Manifest</dt><dd class="mono">${esc(m.sha256?.slice(0, 16) ?? '-')} · ${int(m.count ?? 0)} files, ${int(served.length)} from the PC</dd>
      <dt>From the PC</dt><dd>${side('pc')}</dd><dt>From GDEMU</dt><dd>${side('disc')}</dd>
      <dt>Requests</dt><dd>${int(st?.requests ?? 0)}, ${int(st?.resend_requests ?? 0)} resent${rq ? `; round trip ${fmt(rq.mean, 2)} ms mean, ${fmt(rq.p99, 2)} p99, ${fmt(rq.worst, 2)} worst (the console's clock)` : ''}</dd></dl>
      <div class="faint" style="font-size:var(--fs-xs)">Times are the console's, measured inside its read calls; their tier is the device's (Flycast: function only, not a console speed).</div></div>
      <div class="prop-section"><div class="section-title">${iconSvg('upload')}Served from the PC</div><table class="table dense"><thead><tr><th>File</th><th class="num">Bytes</th><th>Why</th><th>SHA-256</th></tr></thead><tbody>${served.slice(0, 200).map((f) => `<tr><td class="mono"><span class="ellipsis" title="${esc(f.path)}">${esc(f.path)}</span></td><td class="num">${int(f.size)}</td><td>${m.mode === 'whole' ? 'whole disc' : f.new ? 'new' : 'changed'}</td><td class="mono muted">${f.sha256.slice(0, 12)}</td></tr>`).join('')}</tbody></table></div>
      <div class="prop-section"><div class="section-title">${iconSvg('timer')}The program's reads, newest first</div><table class="table dense"><thead><tr><th>File</th><th class="num">Offset</th><th class="num">Bytes</th><th class="num">ms</th><th class="num">MB/s</th><th>From</th></tr></thead><tbody>${reads.map((r) => `<tr><td class="mono"><span class="ellipsis" title="${esc(r.path ?? '')}">${esc(r.path ?? '')}</span></td><td class="num">${int(r.off ?? 0)}</td><td class="num">${int(r.bytes ?? 0)}</td><td class="num">${fmt(r.ms ?? 0, 2)}</td><td class="num">${r.ms ? fmt((r.bytes ?? 0) / (r.ms * 1000), 2) : '-'}</td><td><span class="pill ${r.side === 'pc' ? 'info' : ''}">${r.side === 'pc' ? 'PC' : 'GDEMU'}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No reads yet: run a program that mounts the network disc.</td></tr>'}</tbody></table></div>`;
  }
}

export const assetEditors: EditorDef[] = [
  { id: 'assetlist', title: 'Asset browser', icon: 'box', group: 'Assets', create: (app) => new AssetList(app) },
  { id: 'preview', title: 'PC preview', icon: 'monitor', group: 'Assets', create: (app) => new Viewport(app, false) },
  { id: 'dcview', title: 'On the Dreamcast', icon: 'gamepad-2', group: 'Assets', create: (app) => new Viewport(app, true) },
  { id: 'sync', title: 'Sync', icon: 'refresh-cw', group: 'Assets', create: (app) => new Sync(app) },
  { id: 'assetprops', title: 'Asset properties', icon: 'settings', group: 'Assets', create: (app) => new AssetProps(app) },
  { id: 'disc', title: 'Disc', icon: 'disc-3', group: 'Assets', create: (app) => new DiscPanel(app) },
];

/** For plan L5b ("view on console"): the selected asset's decoded form and the shared camera, as plain data. */
export function selectedForConsole(app: App): { asset: { name: string; path?: string; sha256?: string; decoded?: DecodedAsset } | null; camera: Cam } {
  const a = assets[app.view.asset]; return { asset: a ? { name: a.name, path: a.path, sha256: a.sha256, decoded: a.decoded } : null, camera: { ...cam } };
}
