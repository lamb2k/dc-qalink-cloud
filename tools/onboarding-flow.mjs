// The first-run set-up driven end to end in the desktop app's test mode (offscreen, no window, no focus), with a picture
// of each step: Flycast only, the bundled sample game as the builds folder, the bridge started by the app, the console
// found, the first run (push, live data, a grab), then the "Try it" page: swap the texture and push again (the floor
// must change), the menu, the crash button, RESET. Two controls: a program named outside the builds folder is refused,
// and the modem answer shows no builds (network disc) step.
//
// Needs a running loader (Flycast with the loader disc and its broadband adapter, or a console) that the bridge can hear.
// Machine settings come from a JSON file merged into the app's settings.json: bridgeDir (a dc-qalink checkout),
// bridgePython, bridgeAddress, bridgeArgs (for example --udp-port, --console, --device), sampleDir (example/demo3d's
// staged folder).
// Usage: node tools/onboarding-flow.mjs --settings <machine.json> --out <dir> [--demo-shots] [--limit <ms>]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = resolve(opt('--out', join(root, 'out', 'onboarding')));
const LIMIT = Number(opt('--limit', 240000));
const machine = JSON.parse(readFileSync(resolve(opt('--settings')), 'utf8'));
const ud = join(OUT, '.userdata'); rmSync(ud, { recursive: true, force: true }); mkdirSync(ud, { recursive: true });
writeFileSync(join(ud, 'settings.json'), JSON.stringify({ version: 1, ...machine }, null, 2));

// the flow, run inside the page (window.studio is the app; window.qalink the desktop interface)
const flow = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now(); const sec = () => Math.round(performance.now() - t0) / 1000;
  const out = { steps: [], ok: true };
  const note = (name, ok, extra = {}) => { out.steps.push({ name, ok: !!ok, at_s: sec(), ...extra }); if (!ok) out.ok = false; };
  const shot = async (n) => { const k = (window.__qlShotsTaken || 0) + 1; (window.__qlShots = window.__qlShots || []).push(n); for (let i = 0; i < 100 && (window.__qlShotsTaken || 0) < k; i++) await sleep(50); };
  // documentation addresses in the pictures: private IPv4 addresses on the page become 192.0.2.x (test mode only)
  const redact = () => { if (!window.__qlRedact) return; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());) { const v = n.nodeValue.replace(/\b(10\.\d+|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d+\.(\d+)\b/g, (_m, _a, _b, d) => `192.0.2.${d}`); if (v !== n.nodeValue) n.nodeValue = v; } };
  if (window.__qlRedact) new MutationObserver(() => redact()).observe(document.body, { childList: true, subtree: true, characterData: true });
  const until = async (fn, ms) => { const end = performance.now() + ms; for (;;) { const v = await fn(); if (v || performance.now() > end) return v; await sleep(200); } };
  const page = () => document.querySelector('.setup-main');
  const button = (re) => [...document.querySelectorAll('.setup-main button, .setup-foot button')].find((b) => re.test(b.textContent));
  const click = async (re) => { const b = button(re); if (b) b.click(); await sleep(400); return !!b; };
  const step = async (id, name) => { studio.openSetup(id); await sleep(500); redact(); await shot(name); };
  const q = window.qalink;
  try {
    // 0. control: the modem has no builds step (no network disc)
    studio.openSetup('welcome');
    (await until(() => document.querySelector('.choice[data-kind="modem"]'), 10000)).click(); await sleep(400);
    const railModem = [...document.querySelectorAll('.setup-rail .step-item')].map((b) => b.textContent);
    note('control: modem shows no builds step', !railModem.some((t) => /Your builds/.test(t)), { rail: railModem });
    studio.openSetup('connection'); await sleep(400); redact(); await shot('control-modem-connection');
    note('control: modem says why', /network disc is skipped/.test(page().textContent));
    // 1. how the Dreamcast connects: Flycast only
    studio.openSetup('welcome'); await sleep(300);
    document.querySelector('.choice[data-kind="flycast"]').click(); await sleep(400); redact(); await shot('1-connection');
    const rail = [...document.querySelectorAll('.setup-rail .step-item')].map((b) => b.textContent);
    note('Flycast: builds step present', rail.some((t) => /Your builds/.test(t)), { rail });
    // 2. builds: the sample
    await step('builds', '2a-builds-empty');
    await click(/Use the sample/); await until(async () => (await q.builds()).sample, 5000);
    await sleep(500); redact(); await shot('2b-builds-sample');
    const b = await q.builds();
    note('sample is the builds folder', b.sample && b.programs.includes('demo3d.elf'), { programs: b.programs, shared: b.shared });
    note('one line: only this folder is shared', /Only this folder is shared with the console/.test(page().textContent));
    // control: a program outside the builds folder is refused
    let refused = '';
    try { await q.readBuild('..\\outside.elf'); } catch (e) { refused = String(e.message || e); }
    let refused2 = '';
    try { await q.readBuild('DEMO3D/../../x.elf'); } catch (e) { refused2 = String(e.message || e); }
    note('control: a file outside the folder is refused', /refused/.test(refused) && /refused/.test(refused2), { refused, refused2 });
    // 3. Flycast step (the person's Flycast is already running with the loader disc: the picture only)
    await step('flycast', '3-flycast');
    // 4. find: start the bridge (with the folder), link
    studio.openSetup('find'); await sleep(300);
    const tFind = sec();
    await q.startProgram('bridge');
    const bridgeArgs = (await q.programs()).find((p) => p.id === 'bridge');
    // "Link by itself" (on by default) links the loader the bridge hears; the page shows Linked
    // with "Link by itself" off (machine settings autoconnect false) the Link button links: pressed when it shows
    let pressed = 0;
    const linked = await until(() => { const l = [...(page()?.querySelectorAll('button') || [])].find((x) => /^Link$/.test(x.textContent.trim())); if (l && !l.disabled) { l.click(); pressed++; } return /Linked:/.test(page()?.textContent || ''); }, 90000);
    out.link_button_presses = pressed;
    out.found_s = sec() - tFind;
    redact(); await shot('4-find');
    note('console found and linked', linked, { seconds: out.found_s, bridge: bridgeArgs?.label, link_button_presses: pressed });
    // 5. first run: push the sample, live data, a grab
    studio.openSetup('test'); await sleep(400);
    const tRun = sec();
    await click(/Push and run/);
    const passed = await until(() => /Passed\./.test(page()?.textContent || '') || /Failed\./.test(page()?.textContent || ''), 90000);
    out.first_run_s = sec() - tRun;
    out.found_to_grab_s = sec() - tFind;
    redact(); await shot('5-first-run');
    const kv = [...page().querySelectorAll('dl.kv dt')].map((d) => [d.textContent, d.nextElementSibling?.textContent]);
    note('first run passed (push, live data, grab)', /Passed\./.test(page().textContent), { seconds: out.first_run_s, from_found_s: out.found_to_grab_s, kv, passed });
    // 6. try it
    studio.openSetup('done'); await sleep(500); redact(); await shot('6a-try-it');
    const tryLine = () => document.querySelector('[data-try]')?.getAttribute('data-try') || '';
    const doTry = async (re, ms) => { const t = sec(); await click(re); await until(() => { const b = button(re); return b && !b.disabled && !/\.\.\.$/.test(tryLine()); }, ms); return { line: tryLine(), seconds: Math.round((sec() - t) * 100) / 100 }; };
    const grabData = () => document.querySelector('.setup-main .test-grab img')?.getAttribute('src') || '';
    // the floor's mean colour (rows 300 to 440 of the grab): the swap must change it
    const floor = async (src) => { if (!src) return null; const im = new Image(); im.src = src; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 300, im.width, 140).data; const m = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; } return m.map((v) => Math.round(v / (d.length / 4))); };
    const before = grabData();
    let r = await doTry(/Swap the floor/, 10000);
    note('texture swapped on the PC', /changed on this PC/.test(r.line), r);
    r = await doTry(/^Push again$/, 120000);
    redact(); await shot('6b-pushed-again');
    note('pushed again', /Pushed .* again/.test(r.line), r);
    const fb = await floor(before), fa = await floor(grabData());
    out.floor = { first_run: fb, after_swap: fa };
    note('the swapped texture shows on the next push', !!fb && !!fa && Math.abs(fa[0] - fb[0]) + Math.abs(fa[2] - fb[2]) > 40, out.floor);
    r = await doTry(/Open it from here/, 30000); redact(); await shot('6c-menu');
    note('menu open', /menu is open/.test(r.line), r);
    r = await doTry(/Press it from here/, 90000); redact(); await shot('6d-crash');
    note('crash button: run crashed with registers', /Crashed, as asked/.test(r.line), r);
    r = await doTry(/^RESET$/, 90000); redact(); await shot('6e-reset');
    note('RESET', /RESET: back at the loader/.test(r.line), r);
  } catch (e) { note('flow error', false, { error: String(e && e.stack || e) }); }
  // diagnostics: the bridge's runs and its last output lines
  try { const B = studio.bridgeUrl; out.runs = (await (await fetch(`${B}/v0/runs`, { headers: { 'X-Contract': '1' } })).json()).runs.map((r) => ({ id: r.id, state: r.state, error: r.error, times: r.times, name: r.program?.name })); } catch (e) { out.runs = String(e); }
  try { out.bridge_output = (await q.programs()).find((p) => p.id === 'bridge')?.output; } catch { /* none */ }
  out.total_s = sec();
  window.__qlDone = out;
};
const evalSrc = `window.__qlRedact = ${args.includes('--demo-shots') ? 'true' : 'false'}; (${flow.toString()})(); undefined;`; // not awaited: the main process takes the pictures meanwhile
const electronExe = (await import('electron')).default;
const t = Date.now();
const p = spawn(electronExe, [join(root, 'desktop', 'main.mjs'), `--capture-and-exit=${join(OUT, 'last.png')}`, `--user-data=${ud}`, `--flow-shots=${OUT}`,
  `--limit=${LIMIT}`, '--wait=200', `--query=?theme=dark&setup=welcome&bridge=${encodeURIComponent(machine.bridgeAddress || 'http://127.0.0.1:52080')}`, ...(args.includes('--demo-shots') ? ['--demo-shots'] : []),
  `--eval-b64=${Buffer.from(evalSrc).toString('base64')}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
const killer = setTimeout(() => { log += '\n(time limit: stopped by pid)'; spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); }, LIMIT + 30000);
const code = await new Promise((r) => p.on('exit', r)); clearTimeout(killer);
writeFileSync(join(OUT, 'app.log'), log);
const res = existsSync(join(OUT, 'flow.json')) ? JSON.parse(readFileSync(join(OUT, 'flow.json'), 'utf8')) : null;
console.log(`exit ${code}, wall ${Date.now() - t} ms`);
if (res) for (const s of res.steps) console.log(`${s.ok ? 'ok    ' : 'FAILED'} ${s.at_s.toFixed(2).padStart(7)} s  ${s.name}`);
rmSync(ud, { recursive: true, force: true });
process.exit(code === 0 && res?.ok ? 0 : 1);
