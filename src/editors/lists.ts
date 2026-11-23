// List editors: Log (virtual list, filter, follows the playhead), Outliner, Properties, Counters and guards,
// Phases table, Slowest pictures.
import type { App } from '../ui/app';
import type { LogRecord, XValue } from '../data/format';
import { esc, fmt, h, iconSvg, int, num } from '../ui/dom';
import { empty, toolBtn, Watch, type Editor, type EditorDef } from './base';

class Log implements Editor {
  el: HTMLElement; tools: HTMLElement[];
  private list = h('div', { class: 'vlist log', tabindex: '0', role: 'log', 'aria-label': 'Log lines' });
  private spacer = h('div', { class: 'vlist-spacer' });
  private rows = h('div', { class: 'vlist-rows' });
  private input = h('input', { class: 'input mono', placeholder: 'Filter lines (text)', 'aria-label': 'Filter log lines', spellcheck: 'false' });
  private onlyWarn = false;
  private onlySerial = false;
  private follow = true;
  private w = new Watch();
  private idx: number[] = []; private builtFor = '';
  private followBtn: HTMLButtonElement; private warnBtn: HTMLButtonElement; private serialBtn: HTMLButtonElement;
  private scrollV = 0;
  constructor(private app: App) {
    this.list.append(this.spacer); this.spacer.append(this.rows);
    const bar = h('div', { class: 'filter-bar' }, this.input);
    this.el = h('div', { class: 'with-bar' }, bar, h('div', { class: 'grow-body' }, this.list));
    this.followBtn = toolBtn('crosshair', 'Follow the playhead', () => { this.follow = !this.follow; this.followBtn.classList.toggle('is-on', this.follow); this.scrollV++; }, true);
    this.warnBtn = toolBtn('triangle-alert', 'Only warnings and errors', () => { this.onlyWarn = !this.onlyWarn; this.warnBtn.classList.toggle('is-on', this.onlyWarn); this.builtFor = ''; });
    this.serialBtn = toolBtn('terminal', 'Only what the program printed (serial)', () => { this.onlySerial = !this.onlySerial; this.serialBtn.classList.toggle('is-on', this.onlySerial); this.builtFor = ''; });
    const copy = toolBtn('copy', 'Copy the shown lines', () => { const st = app.store; void navigator.clipboard?.writeText(this.idx.map((i) => `${st.logs[i].n ?? ''}\t${st.logs[i].lv}\t${st.logs[i].msg}`).join('\n')); app.toast('ok', `Copied ${this.idx.length} lines`); });
    this.tools = [this.serialBtn, this.warnBtn, this.followBtn, copy];
    this.input.addEventListener('input', () => { this.builtFor = ''; });
    this.list.addEventListener('scroll', () => { this.scrollV++; });
    this.list.addEventListener('wheel', () => { if (this.follow) { this.follow = false; this.followBtn.classList.remove('is-on'); } }, { passive: true });
    this.rows.addEventListener('click', (e) => { const r = (e.target as HTMLElement).closest('[data-n]') as HTMLElement | null; if (r && r.dataset.n) app.setPlayhead(Number(r.dataset.n)); });
    this.w.observe(this.list);
  }
  meta(): string { const n = this.app.store.logs.length; return this.idx.length === n ? `${int(n)} lines` : `${int(this.idx.length)} of ${int(n)} lines`; }
  frame(force: boolean): void {
    const st = this.app.store; const q = this.input.value.trim().toLowerCase();
    const key = `${st.meta?.id}|${st.logs.length}|${st.logsDropped}|${q}|${this.onlyWarn}|${this.onlySerial}`;
    if (key !== this.builtFor) {
      this.builtFor = key; this.idx = [];
      st.logs.forEach((l, i) => { if (this.onlyWarn && l.lv !== 'warn' && l.lv !== 'err') return; if (this.onlySerial && l.lv !== 'serial') return; if (q && !l.msg.toLowerCase().includes(q)) return; this.idx.push(i); });
      force = true;
    }
    if (!this.w.changed(this.app, `${this.scrollV}|${key}`) && !force) return;
    const rh = num('--lh-sm'); const total = this.idx.length;
    this.spacer.style.height = `${total * rh}px`;
    const cur = st.logIndexAt(this.app.view.playhead);
    // the shown line at or before the playhead
    let at = -1; { let lo = 0, hi = total; while (lo < hi) { const m = (lo + hi) >> 1; if (this.idx[m] <= cur) lo = m + 1; else hi = m; } at = lo - 1; }
    if (this.follow && at >= 0) {
      const y = at * rh; const H = this.list.clientHeight;
      if (y < this.list.scrollTop || y > this.list.scrollTop + H - rh * 2) this.list.scrollTop = Math.max(0, y - H / 2);
    }
    const top = this.list.scrollTop, H = this.list.clientHeight;
    const a = Math.max(0, Math.floor(top / rh) - 10), b = Math.min(total, Math.ceil((top + H) / rh) + 10);
    this.rows.style.transform = `translateY(${a * rh}px)`;
    let html = '';
    for (let k = a; k < b; k++) {
      const i = this.idx[k]; const l: LogRecord = st.logs[i];
      const cls = `ln ${l.lv}${k === at ? ' is-cursor' : ''}${i > cur ? ' after' : ''}`;
      html += `<div class="${cls}"${l.n != null ? ` data-n="${l.n}"` : ''}><span class="tick">${l.n ?? (l.ph === 'load' ? 'load' : '')}</span><span class="lv">${l.lv === 'warn' ? '!' : l.lv === 'err' ? 'x' : l.lv === 'stub' ? 's' : l.lv === 'serial' ? '&gt;' : ''}</span><span class="tx" title="${esc(l.msg)}">${esc(l.msg)}</span></div>`;
    }
    this.rows.innerHTML = html;
    if (!total) this.rows.innerHTML = `<div class="ln"><span></span><span></span><span class="tx">${st.logs.length ? 'No line matches the filter.' : 'No log lines yet.'}</span></div>`;
  }
  destroy(): void { this.w.stop(); }
}

class Outliner implements Editor {
  el = h('div', { class: 'outliner', role: 'tree', 'aria-label': 'Session outline' }); bodyClass = 'scroll'; private w = new Watch();
  constructor(private app: App) {}
  frame(force: boolean): void {
    if (!this.w.changed(this.app) && !force) return;
    const st = this.app.store; const nodes = st.meta?.outline ?? [];
    if (!nodes.length) { this.el.replaceChildren(empty('list', 'Nothing to outline', 'The outline appears when a session starts.')); return; }
    const s = this.app.source;
    this.el.innerHTML = nodes.map((n, i) => `<div class="node${n.depth ? ' d' + Math.min(2, n.depth) : ''}${i === 2 ? ' is-selected' : ''}" role="treeitem" aria-level="${n.depth + 1}">${n.depth === 0 ? iconSvg('chevron-down') : ''}${iconSvg(n.icon)}<span class="ellipsis" title="${esc(n.label)}">${esc(n.label)}</span><span class="v" title="${esc(n.value ?? '')}">${esc(n.value ?? '')}</span></div>`).join('')
      + `<div class="node d1">${iconSvg('timer')}<span>Playhead</span><span class="v">picture ${this.app.view.playhead}</span></div>`
      + `<div class="node d1">${iconSvg(s.state === 'lost' ? 'link-2-off' : 'radio')}<span>Link</span><span class="v">${s.state}</span></div>`;
  }
}

// Undeclared row values (format.ts XValue): numbers with their last 120 pictures drawn small, short strings as text,
// small arrays as one row per element (x, y, z, w), longer ones as a list. Integers from 0x100 also show in hex.
const xNum = (v: number): string => (Number.isNaN(v) ? '-' : Number.isInteger(v) ? `${int(v)}${Math.abs(v) >= 0x100 ? ` <span class="faint">0x${v.toString(16)}</span>` : ''}` : fmt(v));
function xRows(key: string, v: XValue | undefined, plot: string): string {
  if (v === undefined) return `<dt title="${esc(key)}">${esc(key)}</dt><dd>-</dd>`;
  if (Array.isArray(v)) {
    if (v.length >= 2 && v.length <= 4) return v.map((e, i) => `<dt title="${esc(key)}[${i}]">${esc(key)} ${'xyzw'[i]}</dt><dd>${xNum(e)}</dd>`).join('');
    return `<dt title="${esc(key)}">${esc(key)}</dt><dd class="mono" title="${esc(v.join(', '))}">${esc(v.map((e) => (Number.isInteger(e) ? String(e) : e.toFixed(3))).join(', '))}</dd>`;
  }
  if (typeof v === 'string') return `<dt title="${esc(key)}">${esc(key)}</dt><dd title="${esc(v)}">${esc(v)}</dd>`;
  return `<dt title="${esc(key)}">${esc(key)}</dt><dd>${xNum(v)}${plot}</dd>`;
}
function spark(col: Float32Array | undefined, n: number): string {
  if (!col || n < 2) return '';
  const a = Math.max(1, n - 119); let lo = Infinity, hi = -Infinity;
  for (let i = a; i <= n; i++) { const v = col[i]; if (!Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (!(hi >= lo)) return '';
  const span = hi - lo || 1; let d = ''; let pen = false;
  for (let i = a; i <= n; i++) { const v = col[i]; if (Number.isNaN(v)) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${i - a},${(14 - ((v - lo) / span) * 12).toFixed(1)}`; pen = true; }
  return ` <svg class="xspark" viewBox="0 0 119 16" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}

class Properties implements Editor {
  el = h('div'); bodyClass = 'scroll'; private w = new Watch();
  constructor(private app: App) {}
  meta(): string { return `picture ${this.app.view.playhead}`; }
  frame(force: boolean): void {
    if (!this.w.changed(this.app) && !force) return;
    const st = this.app.store; const n = this.app.view.playhead; const m = st.meta;
    if (!m) { this.el.replaceChildren(empty('settings', 'No session', 'Properties of the picture under the playhead appear here.')); return; }
    const row = (l: string, v: number, budget?: number) => `<dt title="${esc(l)}">${esc(l)}</dt><dd class="${budget && v > budget ? 'over' : ''}">${fmt(v)}</dd>`;
    let html = `<div class="prop-section"><div class="section-title">${iconSvg('timer')}Picture ${n}${st.has(n) || !n ? '' : ' - not received (gap)'}</div><dl class="props">`;
    for (const p of st.phases) html += row(p.budget ? `${p.label} (budget ${fmt(p.budget, 1)})` : p.label, st.value(p.key, n), p.budget);
    html += `<dt>Fields shown</dt><dd>${st.has(n) ? st.fieldsAt(n) : '-'}</dd></dl></div>`;
    const groups = new Map<string, { key: string; label: string }[]>();
    for (const e of m.extras ?? []) { const g = e.group ?? 'More'; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(e); }
    for (const [g, es] of groups) {
      html += `<div class="prop-section"><div class="section-title">${iconSvg('layers')}${esc(g)}</div><dl class="props">`;
      for (const e of es) { const v = st.value(e.key, n); html += `<dt>${esc(e.label)}</dt><dd>${Number.isInteger(v) ? int(v) : fmt(v)}</dd>`; }
      html += '</dl></div>';
    }
    const xs = st.xFields();
    if (xs.length) {
      html += `<div class="prop-section"><div class="section-title">${iconSvg('binary')}Row values</div><dl class="props">`;
      for (const x of xs) html += xRows(x.key, st.xAt(x.key, n), x.kind === 'num' ? spark(st.column(x.key), n) : '');
      html += '</dl></div>';
    }
    const ctr = st.countersAt(n); const guards = (m.counters ?? []).filter((c) => c.guard);
    if (guards.length) {
      html += `<div class="prop-section"><div class="section-title">${iconSvg('shield')}Guards (expected 0)</div><dl class="props">`;
      for (const c of guards) { const v = ctr[c.key] ?? 0; html += `<dt>${esc(c.name)}</dt><dd class="${v ? 'over' : ''}">${int(v)}</dd>`; }
      html += '</dl></div>';
    }
    html += `<div class="prop-section"><div class="section-title">${iconSvg('info')}Session</div><dl class="props">
      <dt>Tier</dt><dd title="${esc(m.tierDetail ?? '')}">${esc(m.tier)}</dd><dt>Program</dt><dd title="${esc(m.program.name)}">${esc(m.program.name)}</dd>
      <dt>Window</dt><dd>${m.window ? `${m.window[0]}-${m.window[1]}` : 'all'}</dd><dt>Recorded</dt><dd>${esc(m.recorded.slice(0, 10))}</dd>
      <dt>Source</dt><dd class="long">${esc(m.source ?? '-')}</dd></dl></div>`;
    this.el.innerHTML = html;
  }
}

class Counters implements Editor {
  el = h('div'); bodyClass = 'scroll'; private w = new Watch();
  constructor(private app: App) {}
  meta(): string { const m = this.app.store.meta; const ctr = this.app.store.countersAt(this.app.view.playhead); const bad = (m?.counters ?? []).filter((c) => c.guard && (ctr[c.key] ?? 0) > 0).length; return `${m?.counters?.length ?? 0}${bad ? `, ${bad} guard not 0` : ''}`; }
  frame(force: boolean): void {
    if (!this.w.changed(this.app) && !force) return;
    const st = this.app.store; const defs = st.meta?.counters ?? [];
    if (!defs.length) { this.el.replaceChildren(empty('shield', 'No counters', 'Counters and guards appear when the program sends them.')); return; }
    const ctr = st.countersAt(this.app.view.playhead);
    const sorted = [...defs].sort((a, b) => Number(b.guard && (ctr[b.key] ?? 0) > 0) - Number(a.guard && (ctr[a.key] ?? 0) > 0));
    this.el.innerHTML = `<table class="table dense"><thead><tr><th>Counter</th><th>Group</th><th class="num">Value</th><th>Guard</th></tr></thead><tbody>${sorted.map((c) => {
      const v = ctr[c.key]; const bad = c.guard && (v ?? 0) > 0;
      const g = c.guard ? (bad ? `<span class="pill err">${iconSvg('circle-alert')}not 0</span>` : `<span class="pill ok">${iconSvg('check')}0</span>`) : '<span class="pill">count</span>';
      return `<tr${bad ? ' class="is-selected"' : ''}><td><span class="ellipsis" title="${esc(c.name)}">${esc(c.name)}</span></td><td class="muted">${esc(c.group)}</td><td class="num${bad ? ' over' : ''}">${v == null ? '-' : int(v)}${c.unit ? ` <span class="unit">${esc(c.unit)}</span>` : ''}</td><td>${g}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
}

class Phases implements Editor {
  el = h('div'); bodyClass = 'scroll'; private w = new Watch();
  constructor(private app: App) {}
  meta(): string { const r = this.app.store.windowRange(); return `pictures ${r[0]}-${r[1]}`; }
  frame(force: boolean): void {
    if (!this.w.changed(this.app, String(this.app.store.maxN)) && !force) return;
    const st = this.app.store; if (!st.meta) { this.el.replaceChildren(empty('gauge', 'No session', 'Phase statistics appear when pictures arrive.')); return; }
    const rows = st.phases.map((p) => {
      const s = st.stats(p.key, p.budget ?? 0); const b = p.budget ?? 0;
      return `<tr class="click" data-n="${s.at}"><td><span class="legend-key"><i class="swatch" style="background:var(${p.color || '--chart-draw'})"></i>${esc(p.label)}</span></td><td class="num">${b ? fmt(b, 1) : '-'}</td><td class="num${b && s.mean > b ? ' over' : ''}">${fmt(s.mean)}</td><td class="num">${fmt(s.p95)}</td><td class="num">${fmt(s.worst)}</td><td class="num">${s.at || '-'}</td><td class="num${s.over ? ' over' : ''}" title="${s.over} of ${s.n} pictures">${b ? s.over : '-'}</td></tr>`;
    }).join('');
    const nIn = st.stats(st.phases[0].key).n;
    const gaps = st.gaps(); const miss = gaps.reduce((a, [x, y]) => a + y - x + 1, 0);
    this.el.innerHTML = `<table class="table dense"><thead><tr><th>Phase</th><th class="num">Budget ms</th><th class="num">Mean ms</th><th class="num">p95 ms</th><th class="num">Worst ms</th><th class="num">At</th><th class="num">Over</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="faint" style="padding:var(--s-2) var(--s-3);font-size:var(--fs-xs)">Over: pictures above the budget, of ${nIn} measured. Click a row to go to its worst picture. ${miss ? `${miss} pictures missing (gaps) are left out, not guessed. ` : ''}${esc(st.meta.tier)}.</div>`;
    this.el.querySelectorAll<HTMLElement>('tr[data-n]').forEach((r) => r.addEventListener('click', () => this.app.setPlayhead(Number(r.dataset.n))));
  }
}

class Slowest implements Editor {
  el = h('div'); bodyClass = 'scroll'; private w = new Watch();
  constructor(private app: App) {}
  meta(): string { return 'top 10, measured window'; }
  frame(force: boolean): void {
    if (!this.w.changed(this.app, String(this.app.store.maxN)) && !force) return;
    const st = this.app.store; if (!st.meta) { this.el.replaceChildren(); return; }
    const ph = st.phases.filter((p) => !p.total).slice(0, 2); const tot = st.phases.find((p) => p.total) ?? st.phases[0];
    const list = st.slowestBusy(10);
    this.el.innerHTML = `<table class="table dense"><thead><tr><th class="num">Picture</th><th class="num" title="sum of the phases, before the pacer">Busy ms</th><th class="num">${esc(tot.label)} ms</th>${ph.map((p) => `<th class="num">${esc(p.label)} ms</th>`).join('')}</tr></thead><tbody>${list.map((n) =>
      `<tr class="click${n === this.app.view.playhead ? ' is-selected' : ''}" data-n="${n}"><td class="num">${n}</td><td class="num">${fmt(st.busy(n))}</td><td class="num${tot.budget && st.value(tot.key, n) > tot.budget + 0.05 ? ' over' : ''}">${fmt(st.value(tot.key, n))}</td>${ph.map((p) => { const v = st.value(p.key, n); return `<td class="num${p.budget && v > p.budget ? ' over' : ''}">${fmt(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    this.el.querySelectorAll<HTMLElement>('tr[data-n]').forEach((r) => r.addEventListener('click', () => this.app.setPlayhead(Number(r.dataset.n))));
  }
}

export const listEditors: EditorDef[] = [
  { id: 'log', title: 'Log', icon: 'terminal', group: 'Link', create: (app) => new Log(app) },
  { id: 'outliner', title: 'Outliner', icon: 'list', group: 'Link', create: (app) => new Outliner(app) },
  { id: 'properties', title: 'Properties', icon: 'settings', group: 'Link', create: (app) => new Properties(app) },
  { id: 'counters', title: 'Counters and guards', icon: 'shield', group: 'Performance', create: (app) => new Counters(app) },
  { id: 'phases', title: 'Phases', icon: 'gauge', group: 'Performance', create: (app) => new Phases(app) },
  { id: 'slowest', title: 'Slowest pictures', icon: 'timer', group: 'Performance', create: (app) => new Slowest(app) },
];
