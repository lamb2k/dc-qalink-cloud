// Picture helpers: fit a grab to an area, read pixels, difference two grabs, the loupe, and a tiny renderer for Assets.
import { tok } from '../ui/dom';

export interface Fit { s: number; dx: number; dy: number; w: number; h: number }
export type FitMode = 'fit' | 'fill' | 'one';

/** draws src into the area: fit (whole picture, as large as the area allows), fill (cover), one (1:1); zoom multiplies */
export function blitFit(g: CanvasRenderingContext2D, w: number, h: number, src: CanvasImageSource & { width: number; height: number }, mode: FitMode = 'fit', zoom = 1, center?: [number, number], smooth = false): Fit {
  g.fillStyle = tok('--bg-inset'); g.fillRect(0, 0, w, h);
  const base = mode === 'fill' ? Math.max(w / src.width, h / src.height) : mode === 'one' ? 1 / (window.devicePixelRatio || 1) : Math.min(w / src.width, h / src.height);
  const s = base * zoom;
  const cx = center ? center[0] : src.width / 2, cy = center ? center[1] : src.height / 2;
  const dx = w / 2 - cx * s, dy = h / 2 - cy * s;
  g.imageSmoothingEnabled = smooth && s < 1;
  g.drawImage(src, dx, dy, src.width * s, src.height * s);
  return { s, dx, dy, w: src.width, h: src.height };
}
export function toImage(f: Fit, x: number, y: number): [number, number] | null {
  const ix = Math.floor((x - f.dx) / f.s), iy = Math.floor((y - f.dy) / f.s);
  return ix >= 0 && iy >= 0 && ix < f.w && iy < f.h ? [ix, iy] : null;
}
export function markPixel(g: CanvasRenderingContext2D, f: Fit, p: [number, number]): void {
  const px = f.dx + (p[0] + 0.5) * f.s, py = f.dy + (p[1] + 0.5) * f.s; const r = Math.max(4, f.s * 2);
  g.strokeStyle = tok('--chart-cursor'); g.lineWidth = 1;
  g.strokeRect(Math.round(px - r) + 0.5, Math.round(py - r) + 0.5, Math.round(r * 2), Math.round(r * 2));
  g.beginPath(); g.moveTo(px, py - r - 6); g.lineTo(px, py - r); g.moveTo(px, py + r); g.lineTo(px, py + r + 6); g.moveTo(px - r - 6, py); g.lineTo(px - r, py); g.moveTo(px + r, py); g.lineTo(px + r + 6, py); g.stroke();
}

export function pixel(cv: HTMLCanvasElement, x: number, y: number): [number, number, number] {
  const d = cv.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]];
}
export const hex = (p: number[]): string => '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
export const rgb565 = (p: number[]): number => ((p[0] >> 3) << 11) | ((p[1] >> 2) << 5) | (p[2] >> 3);

export interface Diff { cv: HTMLCanvasElement; changed: number; pct: number; mean: number; max: number }
const diffCache = new Map<string, Diff>();
/** per-pixel mean absolute difference; over the threshold shows in the warning colour, under it as dim grey */
export function difference(a: HTMLCanvasElement, b: HTMLCanvasElement, thr: number, key: string): Diff {
  const k = `${key}|${thr}|${tok('--warn')}`; const c = diffCache.get(k); if (c) return c;
  const w = Math.min(a.width, b.width), hh = Math.min(a.height, b.height);
  const A = a.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, hh).data, B = b.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, hh).data;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = hh; const g = cv.getContext('2d')!; const D = g.createImageData(w, hh);
  const hot = hexRgb(tok('--warn'));
  let changed = 0, sum = 0, max = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3; sum += d; if (d > max) max = d;
    if (d > thr) { changed++; const f = Math.min(1, 0.55 + d / 255); D.data[i] = hot[0] * f; D.data[i + 1] = hot[1] * f; D.data[i + 2] = hot[2] * f; }
    else { const l = (A[i] * 0.3 + A[i + 1] * 0.59 + A[i + 2] * 0.11) * 0.22; D.data[i] = D.data[i + 1] = D.data[i + 2] = l; }
    D.data[i + 3] = 255;
  }
  g.putImageData(D, 0, 0);
  const r = { cv, changed, pct: (changed / (w * hh)) * 100, mean: sum / (w * hh), max };
  diffCache.set(k, r); while (diffCache.size > 8) diffCache.delete(diffCache.keys().next().value!);
  return r;
}
export function hexRgb(v: string): [number, number, number] { const x = v.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number]; }

export function loupe(g: CanvasRenderingContext2D, w: number, h: number, src: HTMLCanvasElement, cx: number, cy: number, n = 11): void {
  g.imageSmoothingEnabled = false; g.fillStyle = tok('--bg-inset'); g.fillRect(0, 0, w, h);
  const cell = w / n;
  g.drawImage(src, cx - (n >> 1), cy - (n >> 1), n, n, 0, 0, w, h);
  g.strokeStyle = tok('--scrim'); g.lineWidth = 1;
  for (let i = 1; i < n; i++) { g.beginPath(); g.moveTo(Math.round(i * cell) + 0.5, 0); g.lineTo(Math.round(i * cell) + 0.5, h); g.moveTo(0, Math.round(i * cell) + 0.5); g.lineTo(w, Math.round(i * cell) + 0.5); g.stroke(); }
  g.strokeStyle = tok('--chart-cursor'); g.lineWidth = 2; g.strokeRect((n >> 1) * cell + 1, (n >> 1) * cell + 1, cell - 2, cell - 2);
}

// ---------------------------------------------------------------- tiny software renderer (Assets preview)
export interface Mesh { V: { p: number[]; n: number[]; uv: number[] }[]; T: number[][]; strips: number; stripVerts: number }
export function torusMesh(R = 1, r = 0.38, nu = 48, nv = 24): Mesh {
  const V: Mesh['V'] = [], T: number[][] = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = (i / nu) * Math.PI * 2, v = (j / nv) * Math.PI * 2; const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
    V.push({ p: [(R + r * cv) * cu, r * sv, (R + r * cv) * su], n: [cv * cu, sv, cv * su], uv: [(i / nu) * 4, (j / nv) * 2] });
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; T.push([a, b, a + 1], [b, b + 1, a + 1]); }
  return { V, T, strips: nu, stripVerts: nu * (nv + 1) * 2 };
}
export interface Cam { yaw: number; pitch: number; dist: number; fov: number }
export function render(mesh: Mesh, cam: Cam, o: { w: number; h: number; bg: number[]; colA: number[]; colB: number[]; nearest?: boolean; rgb565?: boolean }): HTMLCanvasElement {
  const W = o.w, H = o.h; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H); const zb = new Float32Array(W * H).fill(Infinity);
  for (let i = 0; i < W * H; i++) { img.data[i * 4] = o.bg[0]; img.data[i * 4 + 1] = o.bg[1]; img.data[i * 4 + 2] = o.bg[2]; img.data[i * 4 + 3] = 255; }
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const f = H / 2 / Math.tan(cam.fov / 2); const L = [0.4, 0.75, -0.5]; const ln = Math.hypot(...L); for (let i = 0; i < 3; i++) L[i] /= ln;
  const P = mesh.V.map((v) => {
    const [x, y, z] = v.p; const x1 = x * cy - z * sy, z1 = x * sy + z * cy; const y1 = y * cp - z1 * sp; let z2 = y * sp + z1 * cp; z2 += cam.dist;
    const [nx, ny, nz] = v.n; const nx1 = nx * cy - nz * sy, nz1 = nx * sy + nz * cy; const ny1 = ny * cp - nz1 * sp, nz2 = ny * sp + nz1 * cp;
    const sh = Math.max(0, nx1 * L[0] + ny1 * L[1] - nz2 * L[2]) * 0.75 + 0.25;
    return { x: W / 2 + (x1 * f) / z2, y: H / 2 - (y1 * f) / z2, z: z2, s: sh, u: v.uv[0], v: v.uv[1] };
  });
  const tex = (u: number, v: number) => (((Math.floor(u * 8) + Math.floor(v * 8)) & 1) ? o.colA : o.colB);
  for (const [a, b, c] of mesh.T) {
    const A = P[a], B = P[b], C = P[c]; const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y); if (area >= 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x))), x1 = Math.min(W - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
    const y0 = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y))), y1 = Math.min(H - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((B.x - px) * (C.y - py) - (C.x - px) * (B.y - py)) / area, w1 = ((C.x - px) * (A.y - py) - (A.x - px) * (C.y - py)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = 1 / (w0 / A.z + w1 / B.z + w2 / C.z); const k = y * W + x; if (z >= zb[k]) continue; zb[k] = z;
      const u = (w0 * A.u / A.z + w1 * B.u / B.z + w2 * C.u / C.z) * z, v = (w0 * A.v / A.z + w1 * B.v / B.z + w2 * C.v / C.z) * z;
      const s = w0 * A.s + w1 * B.s + w2 * C.s; const t = tex(u, v);
      let r = t[0] * s, gg = t[1] * s, bb = t[2] * s;
      if (o.rgb565) { r = (Math.round(r) >> 3) << 3; gg = (Math.round(gg) >> 2) << 2; bb = (Math.round(bb) >> 3) << 3; }
      img.data[k * 4] = r; img.data[k * 4 + 1] = gg; img.data[k * 4 + 2] = bb;
    }
  }
  g.putImageData(img, 0, 0); return cv;
}
