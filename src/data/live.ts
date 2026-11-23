// LiveSource: speaks the bridge's contract 1 (bridge-api.ts): Server-Sent Events for live data (read with fetch, so the
// same code runs in the browser, the desktop app and Node tests), HTTP for commands, grabs, runs and memory.
// On a dropped connection it keeps every record received, shows "lost", and retries every 4 s; on reconnect it asks
// the bridge to resume after the last picture it has (?from=n&session=id), so nothing repeats and a hole stays a gap.
// Before any program has linked, the bridge has no session: the source is "linked" to the bridge with an empty store,
// and the session's meta arrives on the stream when a program links.
import { CONTRACT, contractCompatible, ENDPOINTS, uiStatus, type BridgeStatus, type HelloMessage, type C1Still, type C1Status, type CommandRequest, type CommandResult, type LiveMessage, type MemoryReadResult, type RunRecord } from './bridge-api';
import { listRuns, pushProgram, sendCommand } from './bridge-client';
import type { GrabRecord, MetaRecord, SessionRecord } from './format';
import { Emitter, deviceLabel, type Source, type SourceInfo, type SourceState } from './source';
import { SessionStore } from './store';

const RETRY_S = 4;
const KNOWN = new Set(['meta', 'row', 'ctr', 'log', 'trace', 'grab', 'end']);

function toBase64(b: Uint8Array): string {
  let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export class LiveSource extends Emitter implements Source {
  readonly kind = 'live';
  readonly store = new SessionStore();
  state: SourceState = 'connecting';
  info: SourceInfo = { device: '', transport: '', rateBps: 0 };
  playing = true;
  speed = 1;
  /** run events (push, verdict, exec, line, still, back, reset, link) as they arrive, newest last (at most 500) */
  readonly events: LiveMessage[] = [];
  /** the bridge's last status */
  bridge: C1Status | null = null;
  private abort: AbortController | null = null;
  private session = '';
  private retryAt = 0;
  private stopped = false;
  private bytes: { t: number; b: number }[] = [];

  constructor(readonly base: string, private fetchFn: typeof fetch = (...a) => fetch(...a)) { super(); }

  private url(path: string): string { return this.base.replace(/\/$/, '') + path; }

  async start(): Promise<void> { this.stopped = false; void this.connect(); }
  stop(): void { this.stopped = true; this.abort?.abort(); this.abort = null; }

  private async connect(): Promise<void> {
    const from = this.store.maxN;
    const u = this.url(ENDPOINTS.live) + (from && this.session ? `?from=${from}&session=${encodeURIComponent(this.session)}` : '');
    const ac = new AbortController(); this.abort = ac;
    if (this.state !== 'lost') this.setState('connecting');
    let res: Response;
    try { res = await this.fetchFn(u, { headers: { Accept: 'text/event-stream', 'X-Contract': String(CONTRACT) }, signal: ac.signal }); }
    catch (e) { if (this.abort === ac) this.lose(String(e)); return; }
    if (res.status === 409) { this.info.error = `the bridge speaks another contract; this app speaks ${CONTRACT}`; this.stopped = true; this.setState('unlinked'); return; }
    if (!res.ok || !res.body) { this.lose(`bridge answered ${res.status}`); return; }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k: number;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, k); buf = buf.slice(k + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (data) this.onMessage(data);
        }
      }
    } catch { /* aborted or dropped */ }
    if (this.abort === ac) { this.abort = null; if (!this.stopped) this.lose(); }
  }
  private lose(error?: string): void {
    const wasLinked = this.state === 'linked';
    this.info.lostAt = this.store.maxN;
    this.info.attempt = wasLinked ? 1 : (this.info.attempt ?? 0) + 1;
    this.info.error = error;
    this.retryAt = performance.now() + RETRY_S * 1000;
    this.info.retryIn = RETRY_S;
    this.setState(this.store.meta || wasLinked ? 'lost' : 'unlinked');
  }
  retryNow(): void { if (this.state === 'lost' || this.state === 'unlinked') { this.retryAt = 0; void this.connect(); } }

  private newSession(id: string, meta: MetaRecord): void {
    this.session = id;
    this.store.append({ ...meta, t: 'meta' } as SessionRecord);
  }
  private onMessage(text: string): void {
    this.bytes.push({ t: performance.now(), b: text.length });
    let m: LiveMessage;
    try { m = JSON.parse(text); } catch { return; }
    if (m.t === 'hello' && 'contract' in m) {
      this.onHello(m as HelloMessage);
      return;
    }
    this.onRecord(m);
  }
  private onHello(m: HelloMessage): void {
    {
      if (!contractCompatible(m.contract)) { this.info.error = `bridge contract ${m.contract} is not ${CONTRACT}`; this.stop(); this.setState('unlinked'); return; }
      if (m.session && m.meta && (m.session !== this.session || !this.store.meta)) this.newSession(m.session, m.meta);
      this.info.device = m.device?.address ? deviceLabel({ kind: m.device.kind, name: m.device.name }) : 'Bridge (no console heard yet)';
      this.info.transport = m.device?.transport === 'modem' ? 'Modem' : 'Broadband adapter';
      this.info.lostAt = undefined; this.info.error = undefined; this.info.attempt = 0;
      this.setState('linked');
    }
  }
  private onRecord(m: LiveMessage): void {
    if (m.t === 'status') { const st = m as { rate_bps: number; paused: boolean }; this.info.rateBps = st.rate_bps; this.playing = !st.paused; this.emit('state'); return; }
    if (m.t === 'meta') { const mm = m as unknown as MetaRecord & { id: string }; if (mm.id !== this.session || !this.store.meta) this.newSession(mm.id, mm); else this.store.append(mm as SessionRecord); this.emit('data'); return; }
    if (!KNOWN.has(m.t)) { this.events.push(m); if (this.events.length > 500) this.events.splice(0, 100); this.emit('event'); return; }
    const r = m as SessionRecord & { url?: string };
    if (r.t === 'grab' && r.url && !(r as GrabRecord).data) { void this.fetchGrab(r as GrabRecord); return; }
    this.store.append(r); this.emit('data');
  }
  /** a grab on the stream names its PNG; the picture is fetched and kept inline so the canvas can read its pixels */
  private async fetchGrab(g: GrabRecord): Promise<GrabRecord | null> {
    try {
      const res = await this.fetchFn(this.url(g.url!), { headers: { 'X-Contract': String(CONTRACT) } });
      if (!res.ok) return null;
      const full = { ...g, url: undefined, data: toBase64(new Uint8Array(await res.arrayBuffer())) } as GrabRecord;
      this.store.append(full); this.emit('data');
      return full;
    } catch { return null; }
  }
  private setState(s: SourceState): void { this.state = s; this.emit('state'); }

  tick(now: number): void {
    if ((this.state === 'lost' || this.state === 'unlinked') && !this.stopped && this.retryAt) {
      const left = Math.max(0, Math.ceil((this.retryAt - now) / 1000));
      if (left !== this.info.retryIn) { this.info.retryIn = left; this.emit('state'); }
      if (now >= this.retryAt) { this.retryAt = 0; void this.connect(); }
    }
    while (this.bytes.length && now - this.bytes[0].t > 2000) this.bytes.shift();
  }
  play(): void { void this.command({ cmd: 'resume' }); }
  pause(): void { void this.command({ cmd: 'pause' }); }
  step(count = 1): void { void this.command({ cmd: 'step', count }); }
  seek(): void { /* live: the playhead moves in the view only */ }
  setSpeed(): void { /* live runs at the console's pace */ }

  async status(): Promise<BridgeStatus> {
    const r = await this.fetchFn(this.url(ENDPOINTS.status), { headers: { 'X-Contract': String(CONTRACT) } });
    this.bridge = await r.json(); return uiStatus(this.bridge!);
  }
  async command(c: CommandRequest): Promise<CommandResult> {
    try {
      const r = await sendCommand(this.base, c);
      if (r.ok && c.cmd === 'pause') this.playing = false;
      if (r.ok && c.cmd === 'resume') this.playing = true;
      this.emit('state');
      return r;
    } catch (e) { return { ok: false, id: '', error: String(e) }; }
  }
  /** Grab now: the bridge asks the running program for its displayed picture (POST /v0/stills), then the PNG. */
  async grab(): Promise<GrabRecord | null> {
    const res = await this.fetchFn(this.url(ENDPOINTS.stills), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Contract': String(CONTRACT) }, body: '{}' });
    const j = await res.json() as C1Still & { error?: string };
    if (!res.ok) throw new Error(j.error ?? `bridge answered ${res.status}`);
    return this.fetchGrab({ t: 'grab', n: j.picture, w: j.width, h: j.height, fmt: 'png', url: ENDPOINTS.still(j.id), label: `grab ${j.id} (${j.tier})`, kind: 'console' } as GrabRecord);
  }
  async runs(): Promise<RunRecord[]> { return listRuns(this.base); }
  async pushBuild(file: File | { name: string; bytes: Uint8Array }, opts: { args?: string } = {}): Promise<RunRecord> {
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
    return pushProgram(this.base, file.name, bytes, { args: opts.args });
  }
  async readMemory(addr: number, len: number): Promise<MemoryReadResult> {
    const r = await this.fetchFn(this.url(ENDPOINTS.memoryRead), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Contract': String(CONTRACT) }, body: JSON.stringify({ addr, len }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `bridge answered ${r.status}`); return j;
  }
}
