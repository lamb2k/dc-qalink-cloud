// View state shared by every editor: the playhead, the time range on screen, hover, compare picks and selections.
import type { GrabRecord } from '../data/format';

export type CompareMode = 'side' | 'diff' | 'wipe';

export class View {
  version = 0;
  /** the picture every editor shows */
  playhead = 0;
  /** playhead rides the newest picture */
  follow = true;
  /** zoomed picture range, or null for the whole session */
  zoom: [number, number] | null = null;
  /** picture under the mouse in any time chart (shared hover line) */
  hover: number | null = null;
  grabA: GrabRecord | null = null;
  grabB: GrabRecord | null = null;
  compare: CompareMode = 'side';
  wipe = 0.5;
  threshold = 24;
  /** inspected pixel in grab coordinates */
  pixel: [number, number] = [320, 240];
  asset = 0;
  run = '';
  memAddr = 0x8c010000;
  focusedArea = '';

  bump(): void { this.version++; }
  set<K extends keyof View>(k: K, v: View[K]): void { if (this[k] !== v) { (this as View)[k] = v; this.version++; } }
}

/** Picture range on the time axis. Replay spans the whole recording; live spans what has arrived (last 1800 while following). */
export function xRange(view: View, maxN: number, span: number): [number, number] {
  if (view.zoom) return view.zoom;
  const end = Math.max(span, maxN, 2);
  if (span <= 0 && view.follow && maxN > 1800) return [maxN - 1800, maxN];
  return [1, end];
}

// ---- decoded grab cache (PNG base64 -> ImageBitmap), small LRU
const cache = new Map<GrabRecord, HTMLCanvasElement>();
const pending = new Map<GrabRecord, Promise<HTMLCanvasElement>>();
export function grabCanvas(g: GrabRecord, done?: () => void): HTMLCanvasElement | null {
  const c = cache.get(g);
  if (c) { cache.delete(g); cache.set(g, c); return c; }
  if (!pending.has(g)) {
    const p = (async () => {
      const src = g.data ? `data:image/png;base64,${g.data}` : g.url!;
      const img = new Image(); img.src = src; await img.decode();
      const cv = document.createElement('canvas'); cv.width = g.w; cv.height = g.h;
      cv.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0);
      cache.set(g, cv); pending.delete(g);
      while (cache.size > 48) cache.delete(cache.keys().next().value!);
      return cv;
    })();
    pending.set(g, p);
    p.then(() => done?.()).catch(() => pending.delete(g));
  } else if (done) pending.get(g)!.then(() => done());
  return null;
}
