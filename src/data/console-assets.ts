// Live assets on the console (plan L5b; dc-qalink docs/ASSETS.md, lane ql-assets): the bridge converts a dropped
// texture or model, checks the live-asset budget, sends it to the console viewer, draws it with the Assets editor's
// camera, grabs the console's picture and compares it with its own PC render. This module is the calls and a small
// scheduler (one request in flight, the newest camera wins), kept free of the DOM so it can be tested.
import { bpost } from './bridge-client';

/** The same rule as the Assets editor's meters and the console viewer: a quarter of main memory, half of graphics memory. */
export const LIVE_RAM = 4 * 1024 * 1024, LIVE_VRAM = 4 * 1024 * 1024;

export interface Ms { mean: number; worst: number }
export interface ViewCost {
  pictures: number; window: [number, number]; tier: string; verts: number; strips: number; texture_bytes: number;
  vertex_buffer_bytes: number; graphics_free: number; submit_ms: Ms | null; ta_ms: Ms | null; render_ms: Ms | null; frame_ms: Ms | null;
}
/** The bridge's asset record: the editor's row fields as they are, plus the bridge's numbers. */
export interface C1AssetRecord {
  id: string; name: string; kind: 'texture' | 'model'; state: 'checked' | 'refused' | 'live' | 'sent';
  tris: number; strips: number; stripVerts: number; texW: number; texH: number; note: string;
  bytes: number; sha256: string; dqa_sha256: string; ram: number; vram: number; fits: boolean; reason: string | null;
  lost: string[]; psnr: number | null; console: { state: string; send_s: number; why: string | null; tier: string } | null;
  cost?: ViewCost | null; build?: string | null; textures?: { name: string; w: number; h: number; format: string; mip: boolean; bytes: number; psnr: number }[];
}
export interface C1AssetView {
  id: string; asset: string; name?: string; state: string; why?: string | null; tier: string; view?: string;
  times: { send_s?: number; set_s?: number; cost_s?: number; grab_s?: number; render_s?: number; diff_s?: number; round_trip_s?: number; total_s?: number };
  console?: { still: string; url: string; picture?: number }; pc?: { url: string }; side?: { url: string };
  diff?: { pixels: number; differ: number; over: number; threshold: number; max: number; mean_abs: number; psnr: number; url: string };
  cost?: ViewCost | null; build?: string | null; camera?: { yaw: number; pitch: number; dist: number; fov: number };
}
export interface CamLike { yaw: number; pitch: number; dist: number; fov: number }

export function toBase64(b: Uint8Array): string {
  let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const uploadAsset = (base: string, name: string, bytes: Uint8Array, opt: { format?: string; mips?: boolean } = {}) =>
  bpost<C1AssetRecord>(base, '/v0/assets', { name, base64: toBase64(bytes), ...opt }, 60000);
export const uploadPath = (base: string, path: string) => bpost<C1AssetRecord>(base, '/v0/assets', { path }, 60000);
export const viewAsset = (base: string, id: string, camera: CamLike, opt: { measure?: number; view?: string; filter?: string } = {}) =>
  bpost<C1AssetView>(base, `/v0/assets/${id}/view`, { camera, start_viewer: true, measure: opt.measure ?? 0, ...(opt.view ? { view: opt.view } : {}), ...(opt.filter ? { filter: opt.filter } : {}) }, 120000);

/** What the Sync table's "Console grab" row says about a view. */
export function grabState(v: C1AssetView | undefined): { cls: string; text: string } {
  if (!v?.diff) return { cls: '', text: 'not grabbed' };
  if (v.diff.over === 0) return { cls: 'ok', text: v.diff.differ === 0 ? 'identical' : 'in sync' };
  return { cls: 'warn', text: `differs: ${v.diff.over} px` };
}
/** The Asset editor's state for a record or a view (its pills: live, sent, converting, refused, checked). */
export function editorState(rec: C1AssetRecord | undefined, v?: C1AssetView): 'live' | 'sent' | 'refused' | 'checked' {
  if (v) return v.state === 'live' ? 'live' : 'refused';
  if (!rec) return 'checked';
  return rec.state === 'live' ? 'live' : rec.state === 'refused' ? 'refused' : rec.state === 'sent' ? 'sent' : 'checked';
}
/** Time to draw on the console: the CPU's transform and submit plus the graphics chip's render, ms (mean, worst). */
export function drawMs(c: ViewCost | null | undefined): Ms | null {
  if (!c?.submit_ms) return null;
  return { mean: c.submit_ms.mean + (c.render_ms?.mean ?? 0), worst: c.submit_ms.worst + (c.render_ms?.worst ?? 0) };
}

/** One request at a time to the console; while one runs, only the newest wish is kept (dragging the camera sends
 *  the last position, not every step). `run` does the work; `settle` ms of quiet before a wish starts. */
export class Latest<K> {
  private busy = false; private next: K | null = null; private timer: ReturnType<typeof setTimeout> | null = null;
  runs = 0; dropped = 0;
  constructor(private run: (k: K) => Promise<void>, private settle = 150) {}
  want(k: K): void {
    if (this.next !== null) this.dropped++;
    this.next = k;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.pump(); }, this.settle);
  }
  private async pump(): Promise<void> {
    if (this.busy || this.next === null) return;
    const k = this.next; this.next = null; this.busy = true; this.runs++;
    try { await this.run(k); } finally { this.busy = false; if (this.next !== null) void this.pump(); }
  }
  get idle(): boolean { return !this.busy && this.next === null && !this.timer; }
}
