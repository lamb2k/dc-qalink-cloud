// Asset decoders: a file's bytes -> plain data (textures with their mip levels, a mesh, materials) for the Assets
// workspace's views. Generic decoders ship here (Dreamcast PVR, PNG, OBJ, glTF); a game's own formats are plugins: ES
// modules in a folder outside any repository, served by the bridge (--asset-plugins), each exporting one decoder or a
// list (`export default { id, label, exts, decode }`). The decoded form is plain data on purpose: a later lane (plan L5b,
// "view on console") sends it, with the camera, to the console viewer as it is.

export interface MipLevel { w: number; h: number; rgba: Uint8ClampedArray }
export interface DecodedTexture {
  name: string;
  /** pixel format as the console stores it: ARGB1555, RGB565, ARGB4444, YUV422, BUMP, PAL4, PAL8, or RGBA8 (PNG) */
  format: string;
  /** layout: twiddled, VQ, small VQ, rectangle, stride, twiddled rectangle, or linear (PNG) */
  layout: string;
  width: number; height: number;
  /** largest first */
  mips: MipLevel[];
  /** the bytes the console would hold in graphics memory (PVR data without its header), or 16-bit estimate for PNG */
  vramBytes: number;
  /** the file's own bytes (Dreamcast form for PVR): what a viewer on the console is sent */
  source: Uint8Array;
  note?: string;
}
export interface DecodedMesh {
  positions: Float32Array; normals: Float32Array | null; uvs: Float32Array | null; indices: Uint32Array;
  materials: { name: string; texture?: string }[];
}
export interface DecodedAsset { kind: 'texture' | 'model'; name: string; decoder: string; textures: DecodedTexture[]; mesh?: DecodedMesh; info: [string, string][] }
export interface DecodeContext { sibling(name: string): Promise<Uint8Array | null> }
export interface AssetDecoder { id: string; label: string; exts: string[]; decode(bytes: Uint8Array, name: string, ctx: DecodeContext): Promise<DecodedAsset> }

const decoders: AssetDecoder[] = [];
export function registerDecoder(d: AssetDecoder): void { const i = decoders.findIndex((x) => x.id === d.id); if (i >= 0) decoders.splice(i, 1); decoders.unshift(d); }
export function decoderFor(name: string): AssetDecoder | null {
  const n = name.toLowerCase(); return decoders.find((d) => d.exts.some((e) => n.endsWith(e))) ?? null;
}
export function listDecoders(): { id: string; label: string; exts: string[]; plugin: boolean }[] { return decoders.map((d) => ({ id: d.id, label: d.label, exts: d.exts, plugin: !BUILTIN.has(d.id) })); }
/** Plugins the bridge serves ({plugins: [{name, url}]}); each module's default export is a decoder or a list. */
export async function loadPlugins(base: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/v0/plugins'); if (!r.ok) return out;
    const j = (await r.json()) as { plugins?: { name: string; url: string }[] };
    for (const p of j.plugins ?? []) {
      try {
        const m = (await import(/* @vite-ignore */ base.replace(/\/$/, '') + p.url)) as { default?: AssetDecoder | AssetDecoder[] };
        const list = Array.isArray(m.default) ? m.default : m.default ? [m.default] : [];
        for (const d of list) if (d && typeof d.decode === 'function' && Array.isArray(d.exts)) { registerDecoder(d); out.push(d.id); }
      } catch { /* a broken plugin is skipped; the others load */ }
    }
  } catch { /* no bridge, or a bridge without plugins */ }
  return out;
}

// ---------------------------------------------------------------- Dreamcast PVR
const PIX = ['ARGB1555', 'RGB565', 'ARGB4444', 'YUV422', 'BUMP', 'PAL4', 'PAL8'];
const DATA: Record<number, [string, boolean]> = {
  1: ['twiddled', false], 2: ['twiddled', true], 3: ['VQ', false], 4: ['VQ', true], 5: ['twiddled', false], 6: ['twiddled', true],
  7: ['twiddled', false], 8: ['twiddled', true], 9: ['rectangle', false], 0x0b: ['stride', false], 0x0d: ['twiddled rectangle', false],
  0x10: ['small VQ', false], 0x11: ['small VQ', true], 0x12: ['twiddled', true],
};
/** twiddled index of (x, y) in a square of side n: y's bits in the even places, x's in the odd ones */
export function twiddle(x: number, y: number): number { let r = 0; for (let b = 0; (1 << b) <= Math.max(x, y); b++) { r |= ((y >> b) & 1) << (2 * b); r |= ((x >> b) & 1) << (2 * b + 1); } return r; }
function texel(fmt: number, v: number, out: Uint8ClampedArray, o: number): void {
  if (fmt === 0) { out[o] = ((v >> 10) & 31) * 255 / 31; out[o + 1] = ((v >> 5) & 31) * 255 / 31; out[o + 2] = (v & 31) * 255 / 31; out[o + 3] = v & 0x8000 ? 255 : 0; }
  else if (fmt === 1) { out[o] = ((v >> 11) & 31) * 255 / 31; out[o + 1] = ((v >> 5) & 63) * 255 / 63; out[o + 2] = (v & 31) * 255 / 31; out[o + 3] = 255; }
  else if (fmt === 2) { out[o] = ((v >> 8) & 15) * 17; out[o + 1] = ((v >> 4) & 15) * 17; out[o + 2] = (v & 15) * 17; out[o + 3] = ((v >> 12) & 15) * 17; }
  else { const g = (v >> 8) & 255; out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255; }   // YUV422 / BUMP: luma only
}
function decodeLevel(d: Uint8Array, off: number, w: number, h: number, pix: number, layout: string, code: Uint8Array | null, pal: Uint8ClampedArray | null): MipLevel {
  const out = new Uint8ClampedArray(w * h * 4); const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const tw = layout.startsWith('twiddled'); const m = Math.min(w, h);
  const idx = (x: number, y: number) => {   // a twiddled rectangle is squares of the shorter side, one after another
    if (!tw) return y * w + x;
    const tile = w > h ? Math.floor(x / m) : Math.floor(y / m); return tile * m * m + twiddle(x % m, y % m);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (code) {   // VQ: one twiddled index a 2x2 block, four 16-bit texels a codebook entry (y first)
      const bx = x >> 1, by = y >> 1; const bi = d[off + twiddle(bx, by)] ?? 0; const e = bi * 8 + ((x & 1) * 2 + (y & 1)) * 2;
      texel(pix, code[e] | (code[e + 1] << 8), out, o); continue;
    }
    if (pix === 5 || pix === 6) {
      const i = idx(x, y); const v = pix === 5 ? ((d[off + (i >> 1)] ?? 0) >> ((i & 1) * 4)) & 15 : d[off + i] ?? 0;
      if (pal) { out[o] = pal[v * 4]; out[o + 1] = pal[v * 4 + 1]; out[o + 2] = pal[v * 4 + 2]; out[o + 3] = pal[v * 4 + 3]; }
      else { const g = pix === 5 ? v * 17 : v; out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255; }
      continue;
    }
    const p = off + idx(x, y) * 2; texel(pix, p + 1 < d.length ? dv.getUint16(p, true) : 0, out, o);
  }
  return { w, h, rgba: out };
}
function readPalette(b: Uint8Array | null): Uint8ClampedArray | null {   // .pvp: PVPL, length, format, ?, ?, count, entries
  if (!b || b.length < 16 || String.fromCharCode(...b.slice(0, 4)) !== 'PVPL') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const fmt = dv.getUint16(8, true); const n = dv.getUint16(14, true);
  const out = new Uint8ClampedArray(256 * 4); const bpe = fmt === 6 ? 4 : 2;
  for (let i = 0; i < Math.min(256, n); i++) {
    const o = 16 + i * bpe; if (o + bpe > b.length) break;
    if (bpe === 4) { const v = dv.getUint32(o, true); out[i * 4] = (v >> 16) & 255; out[i * 4 + 1] = (v >> 8) & 255; out[i * 4 + 2] = v & 255; out[i * 4 + 3] = (v >>> 24) & 255; }
    else texel(fmt & 3, dv.getUint16(o, true), out, i * 4);
  }
  return out;
}
export function decodePvr(b: Uint8Array, name: string, palette: Uint8Array | null = null): DecodedTexture {
  let o = 0; const tag = (at: number) => String.fromCharCode(...b.slice(at, at + 4));
  if (tag(0) === 'GBIX') o = 8 + new DataView(b.buffer, b.byteOffset).getUint32(4, true);
  if (tag(o) !== 'PVRT') throw new Error(`${name}: no PVRT header`);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const pix = b[o + 8], df = b[o + 9], w = dv.getUint16(o + 12, true), h = dv.getUint16(o + 14, true);
  const [layout, mipped] = DATA[df] ?? ['unknown', false];
  const data = b.subarray(o + 16, Math.min(b.length, o + 8 + dv.getUint32(o + 4, true)));
  const pal = readPalette(palette);
  const vq = layout.includes('VQ');
  const code = vq ? data.subarray(0, 2048) : null; const body = vq ? data.subarray(2048) : data;
  const bpp = vq ? 2 : pix === 5 ? 4 : pix === 6 ? 8 : 16;   // VQ: index bits a texel (one byte a 2x2 block)
  const levelBytes = (lw: number, lh: number) => (vq ? Math.max(1, (lw * lh) / 4) : Math.max(1, (lw * lh * bpp) / 8));
  const mips: MipLevel[] = []; let end = body.length; let lw = w, lh = h;
  for (;;) {   // mip levels are stored smallest first, so the largest is the last bytes: walk back from the end
    const n = levelBytes(lw, lh); const start = mipped ? end - n : 0;
    if (start < 0) break;
    mips.push(decodeLevel(body, start, lw, lh, pix, layout, code, pal));
    if (!mipped || (lw === 1 && lh === 1)) break;
    end = start; lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
  }
  const note = (pix === 5 || pix === 6) && !pal ? 'palette not in the file: shown as grey levels (a .pvp beside it is used when present)' : pix === 3 ? 'YUV422 shown as luma' : undefined;
  return { name, format: PIX[pix] ?? `format ${pix}`, layout: `${layout}${mipped ? ' + mip maps' : ''}`, width: w, height: h, mips, vramBytes: data.length, source: b, note };
}
const pvrDecoder: AssetDecoder = {
  id: 'pvr', label: 'Dreamcast PVR texture', exts: ['.pvr'],
  async decode(bytes, name, ctx) {
    const pal = await ctx.sibling(name.replace(/\.pvr$/i, '.pvp')).catch(() => null);
    const t = decodePvr(bytes, name, pal);
    return { kind: 'texture', name, decoder: 'pvr', textures: [t], info: [['Format', t.format], ['Layout', t.layout], ['Size', `${t.width} x ${t.height}`], ['Mip levels', String(t.mips.length)], ['Graphics memory', `${t.vramBytes} B`]] };
  },
};

// ---------------------------------------------------------------- PNG
const pngDecoder: AssetDecoder = {
  id: 'png', label: 'PNG picture', exts: ['.png'],
  async decode(bytes, name) {
    const bm = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
    const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; const g = cv.getContext('2d')!; g.drawImage(bm, 0, 0); bm.close();
    const rgba = g.getImageData(0, 0, cv.width, cv.height).data; let v = 0; for (let s = Math.max(cv.width, cv.height); s >= 1; s >>= 1) v += Math.max(1, (cv.width * s) / Math.max(cv.width, cv.height)) * Math.max(1, (cv.height * s) / Math.max(cv.width, cv.height)) * 2;
    const t: DecodedTexture = { name, format: 'RGBA8', layout: 'linear (converted to RGB565 twiddled for the console)', width: cv.width, height: cv.height, mips: [{ w: cv.width, h: cv.height, rgba }], vramBytes: Math.round(v), source: bytes };
    return { kind: 'texture', name, decoder: 'png', textures: [t], info: [['Format', 'PNG (RGBA8)'], ['Size', `${t.width} x ${t.height}`], ['As RGB565 with mips', `${t.vramBytes} B`]] };
  },
};

// ---------------------------------------------------------------- OBJ
const objDecoder: AssetDecoder = {
  id: 'obj', label: 'Wavefront OBJ model', exts: ['.obj'],
  async decode(bytes, name) {
    const text = new TextDecoder().decode(bytes); const v: number[][] = [], vt: number[][] = [], vn: number[][] = [];
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = []; const mats: { name: string }[] = []; const seen = new Map<string, number>(); let hasN = false, hasU = false;
    const ref = (s: string) => {
      let k = seen.get(s); if (k != null) return k; const [a, b, c] = s.split('/').map((x) => (x ? parseInt(x, 10) : NaN));
      const at = (arr: number[][], i: number) => arr[i < 0 ? arr.length + i : i - 1];
      const p = at(v, a) ?? [0, 0, 0]; P.push(p[0], p[1], p[2]);
      const t = Number.isNaN(b) ? null : at(vt, b); U.push(t ? t[0] : 0, t ? t[1] : 0); hasU ||= !!t;
      const n = Number.isNaN(c) ? null : at(vn, c); N.push(n ? n[0] : 0, n ? n[1] : 1, n ? n[2] : 0); hasN ||= !!n;
      k = P.length / 3 - 1; seen.set(s, k); return k;
    };
    for (const raw of text.split('\n')) {
      const l = raw.trim().split(/\s+/); const c = l[0];
      if (c === 'v') v.push(l.slice(1, 4).map(Number)); else if (c === 'vt') vt.push(l.slice(1, 3).map(Number)); else if (c === 'vn') vn.push(l.slice(1, 4).map(Number));
      else if (c === 'usemtl') mats.push({ name: l[1] ?? '' });
      else if (c === 'f') { const ids = l.slice(1).map(ref); for (let i = 1; i + 1 < ids.length; i++) I.push(ids[0], ids[i], ids[i + 1]); }
    }
    const mesh: DecodedMesh = { positions: new Float32Array(P), normals: hasN ? new Float32Array(N) : null, uvs: hasU ? new Float32Array(U) : null, indices: new Uint32Array(I), materials: mats };
    return { kind: 'model', name, decoder: 'obj', textures: [], mesh, info: [['Vertices', String(P.length / 3)], ['Triangles', String(I.length / 3)], ['Materials', mats.map((m) => m.name).join(', ') || 'none']] };
  },
};

// ---------------------------------------------------------------- glTF 2.0 (.gltf with data: or sibling buffers, .glb)
const COMP: Record<number, [Float32ArrayConstructor | Uint32ArrayConstructor | Uint16ArrayConstructor | Uint8ArrayConstructor, number]> = { 5126: [Float32Array, 4], 5125: [Uint32Array, 4], 5123: [Uint16Array, 2], 5121: [Uint8Array, 1] };
const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
interface Gltf { buffers?: { uri?: string; byteLength: number }[]; bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[]; accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[]; meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[]; materials?: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[]; textures?: { source?: number }[]; images?: { uri?: string; name?: string }[] }
const gltfDecoder: AssetDecoder = {
  id: 'gltf', label: 'glTF 2.0 model', exts: ['.gltf', '.glb'],
  async decode(bytes, name, ctx) {
    let j: Gltf; let bin: Uint8Array | null = null;
    if (String.fromCharCode(...bytes.slice(0, 4)) === 'glTF') {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let o = 12; j = {} as Gltf;
      while (o + 8 <= bytes.length) { const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true); const chunk = bytes.subarray(o + 8, o + 8 + len); if (type === 0x4e4f534a) j = JSON.parse(new TextDecoder().decode(chunk)); else if (type === 0x004e4942) bin = chunk; o += 8 + len; }
    } else j = JSON.parse(new TextDecoder().decode(bytes));
    const bufs: Uint8Array[] = [];
    for (const [i, b] of (j.buffers ?? []).entries()) {
      if (!b.uri) bufs.push(bin ?? new Uint8Array(b.byteLength));
      else if (b.uri.startsWith('data:')) bufs.push(Uint8Array.from(atob(b.uri.split(',')[1] ?? ''), (c) => c.charCodeAt(0)));
      else bufs.push((await ctx.sibling(b.uri)) ?? new Uint8Array(j.buffers![i].byteLength));
    }
    const acc = (k: number): { a: ArrayLike<number>; n: number } => {
      const a = j.accessors![k]; const [T, sz] = COMP[a.componentType]; const nc = NCOMP[a.type] ?? 1; const bv = j.bufferViews![a.bufferView ?? 0]; const buf = bufs[bv.buffer];
      const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0); const stride = bv.byteStride || nc * sz; const out = new Float64Array(a.count * nc); const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < nc; c++) { const p = start + i * stride + c * sz; out[i * nc + c] = T === Float32Array ? dv.getFloat32(p, true) : T === Uint32Array ? dv.getUint32(p, true) : T === Uint16Array ? dv.getUint16(p, true) : dv.getUint8(p); }
      return { a: out, n: nc };
    };
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = []; let hasN = true, hasU = true;
    for (const m of j.meshes ?? []) for (const pr of m.primitives) {
      if ((pr.mode ?? 4) !== 4 || pr.attributes.POSITION == null) continue;
      const base = P.length / 3; const pos = acc(pr.attributes.POSITION); P.push(...Array.from(pos.a));
      const cnt = pos.a.length / 3;
      if (pr.attributes.NORMAL != null) N.push(...Array.from(acc(pr.attributes.NORMAL).a)); else { hasN = false; N.push(...new Array(cnt * 3).fill(0)); }
      if (pr.attributes.TEXCOORD_0 != null) U.push(...Array.from(acc(pr.attributes.TEXCOORD_0).a)); else { hasU = false; U.push(...new Array(cnt * 2).fill(0)); }
      if (pr.indices != null) for (const x of Array.from(acc(pr.indices).a)) I.push(base + x); else for (let i = 0; i < cnt; i++) I.push(base + i);
    }
    const mats = (j.materials ?? []).map((m) => { const ti = m.pbrMetallicRoughness?.baseColorTexture?.index; const img = ti != null ? j.images?.[j.textures?.[ti]?.source ?? -1] : undefined; return { name: m.name ?? 'material', texture: img?.uri ?? img?.name }; });
    const mesh: DecodedMesh = { positions: new Float32Array(P), normals: hasN ? new Float32Array(N) : null, uvs: hasU ? new Float32Array(U) : null, indices: new Uint32Array(I), materials: mats };
    return { kind: 'model', name, decoder: 'gltf', textures: [], mesh, info: [['Vertices', String(P.length / 3)], ['Triangles', String(I.length / 3)], ['Materials', mats.map((m) => m.name + (m.texture ? ` (${m.texture})` : '')).join(', ') || 'none']] };
  },
};

const BUILTIN = new Set(['pvr', 'png', 'obj', 'gltf']);
[gltfDecoder, objDecoder, pngDecoder, pvrDecoder].forEach(registerDecoder);
