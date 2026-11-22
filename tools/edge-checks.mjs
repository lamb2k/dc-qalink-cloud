// Picture tests, speed test and keyboard-only walk in Edge headless, driven over the DevTools protocol.
// Starts one `vite preview` (the built app) and one headless Edge, both stopped by pid at the end. No window opens.
// Usage: node tools/edge-checks.mjs [shots|speed|walk|private|all] [--out <dir>]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const mode = process.argv[2] || 'all';
const oi = process.argv.indexOf('--out');
const OUT = oi > 0 ? process.argv[oi + 1] : join(root, '..', 'shots');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 5179, DBG = 9333, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const procs = [];
function start(cmd, args, opts = {}) { const p = spawn(cmd, args, { stdio: 'ignore', windowsHide: true, ...opts }); procs.push(p); return p; }
function stopAll() { for (const p of procs) { try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else p.kill(); } catch { /* gone */ } } }
process.on('exit', stopAll);
const hardStop = setTimeout(() => { console.error('edge-checks: time limit (8 min), stopping'); stopAll(); process.exit(3); }, 8 * 60 * 1000);

async function waitHttp(url, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.ok) return r; } catch { /* not yet */ } await sleep(200); } throw new Error(`no answer from ${url}`); }

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.wait = new Map(); this.events = []; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && this.wait.has(d.id)) { const { res, rej } = this.wait.get(d.id); this.wait.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } else if (d.method) this.events.push(d); }; }
  static async open(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); return new Cdp(ws); }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => { this.wait.set(id, { res, rej }); setTimeout(() => { if (this.wait.has(id)) { this.wait.delete(id); rej(new Error(`${method} timed out`)); } }, 30000); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
  async size(w, h, mobile = false) { await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); }
  async go(url) { await this.send('Page.navigate', { url }); await sleep(300); for (let i = 0; i < 100; i++) { if (await this.eval('document.readyState === "complete" && !!window.studio').catch(() => false)) break; await sleep(100); } await this.eval('document.fonts.ready.then(() => true)'); }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); }
  async key(key, mods = 0, code) {
    const k = { key, code: code || (key.length === 1 ? `Key${key.toUpperCase()}` : key), modifiers: mods, windowsVirtualKeyCode: vk(key) };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k }); if ((key.length === 1 || key === 'Enter') && !mods) await this.send('Input.dispatchKeyEvent', { type: 'char', text: key === 'Enter' ? '\r' : key, ...k }); await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  }
  exceptions() { return this.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text); }
}
function vk(k) { const m = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, ' ': 32, '.': 190, ',': 188 }; return m[k] ?? k.toUpperCase().charCodeAt(0); }

async function main() {
  start(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root });
  await waitHttp(`${BASE}/`);
  const prof = join(root, '.edge-profile'); rmSync(prof, { recursive: true, force: true });
  start(EDGE, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--window-size=1440,900', 'about:blank']);
  await waitHttp(`http://127.0.0.1:${DBG}/json/version`);
  const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const c = await Cdp.open(page.webSocketDebuggerUrl);
  await c.send('Page.enable'); await c.send('Runtime.enable');
  const report = { mode, shots: [], speed: [], walk: null, exceptions: [] };

  if (mode === 'shots' || mode === 'all') {
    const at = 430;
    const cases = [];
    for (const theme of ['dark', 'light']) {
      for (const ws of ['link', 'perf', 'capture', 'assets', 'debug']) cases.push([`${ws}-${theme}`, `?ws=${ws}&theme=${theme}&at=${at}`, 1440, 900]);
      cases.push([`unlinked-${theme}`, `?ws=link&theme=${theme}&state=unlinked`, 1440, 900]);
      cases.push([`lost-${theme}`, `?ws=link&theme=${theme}&state=lost&at=412`, 1440, 900]);
      cases.push([`phone-${theme}`, `?theme=${theme}&at=${at}`, 390, 844, true]);
      cases.push([`phone-perf-${theme}`, `?ws=perf&theme=${theme}&at=${at}`, 390, 844, true]);
    }
    cases.push(['long-values-dark', `?ws=link&theme=dark&session=long&at=${at}`, 1440, 900]);
    cases.push(['long-values-perf-light', `?ws=perf&theme=light&session=long&at=${at}`, 1440, 900]);
    cases.push(['empty-capture-dark', '?ws=capture&theme=dark&at=5', 1440, 900]);
    cases.push(['link-1280-dark', `?ws=link&theme=dark&at=${at}`, 1280, 720]);
    // ql-app: the new pages on the web build (desktop-only actions hidden)
    cases.push(['web-commands-dark', `?ws=commands&theme=dark&at=${at}`, 1440, 900]);
    cases.push(['web-sessions-dark', '?ws=sessions&theme=dark', 1440, 900]);
    cases.push(['web-settings-dark', '?ws=settings&theme=dark', 1440, 900]);
    cases.push(['web-settings-remote-on-dark', '?ws=settings&theme=dark&remote=on', 1440, 900]);
    cases.push(['web-setup-dark', '?setup=connection&theme=dark', 1440, 900]);
    cases.push(['web-commands-light', `?ws=commands&theme=light&at=${at}`, 1440, 900]);
    for (const [name, q, w, h, mobile] of cases) {
      await c.size(w, h, !!mobile); await c.go(`${BASE}/${q}`); await sleep(1400);
      const f = join(OUT, `${name}.png`); await c.shot(f); report.shots.push(f);
      const overflow = await c.eval('document.documentElement.scrollWidth > innerWidth');
      if (overflow) report.exceptions.push(`${name}: page wider than the screen`);
    }
    // the palette and an editor menu, open
    await c.size(1440, 900); await c.go(`${BASE}/?ws=link&theme=dark&at=${at}`); await sleep(900);
    await c.key('k', 2); await c.send('Input.insertText', { text: 'grab' }); await sleep(300); await c.shot(join(OUT, 'palette-dark.png')); await c.key('Escape');
    await c.eval(`document.querySelector('[data-editor="graphs"] .ed').click(), true`); await sleep(300); await c.shot(join(OUT, 'menu-dark.png')); await c.key('Escape');
    // hover readout on the graphs
    const box = await c.eval(`(() => { const r = document.querySelector('[data-editor="graphs"] canvas').getBoundingClientRect(); return [r.left + r.width * 0.55, r.top + r.height * 0.35]; })()`);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box[0], y: box[1] }); await sleep(300); await c.shot(join(OUT, 'hover-dark.png'));
    // ql-app: the Watch an address dialog, and the timeline dragged taller
    await c.go(`${BASE}/?ws=debug&theme=dark&at=${at}`); await sleep(900);
    await c.eval(`document.querySelector('[data-editor="watch"] .area-tools button').click(), true`); await sleep(300);
    await c.send('Input.insertText', { text: 'zz' }); await c.key('Enter'); await sleep(200); await c.shot(join(OUT, 'web-watch-dialog-dark.png'));
    report.dialogError = await c.eval(`document.querySelector('.dialog .err:not([hidden])')?.textContent || ''`); await c.key('Escape');
    const g = await c.eval(`(() => { const r = document.querySelector('.tl-grip').getBoundingClientRect(); return [r.left + 200, r.top + r.height / 2]; })()`);
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g[0], y: g[1], button: 'left', clickCount: 1 });
    for (let s = 1; s <= 4; s++) await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g[0], y: g[1] - 40 * s, button: 'left', buttons: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g[0], y: g[1] - 160, button: 'left', clickCount: 1 }); await sleep(300);
    report.timelineH = await c.eval(`document.querySelector('.ws-timeline').offsetHeight`);
    await c.eval(`document.querySelector('.tl-grip').focus(), true`); for (let k = 0; k < 4; k++) await c.key('ArrowUp'); await sleep(200);
    report.timelineHKeys = await c.eval(`document.querySelector('.ws-timeline').offsetHeight`); await c.shot(join(OUT, 'web-timeline-tall-dark.png'));
    console.log(`timeline height: drag ${report.timelineH}, then 4 x ArrowUp ${report.timelineHKeys}`);
    await c.eval(`localStorage.removeItem('qalink-cloud.timeline.h'), true`);
    console.log(`dialog error shown: "${report.dialogError}"; timeline height after drag: ${report.timelineH}`);
    console.log(`shots: ${report.shots.length + 5} pictures in ${OUT}`);
  }

  if (mode === 'probe') {
    // node tools/edge-checks.mjs probe "?ws=link" "expression" [w h]
    const [q, expr, w, h] = process.argv.slice(3);
    await c.size(Number(w || 1440), Number(h || 900), Number(w) < 600); await c.go(`${BASE}/${q}`); await sleep(1200);
    console.log(JSON.stringify(await c.eval(expr), null, 1));
  }

  if (mode === 'live' || mode === 'all') {
    // LiveSource against the mock bridge: linked, then the bridge drops the socket (lost), then it reconnects
    start(process.execPath, [join(root, 'tools/mock-bridge.mjs'), '--port', '52080', '--drop-after', '9', '--down', '2'], { cwd: root });
    await waitHttp('http://127.0.0.1:52080/v0/status');
    await c.size(1440, 900); await c.go(`${BASE}/?ws=link&theme=dark&src=live&bridge=http://127.0.0.1:52080`);
    await sleep(4000); await c.shot(join(OUT, 'live-linked-dark.png'));
    const a = await c.eval('[studio.source.state, studio.store.maxN]');
    await sleep(6000); await c.shot(join(OUT, 'live-lost-dark.png'));
    const b = await c.eval('[studio.source.state, studio.store.maxN, studio.source.info.lostAt]');
    await sleep(5500); const d = await c.eval('[studio.source.state, studio.store.maxN, studio.store.count]');
    await c.go(`${BASE}/?ws=perf&theme=dark&src=live&bridge=http://127.0.0.1:52080`); await sleep(3000); await c.shot(join(OUT, 'live-perf-dark.png'));
    report.live = { linked: a, lost: b, back: d };
    console.log(`live: linked ${JSON.stringify(a)}, lost ${JSON.stringify(b)}, back ${JSON.stringify(d)}`);
  }

  if (mode === 'sheet') {
    // contact sheets, about 1400 px wide, JPEG, from the pictures in OUT
    const { readFileSync, existsSync } = await import('node:fs');
    const sheets = join(root, '..', 'sheets'); mkdirSync(sheets, { recursive: true });
    const img = (n) => { const f = join(OUT, `${n}.png`); return existsSync(f) ? `data:image/png;base64,${readFileSync(f).toString('base64')}` : ''; };
    const cap = { 'link-dark': 'Link, dark', 'perf-dark': 'Performance, dark', 'capture-dark': 'Capture: A/B compare, difference, grabs, pixel inspector', 'assets-dark': 'Assets (console side is a labelled mock)', 'debug-dark': 'Debug: Runs, run report, Memory, watched values', 'link-light': 'Link, light',
      'unlinked-dark': 'No console linked: the calm home', 'lost-light': 'Link lost (replay simulation): banner, data kept, retry countdown', 'live-lost-dark': 'Live mode against the mock bridge: link lost at picture 192', 'long-values-dark': 'Very long values: names and paths truncate, full text on hover', 'empty-capture-dark': 'Empty states: nothing to compare yet', 'palette-dark': 'Command palette (Ctrl K)', 'hover-dark': 'Graph hover readout; playhead and hover lines stay inside the plots', 'perf-light': 'Performance, light', 'live-perf-dark': 'Live: Performance against the mock bridge', 'menu-dark': 'Area header menu: any editor, split, maximize, close',
      'phone-dark': 'Phone 390 px, dark', 'phone-light': 'Phone, light', 'phone-perf-light': 'Phone, light' };
    const page = (title, names, phones) => `<body style="margin:0;background:#0d0e10;color:#c8ccd2;font:13px Inter,system-ui,sans-serif;width:1400px">
      <div style="padding:16px 20px 4px;font-size:18px;font-weight:600;color:#f5f6f7">${title}</div>
      <div style="padding:0 20px 12px;color:#a2a8b0">QA Link Cloud (ql-ui), Edge headless captures at 1440x900, synthetic demo session (generated test pictures), ${new Date().toISOString().slice(0, 10)}. Finished, unaudited.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 20px;padding:0 20px 20px">${names.map((n) => `<figure style="margin:0"><img src="${img(n)}" style="width:670px;display:block;border:1px solid #2d3036;border-radius:4px"><figcaption style="padding-top:6px">${cap[n] || n}</figcaption></figure>`).join('')}</div>
      ${phones ? `<div style="display:flex;gap:20px;padding:0 20px 20px">${phones.map((n) => `<figure style="margin:0"><img src="${img(n)}" style="width:234px;display:block;border:1px solid #2d3036;border-radius:4px"><figcaption style="padding-top:6px">${cap[n] || n}</figcaption></figure>`).join('')}</div>` : ''}</body>`;
    const make = async (file, title, names, phones) => {
      await c.size(1400, 900); await c.send('Page.navigate', { url: 'about:blank' }); await sleep(300);
      await c.eval(`document.open(); document.write(${JSON.stringify(page(title, names, phones))}); document.close(); Promise.all([...document.images].map((i) => i.decode().catch(() => 0))).then(() => document.body.scrollHeight)`);
      const hgt = await c.eval('document.body.scrollHeight');
      const r = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 86, captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1400, height: hgt, scale: 1 } });
      writeFileSync(join(sheets, file), Buffer.from(r.data, 'base64')); console.log(`sheet ${file}: 1400x${hgt}`);
    };
    await make('studio-workspaces.jpg', 'Workspaces', ['link-dark', 'perf-dark', 'capture-dark', 'assets-dark', 'debug-dark', 'link-light']);
    await make('studio-states.jpg', 'States, tools and phone', ['unlinked-dark', 'lost-light', 'live-lost-dark', 'long-values-dark', 'empty-capture-dark', 'palette-dark', 'hover-dark', 'menu-dark'], ['phone-dark', 'phone-light']);
  }

  if (mode === 'private') {
    // a private recording: pictures go to the private folder only
    const pdir = join(root, '..', 'private-data', 'shots'); mkdirSync(pdir, { recursive: true });
    for (const ws of ['link', 'perf', 'capture']) { await c.size(1440, 900); await c.go(`${BASE}/?ws=${ws}&theme=dark&session=private&at=178`); await sleep(1500); await c.shot(join(pdir, `${ws}-rL-dark.png`)); }
    console.log(`private shots in ${pdir}`);
  }

  if (mode === 'speed' || mode === 'all') {
    for (const ws of ['perf', 'link']) {
      await c.size(1440, 900); await c.send('Page.navigate', { url: `${BASE}/speed.html?seconds=10&ws=${ws}` });
      let res = null; for (let i = 0; i < 200 && !res; i++) { await sleep(250); res = await c.eval('window.speedResult || null').catch(() => null); }
      report.speed.push(res); console.log(`speed ${ws}:`, JSON.stringify(res));
    }
  }

  if (mode === 'walk' || mode === 'all') {
    await c.size(1440, 900); await c.go(`${BASE}/?ws=link&theme=dark&at=430`); await sleep(800);
    await c.eval('localStorage.clear(), true');
    const cmds = await c.eval(`studio.cmds.list.map((x) => ({ id: x.id, title: x.title, on: x.enabled ? x.enabled() : true }))`);
    let found = 0; const missed = [];
    for (const cmd of cmds) {
      if (!cmd.on) continue;
      await c.key('k', 2); await sleep(40);
      await c.send('Input.insertText', { text: cmd.title });
      await sleep(40);
      const hit = await c.eval(`(() => { const a = document.querySelector('.palette-item.is-active'); return a ? a.dataset.cmd : null; })()`);
      if (hit === cmd.id) found++;
      else { // arrow down through the results to reach it, keyboard only
        let ok = false; for (let i = 0; i < 6 && !ok; i++) { await c.key('ArrowDown'); ok = (await c.eval(`document.querySelector('.palette-item.is-active')?.dataset.cmd`)) === cmd.id; }
        if (ok) found++; else missed.push(cmd.id);
      }
      await c.key('Escape'); await sleep(20);
    }
    // run a keyboard-only sequence and check each did what it says
    const checks = [];
    const st = (e) => c.eval(e);
    await c.key('2', 0, 'Digit2'); await sleep(200); checks.push(['2 -> Performance', (await st('studio.ws')) === 'perf']);
    await c.key('1', 0, 'Digit1'); await sleep(200); checks.push(['1 -> Link', (await st('studio.ws')) === 'link']);
    const p0 = await st('studio.view.playhead'); await c.key('.', 0, 'Period'); await sleep(100); checks.push(['. steps one picture', (await st('studio.view.playhead')) === p0 + 1]);
    await c.key(',', 0, 'Comma'); await sleep(100); checks.push([', back one picture', (await st('studio.view.playhead')) === p0]);
    await c.key('t'); await sleep(150); checks.push(['T -> light theme', (await st('document.documentElement.dataset.theme')) === 'light']);
    await c.key('t'); await sleep(150); checks.push(['T -> dark theme', (await st('document.documentElement.dataset.theme')) === 'dark']);
    await c.key('g'); await sleep(300); checks.push(['G grabs (A set)', !!(await st('studio.view.grabA'))]);
    const areas0 = await st('document.querySelectorAll(".area").length');
    await c.key('k', 2); await c.send('Input.insertText', { text: 'Split the focused area right' }); await c.key('Enter'); await sleep(300);
    checks.push(['palette: split adds an area', (await st('document.querySelectorAll(".area").length')) === areas0 + 1]);
    await c.key('k', 2); await c.send('Input.insertText', { text: 'Reset this workspace layout' }); await c.key('Enter'); await sleep(300);
    checks.push(['palette: reset layout', (await st('document.querySelectorAll(".area").length')) === areas0]);
    await c.key('k', 2); await c.send('Input.insertText', { text: 'Go to picture' }); await c.key('Enter'); await c.send('Input.insertText', { text: '250' }); await c.key('Enter'); await sleep(200);
    checks.push(['palette: go to picture 250 (two steps)', (await st('studio.view.playhead')) === 250]);
    await c.key(' ', 0, 'Space'); await sleep(700); checks.push(['Space plays', (await st('studio.source.playing')) === true]);
    await c.key(' ', 0, 'Space'); await sleep(100); checks.push(['Space pauses', (await st('studio.source.playing')) === false]);
    await c.key(']', 2, 'BracketRight'); await sleep(100); checks.push(['Ctrl ] focuses an area header', (await st('document.activeElement?.classList.contains("ed")')) === true]);
    await c.key('Enter'); await sleep(150); checks.push(['Enter opens the editor menu', (await st('!!document.querySelector(".menu")')) === true]);
    await c.key('ArrowDown'); await c.key('Escape'); await sleep(100); checks.push(['Escape closes it', (await st('!document.querySelector(".menu")')) === true]);
    const focusRing = await st(`(() => { const e = document.activeElement; const s = getComputedStyle(e); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; })()`);
    checks.push(['focus is visible on the focused control', focusRing]);
    report.walk = { commands: cmds.length, enabledReached: found, enabled: cmds.filter((x) => x.on).length, missed, checks: checks.map(([n, ok]) => `${ok ? 'pass' : 'FAIL'}  ${n}`) };
    console.log(`walk: ${found} of ${report.walk.enabled} enabled commands reached from the palette by keyboard${missed.length ? '; missed ' + missed.join(', ') : ''}`);
    for (const l of report.walk.checks) console.log('  ' + l);
  }
  report.exceptions.push(...c.exceptions());
  if (report.exceptions.length) console.log('exceptions:', report.exceptions.slice(0, 10));
  writeFileSync(join(OUT, `report-${mode}.json`), JSON.stringify(report, null, 2));
  c.ws.close(); clearTimeout(hardStop); stopAll(); await sleep(500);
  process.exit(report.exceptions.length || report.walk?.checks.some((x) => x.startsWith('FAIL')) || report.walk?.missed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); stopAll(); process.exit(2); });
