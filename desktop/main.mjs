// DC QA Link Cloud desktop app: the Electron main process. It serves the same web build the hosted page uses, from a
// private app:// scheme with a strict content security policy, and gives the page one small interface (preload.cjs,
// src/platform/desktop.ts) for what a browser cannot do: files on disk, watching them, this PC's network interfaces,
// starting the bridge and Flycast by id, and the app's settings. Nothing remote is ever loaded.
//
// Test mode (never shows a window, never takes focus):
//   electron desktop/main.mjs --capture-and-exit=<out.png> [--query=?ws=link] [--size=1440x900] [--wait=1500]
//                             [--metrics=<out.json>] [--start-bridge] [--user-data=<dir>] [--demo-shots]
//   --demo-shots: example paths and documentation addresses in place of this PC's (pictures for the README)
//   --flow-shots=<dir> [--limit=<ms>]: a test flow (the --eval script) asks for pictures by pushing names onto
//     window.__qlShots and ends by setting window.__qlDone (its value is written to <dir>/flow.json); each picture is
//     <dir>/<name>.png. The time limit (default 45 s) covers the whole flow.
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, watch as fsWatch, writeFileSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const T0 = Date.now() - Math.round(process.uptime() * 1000); // process start
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const sw = (k) => app.commandLine.getSwitchValue(k);
const CAPTURE = app.commandLine.hasSwitch('capture-and-exit');
if (sw('user-data')) app.setPath('userData', resolve(sw('user-data')));
// The app was called "QA Link Cloud" before: move its data folder to the new name once, so settings carry over.
else {
  const now = app.getPath('userData'), was = join(app.getPath('appData'), 'QA Link Cloud');
  if (now !== was && !existsSync(now) && existsSync(was)) { try { renameSync(was, now); } catch { app.setPath('userData', was); } }
}

const PACKAGED = app.isPackaged;
const WEB = PACKAGED ? join(ROOT, 'web') : join(ROOT, 'dist');
const TOOLS = PACKAGED ? join(process.resourcesPath, 'tools') : join(ROOT, 'tools');
const DEMO = PACKAGED ? join(TOOLS, 'demo-session.jsonl') : join(ROOT, 'public', 'demo-session.jsonl');
const ICON = PACKAGED ? join(process.resourcesPath, 'icon.png') : join(ROOT, 'build', 'icon.png');
const ORIGIN = 'app://studio';

// ------------------------------------------------------------------ settings (one JSON file in the app's data folder)
const SETTINGS_FILE = () => join(app.getPath('userData'), 'settings.json');
// consoleOnNetwork: the bridge may talk to a Dreamcast on the network (--allow-lan). Off until a person turns it on here:
// a bridge started by a test, a script or an agent talks only to this PC (Flycast). autoconnect: link by itself.
// connection: how the Dreamcast is linked ('' until the first-run set-up answers). buildsRoot: the one folder shared with
// the console (the bridge's --files, --overlay and --asset-root); set only through the folder dialog or the sample.
const DEFAULTS = { version: 1, startBridgeOnLaunch: false, bridgeAddress: 'http://127.0.0.1:52080', flycastPath: '', mcpLocal: false, flycastPrepared: '', consoleOnNetwork: false, autoconnect: true, connection: '', buildsRoot: '' };
let settings = { ...DEFAULTS };
function loadSettings() { try { settings = { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; } }
function saveSettings() { mkdirSync(dirname(SETTINGS_FILE()), { recursive: true }); writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2)); }
const SETTABLE = {
  startBridgeOnLaunch: (v) => typeof v === 'boolean',
  mcpLocal: (v) => typeof v === 'boolean',
  consoleOnNetwork: (v) => typeof v === 'boolean',
  autoconnect: (v) => typeof v === 'boolean',
  bridgeAddress: (v) => typeof v === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(v), // the bridge is local; remote is the remote link's job
  connection: (v) => v === 'bba' || v === 'modem' || v === 'flycast',
};

// ------------------------------------------------------------------ the page: app:// with a strict policy
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);
const CSP = ["default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
  "connect-src 'self' data: blob: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*", "worker-src 'self' blob:",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'"].join('; ');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
async function serve(req) {
  const u = new URL(req.url);
  if (u.host !== 'studio') return new Response('not found', { status: 404 });
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const file = normalize(join(WEB, rel));
  if (!file.startsWith(WEB + sep) && file !== WEB) return new Response('forbidden', { status: 403 });
  try {
    const body = await readFile(file);
    return new Response(body, { headers: { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' } });
  } catch { return new Response('not found', { status: 404 }); }
}
const LOCAL = /^(https?|wss?):\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;
function lockDown(ses) {
  // nothing remote: only the app's own files, data/blob URLs, devtools, and the bridge on this PC
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(d.url.startsWith(`${ORIGIN}/`) || d.url.startsWith('data:') || d.url.startsWith('blob:') || d.url.startsWith('devtools:') || LOCAL.test(d.url)) }));
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((_wc, perm) => perm === 'clipboard-sanitized-write');
  ses.on('will-download', (e) => e.preventDefault()); // saving goes through qalink.saveFile and the system dialog
}

// ------------------------------------------------------------------ IPC: every call checked
const fromApp = (e) => { const u = e.senderFrame?.url ?? ''; if (!u.startsWith(`${ORIGIN}/`)) throw new Error('refused: not the app page'); };
// --demo-shots (test mode only): pictures for the README show neutral example paths and documentation addresses,
// never this PC's folders or network
const DEMO_SHOTS = CAPTURE && app.commandLine.hasSwitch('demo-shots');
const DEMO_PATHS = () => [[app.getPath('userData'), 'C:\\Users\\you\\AppData\\Roaming\\DC QA Link Cloud'], [PACKAGED ? dirname(process.execPath) : ROOT, 'C:\\Tools\\DC QA Link Cloud']];
const neutral = (v) => {
  if (typeof v === 'string') { for (const [from, to] of DEMO_PATHS()) v = v.split(from).join(to); return v; }
  if (Array.isArray(v)) return v.map(neutral);
  if (v && typeof v === 'object' && !(v instanceof Uint8Array)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, neutral(x)]));
  return v;
};
const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => { fromApp(e); const r = await fn(e, ...a); return DEMO_SHOTS ? neutral(r) : r; });
const DEMO_NETS = [
  { name: 'Ethernet', address: '192.0.2.10', family: 'IPv4', netmask: '255.255.255.0', internal: false, virtual: false, lan: true },
  { name: 'Wi-Fi', address: '198.51.100.23', family: 'IPv4', netmask: '255.255.255.0', internal: false, virtual: false, lan: false },
  { name: 'Loopback Pseudo-Interface 1', address: '127.0.0.1', family: 'IPv4', netmask: '255.0.0.0', internal: true, virtual: true, lan: false },
];
const PURPOSES = {
  session: { name: 'Session files', ext: ['jsonl', 'ndjson'], max: 512 * 1024 * 1024 },
  build: { name: 'Dreamcast programs', ext: ['elf', 'bin'], max: 64 * 1024 * 1024 },
  asset: { name: 'Models and textures', ext: ['png', 'obj', 'gltf', 'glb'], max: 64 * 1024 * 1024 },
  presets: { name: 'Warp presets', ext: ['json'], max: 4 * 1024 * 1024 },
  padscript: { name: 'Pad scripts', ext: ['txt', 'pad'], max: 1024 * 1024 },
  loader: { name: 'Disc images', ext: ['cdi', 'gdi', 'bin', 'iso'], max: 1024 * 1024 * 1024 },
};
const purposeOf = (p) => { const x = PURPOSES[p]; if (!x) throw new Error(`unknown file purpose ${p}`); return x; };
const granted = new Map(); // handle -> { path, name, purpose }
const watchers = new Map(); // handle -> FSWatcher
async function readGranted(h) {
  const g = granted.get(h); if (!g) throw new Error('unknown file handle');
  const s = await stat(g.path); if (!s.isFile()) throw new Error(`${g.name} is not a file`);
  if (s.size > PURPOSES[g.purpose].max) throw new Error(`${g.name} is larger than ${PURPOSES[g.purpose].max} B`);
  return { handle: h, name: g.name, size: s.size, modified: s.mtimeMs, bytes: new Uint8Array(await readFile(g.path)) };
}
function grant(path, purpose) {
  const p = purposeOf(purpose);
  if (typeof path !== 'string' || !path || !isAbsolute(path)) throw new Error('refused: not a file from the system');
  if (!p.ext.includes(extname(path).slice(1).toLowerCase())) throw new Error(`refused: ${basename(path)} is not one of ${p.ext.join(', ')}`);
  for (const [h, g] of granted) if (g.path === path) return h;
  const h = randomUUID(); granted.set(h, { path, name: basename(path), purpose }); return h;
}

handle('app:info', () => ({ app: 'DC QA Link Cloud', version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: `${process.platform} ${process.arch}`, packaged: PACKAGED, dataDir: app.getPath('userData'), mcp: mcpLaunch(), capture: CAPTURE }));
handle('file:open', async (e, purpose, multi) => {
  const p = purposeOf(purpose);
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: multi ? ['openFile', 'multiSelections'] : ['openFile'], filters: [{ name: p.name, extensions: p.ext }] });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map((f) => readGranted(grant(f, purpose))));
});
handle('file:read-dropped', (_e, path, purpose) => readGranted(grant(path, purpose)));
handle('file:reread', (_e, h) => readGranted(String(h)));
handle('file:save', async (e, purpose, name, data) => {
  const p = purposeOf(purpose);
  if (!(typeof data === 'string' || data instanceof Uint8Array)) throw new Error('refused: data must be text or bytes');
  if ((typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength) > p.max) throw new Error('refused: too large');
  const safe = basename(String(name)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'file';
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: join(app.getPath('documents'), safe), filters: [{ name: p.name, extensions: p.ext }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePath) return { saved: false };
  await writeFile(r.filePath, data); return { saved: true, name: basename(r.filePath) };
});
handle('file:watch', (e, h) => {
  const g = granted.get(String(h)); if (!g) throw new Error('unknown file handle');
  if (watchers.has(h)) return;
  let t = null;
  const w = fsWatch(g.path, () => { clearTimeout(t); t = setTimeout(() => { if (!e.sender.isDestroyed()) e.sender.send('file:changed', { handle: h, name: g.name }); }, 150); });
  watchers.set(h, w);
});
handle('file:unwatch', (_e, h) => { watchers.get(h)?.close(); watchers.delete(h); });
const VIRTUAL = /vethernet|wsl|virtualbox|vmware|hyper-v|loopback|tailscale|zerotier|vpn|docker|bluetooth/i;
const PRIVATE4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
handle('net:interfaces', () => {
  if (DEMO_SHOTS) return DEMO_NETS;
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) for (const i of list ?? []) {
    const virtual = VIRTUAL.test(name);
    out.push({ name, address: i.address, family: i.family === 'IPv6' || i.family === 6 ? 'IPv6' : 'IPv4', netmask: i.netmask, internal: i.internal, virtual, lan: !i.internal && !virtual && i.family !== 'IPv6' && i.family !== 6 && PRIVATE4.test(i.address) });
  }
  return out.sort((a, b) => Number(b.lan) - Number(a.lan) || Number(a.internal) - Number(b.internal) || (a.family === 'IPv4' ? -1 : 1));
});

// ------------------------------------------------------------------ programs, started by id only
// The real bridge is dc-qalink's (Python). Where it is: settings.json's `bridgeDir` (a dc-qalink checkout; not settable
// from the page), else QALINK_DCQALINK, else the packaged resources/bridge. Which Python: `bridgePython`, else
// QALINK_PYTHON, else the packaged embeddable resources/bridge/python/python.exe (docs/DESKTOP.md), else the system
// `python`. `bridgeArgs` (an array, settings.json only) adds the bridge's own options (--selftest, --loader-disc, --files).
function realBridge() {
  const dirs = [settings.bridgeDir, process.env.QALINK_DCQALINK, PACKAGED ? join(process.resourcesPath, 'bridge') : null].filter(Boolean);
  const dir = dirs.find((d) => existsSync(join(d, 'pc', 'qalink_bridge.py')));
  if (!dir) return null;
  const embedded = PACKAGED ? join(process.resourcesPath, 'bridge', 'python', 'python.exe') : null;
  const python = settings.bridgePython || process.env.QALINK_PYTHON || (embedded && existsSync(embedded) ? embedded : 'python');
  const extra = Array.isArray(settings.bridgeArgs) ? settings.bridgeArgs.map(String) : [];
  const pythonLabel = python === 'python' ? 'system Python' : python === embedded ? 'bundled Python' : basename(dirname(python)) === 'Scripts' ? 'Python venv' : 'Python';
  return { script: join(dir, 'pc', 'qalink_bridge.py'), python, pythonLabel, extra };
}
// The builds folder on the bridge's command line: /pc files, the network disc's overlay and the asset root are this one
// folder (dc-qalink 0.2 refuses path imports without a root). Over the modem only --asset-root: builds are pushed, and
// the network disc is not offered (too slow over the modem).
function rootArgs() {
  const r = settings.buildsRoot;
  if (!r || !existsSync(r)) return [];
  return settings.connection === 'modem' ? ['--asset-root', r] : ['--files', r, '--overlay', r, '--asset-root', r];
}
const progs ={ bridge: { child: null, lastExit: null, output: [] }, flycast: { child: null, lastExit: null, output: [] } };
function progSpec(id) {
  if (id === 'bridge') {
    const port = settings.bridgeAddress.split(':').pop();
    const real = realBridge();
    if (real) {
      const args = ['-I', real.script, '--port', port, '--data', join(app.getPath('userData'), 'bridge'), ...(settings.mcpLocal ? ['--mcp-http', String(Number(port) + 1)] : []), ...(settings.consoleOnNetwork && !CAPTURE ? ['--allow-lan'] : []), ...(settings.autoconnect === false ? ['--no-autoconnect'] : []), ...rootArgs(), ...real.extra.filter((x) => x !== '--allow-lan')];
      return { label: `Bridge (dc-qalink, ${real.pythonLabel})`, command: real.python, args, env: {}, cwd: dirname(real.script), configured: true, detail: `http://127.0.0.1:${port}` };
    }
    return { label: 'Bridge (mock: dc-qalink\'s bridge not found)', command: process.execPath, args: [join(TOOLS, 'mock-bridge.mjs'), DEMO, '--port', port, '--loop'], env: { ELECTRON_RUN_AS_NODE: '1' }, configured: existsSync(join(TOOLS, 'mock-bridge.mjs')), detail: `http://127.0.0.1:${port}` };
  }
  if (id === 'flycast') {
    const dir = join(app.getPath('userData'), 'flycast');
    return { label: 'Flycast', command: settings.flycastPath, args: [], env: { FLYCAST_CONFIG_DIR: dir, FLYCAST_DATA_DIR: join(dir, 'data') }, configured: !!settings.flycastPath && existsSync(settings.flycastPath), detail: settings.flycastPath ? basename(settings.flycastPath) : 'not chosen' };
  }
  throw new Error(`unknown program ${id}`);
}
function progStatus(id) {
  const s = progSpec(id); const p = progs[id];
  return { id, label: s.label, configured: s.configured, running: !!p.child, pid: p.child?.pid ?? null, detail: s.detail, lastExit: p.lastExit, output: p.output.slice(-12) };
}
const sendAll = (ch, v) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(ch, v); };
function startProgram(id) {
  const s = progSpec(id); const p = progs[id];
  if (p.child) return progStatus(id);
  if (!s.configured) throw new Error(id === 'flycast' ? 'choose flycast.exe first' : 'the bridge program is missing');
  const child = spawn(s.command, s.args, { cwd: s.cwd ?? dirname(s.command === process.execPath ? s.args[0] : s.command), env: { ...process.env, ...s.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  p.child = child; p.output = [];
  const take = (b) => { for (const l of b.toString().split(/\r?\n/).filter(Boolean)) { p.output.push(l.slice(0, 300)); if (p.output.length > 200) p.output.shift(); } sendAll('prog:status', progStatus(id)); };
  child.stdout.on('data', take); child.stderr.on('data', take);
  child.on('exit', (code) => { p.child = null; p.lastExit = code; sendAll('prog:status', progStatus(id)); });
  child.on('error', (err) => { p.output.push(String(err)); });
  sendAll('prog:status', progStatus(id));
  return progStatus(id);
}
function stopProgram(id) { const p = progs[id]; if (p.child) { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(p.child.pid), '/T', '/F'], { windowsHide: true }) : p.child.kill(); } catch { /* gone */ } } return progStatus(id); }
const PROG_IDS = ['bridge', 'flycast'];
const progId = (id) => { if (!PROG_IDS.includes(id)) throw new Error(`unknown program ${id}`); return id; };
handle('prog:list', () => PROG_IDS.map(progStatus));
// Flycast: the bridge first, so its port is open when the loader first calls. Seen in Flycast (lane ql-demo, 2026-11-23):
// a bridge started after the loader had beaconed about 15 s to a closed port heard the beacons, but the loader never
// answered LOAD ("no answer to LOAD within 30 s"); a bridge already listening at boot pushes at once.
handle('prog:start', async (_e, id) => {
  if (progId(id) === 'flycast' && !progs.bridge.child && progSpec('bridge').configured) { startProgram('bridge'); await new Promise((r) => setTimeout(r, 800)); }
  return startProgram(progId(id));
});
handle('prog:stop', (_e, id) => stopProgram(progId(id)));
handle('prog:choose-flycast', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Choose flycast.exe', properties: ['openFile'], filters: [{ name: 'Flycast', extensions: ['exe'] }] });
  if (!r.canceled && r.filePaths[0] && /flycast/i.test(basename(r.filePaths[0]))) { settings.flycastPath = r.filePaths[0]; saveSettings(); }
  return progStatus('flycast');
});
handle('prog:prepare-flycast', () => {
  // the app's own Flycast settings: the broadband adapter on, everything else Flycast's defaults. Never the user's own.
  const dir = join(app.getPath('userData'), 'flycast'); mkdirSync(join(dir, 'data'), { recursive: true });
  const cfg = join(dir, 'emu.cfg');
  if (!existsSync(cfg)) writeFileSync(cfg, '; written by DC QA Link Cloud for its own Flycast runs; your own Flycast settings are not touched\n[network]\nEmulateBBA = yes\nEnable = no\n');
  settings.flycastPrepared = dir; saveSettings();
  return { ok: true, dir, note: 'Flycast started by the app reads this folder; your own Flycast settings stay as they are.' };
});
// ------------------------------------------------------------------ the builds folder and the sample game
// The sample (dc-qalink's example/demo3d, staged: demo3d.elf, DEMO3D/, extras/): settings.json's `sampleDir`, else
// QALINK_SAMPLE, else the packaged resources/sample, else <bridgeDir>/example/demo3d/build/stage. "Start with the sample"
// copies it into the app's data folder once (the person's own copy to change) and makes that the builds folder.
function sampleSource() {
  const real = realBridge();
  const c = [settings.sampleDir, process.env.QALINK_SAMPLE, PACKAGED ? join(process.resourcesPath, 'sample') : null, real ? join(dirname(dirname(real.script)), 'example', 'demo3d', 'build', 'stage') : null].filter(Boolean);
  return c.find((d) => existsSync(join(d, 'demo3d.elf'))) ?? null;
}
const sampleCopy = () => join(app.getPath('userData'), 'sample');
function rootInfo() {
  const r = settings.buildsRoot; const ok = !!r && existsSync(r);
  let programs = [];
  if (ok) try { programs = readdirSync(r).filter((f) => /\.(elf|bin)$/i.test(f) && statSync(join(r, f)).isFile()).sort(); } catch { programs = []; }
  return { root: ok ? r : '', sample: ok && resolve(r) === resolve(sampleCopy()), sampleAvailable: !!sampleSource() || existsSync(join(sampleCopy(), 'demo3d.elf')), connection: settings.connection, programs, shared: ok ? (settings.connection === 'modem' ? 'assets only (modem)' : 'files, network disc and assets') : 'nothing' };
}
// A path the page names must be a plain file name in the builds folder: no folders, no way out of it.
function inRoot(name, exts) {
  const r = settings.buildsRoot; if (!r || !existsSync(r)) throw new Error('refused: no builds folder chosen');
  if (typeof name !== 'string' || !name || name !== basename(name) || name.includes('..')) throw new Error(`refused: ${String(name).slice(0, 80)} is not a file in the builds folder`);
  const p = join(r, name); const real = existsSync(p) ? realpathSync(p) : '';
  const rr = realpathSync(r);
  if (!real || !(real.startsWith(rr + sep)) || !exts.includes(extname(real).slice(1).toLowerCase())) throw new Error(`refused: ${name} is not a file in the builds folder`);
  return real;
}
function restartBridgeIfRunning() { if (progs.bridge.child) { const c = progs.bridge.child; stopProgram('bridge'); c.once('exit', () => { try { startProgram('bridge'); } catch (e) { console.error(e.message); } }); } }
handle('builds:info', () => rootInfo());
handle('builds:choose', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Where do you keep your builds?', properties: ['openDirectory', 'createDirectory'] });
  if (!r.canceled && r.filePaths[0]) { settings.buildsRoot = r.filePaths[0]; saveSettings(); restartBridgeIfRunning(); }
  return rootInfo();
});
handle('builds:use-sample', () => {
  const dst = sampleCopy();
  if (!existsSync(join(dst, 'demo3d.elf'))) { const src = sampleSource(); if (!src) throw new Error('the sample game is not in this build of the app'); cpSync(src, dst, { recursive: true }); }
  settings.buildsRoot = dst; saveSettings(); restartBridgeIfRunning();
  return rootInfo();
});
handle('builds:read', async (_e, name) => { const p = inRoot(name, ['elf', 'bin']); const s = await stat(p); if (s.size > PURPOSES.build.max) throw new Error('refused: too large'); return { name: basename(p), size: s.size, modified: s.mtimeMs, bytes: new Uint8Array(await readFile(p)) }; });
// the sample's texture swap: FLOOR.BMP and extras/FLOOR_ALT.BMP trade places (only in the sample's own folder)
handle('builds:swap-sample-texture', async () => {
  const i = rootInfo(); if (!i.sample) throw new Error('refused: the builds folder is not the sample game');
  const a = join(i.root, 'DEMO3D', 'FLOOR.BMP'), b = join(i.root, 'extras', 'FLOOR_ALT.BMP');
  const [x, y] = await Promise.all([readFile(a), readFile(b)]); await writeFile(a, y); await writeFile(b, x);
  return { changed: 'DEMO3D/FLOOR.BMP', bytes: y.length };
});
handle('settings:get', () => settings);
handle('settings:set', (_e, key, value) => {
  const ok = SETTABLE[key]; if (!ok) throw new Error(`refused: ${key} is not a setting the page may change`);
  if (!ok(value)) throw new Error(`refused: bad value for ${key}`);
  const was = settings[key]; settings[key] = value; saveSettings();
  if (key === 'connection' && was !== value) restartBridgeIfRunning();   // the modem drops the network disc
  return settings;
});
function mcpLaunch() {
  const real = realBridge();
  if (real) return { command: real.python, args: ['-I', real.script, '--mcp', 'stdio', '--bridge', settings.bridgeAddress, '--mcp-level', 'control'], env: {} };
  const script = join(TOOLS, 'mock-mcp.mjs');
  return PACKAGED
    ? { command: process.execPath, args: [script, '--bridge', settings.bridgeAddress, '--level', 'control'], env: { ELECTRON_RUN_AS_NODE: '1' } }
    : { command: 'node', args: [script, '--bridge', settings.bridgeAddress, '--level', 'control'], env: {} };
}

// ------------------------------------------------------------------ the window
function createWindow(query) {
  const [W, H] = (sw('size') || '1440x900').split('x').map(Number);
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, minWidth: 1024, minHeight: 640, backgroundColor: '#0d0e10', title: 'DC QA Link Cloud',
    icon: existsSync(ICON) ? nativeImage.createFromPath(ICON) : undefined, show: false, autoHideMenuBar: true,
    ...(CAPTURE ? { skipTaskbar: true, focusable: false, paintWhenInitiallyHidden: true } : {}),
    webPreferences: { preload: join(HERE, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !PACKAGED && !CAPTURE, backgroundThrottling: !CAPTURE,
      // test mode renders offscreen: the page runs its animation loop at full rate and no window ever appears
      ...(CAPTURE ? { offscreen: true } : {}) },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault(); });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  if (!CAPTURE) win.once('ready-to-show', () => win.show());
  win.loadURL(`${ORIGIN}/index.html${query}`);
  return win;
}

async function capture(win) {
  const out = resolve(sw('capture-and-exit')); const wait = Number(sw('wait') || 1500);
  const LIMIT = Number(sw('limit') || 45000);
  const limit = setTimeout(() => { console.error(`capture: time limit (${LIMIT / 1000} s)`); app.exit(3); }, LIMIT);
  const consoleLines = [];
  win.webContents.on('console-message', (e) => { consoleLines.push(`${e.level}: ${String(e.message).slice(0, 300)}`); if (consoleLines.length > 30) consoleLines.shift(); });
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) { ready = await win.webContents.executeJavaScript('!!window.studio && document.fonts.status === "loaded"').catch(() => false); if (!ready) await new Promise((r) => setTimeout(r, 50)); }
  const readyMs = Date.now() - T0;
  const extra = sw('eval-b64') ? Buffer.from(sw('eval-b64'), 'base64').toString('utf8') : ''; if (extra) await win.webContents.executeJavaScript(extra).catch((e) => console.error('eval:', e.message));
  const flow = sw('flow-shots') ? resolve(sw('flow-shots')) : '';
  if (flow) {
    mkdirSync(flow, { recursive: true });
    for (;;) {
      const r = await win.webContents.executeJavaScript('({ shots: (window.__qlShots || []).splice(0), done: window.__qlDone ?? null })').catch(() => ({ shots: [], done: null }));
      for (const n of r.shots) { const im = await win.webContents.capturePage(); writeFileSync(join(flow, `${basename(String(n))}.png`), im.toPNG()); await win.webContents.executeJavaScript(`(window.__qlShotsTaken = (window.__qlShotsTaken || 0) + 1)`); }
      if (r.done !== null) { writeFileSync(join(flow, 'flow.json'), JSON.stringify(r.done, null, 2)); break; }
      await new Promise((x) => setTimeout(x, 150));
    }
  }
  await new Promise((r) => setTimeout(r, wait));
  const img = await win.webContents.capturePage();
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, img.toPNG());
  const probe = await win.webContents.executeJavaScript(`({ desktop: !!window.qalink, state: window.studio?.source.state, ws: window.studio?.ws, pictures: window.studio?.store.maxN, title: document.title })`).catch(() => ({}));
  const metrics = app.getAppMetrics();
  const m = { readyMs, readyAt: T0 + readyMs, size: img.getSize(), workingSetMB: Math.round(metrics.reduce((a, x) => a + (x.memory?.workingSetSize ?? 0), 0) / 1024), privateMB: Math.round(metrics.reduce((a, x) => a + (x.memory?.privateBytes ?? 0), 0) / 1024), processes: metrics.length, packaged: PACKAGED, electron: process.versions.electron, probe, console: consoleLines };
  if (sw('metrics')) writeFileSync(resolve(sw('metrics')), JSON.stringify(m, null, 2));
  console.log(`capture: ${out} ${m.size.width}x${m.size.height}, ready ${readyMs} ms, working set ${m.workingSetMB} MB, ${JSON.stringify(probe)}`);
  clearTimeout(limit);
  for (const id of PROG_IDS) stopProgram(id);
  setTimeout(() => app.exit(0), 300);
}

if (!CAPTURE && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); } });
  app.whenReady().then(async () => {
    loadSettings();
    Menu.setApplicationMenu(null);
    protocol.handle('app', serve);
    lockDown(session.defaultSession);
    let query = sw('query') || '';
    if (app.commandLine.hasSwitch('start-bridge') || (!CAPTURE && settings.startBridgeOnLaunch)) {
      try { startProgram('bridge'); if (!query.includes('src=')) query += (query ? '&' : '?') + `src=live&bridge=${encodeURIComponent(settings.bridgeAddress)}`; } catch (e) { console.error(e.message); }
      await new Promise((r) => setTimeout(r, 600));
    }
    const win = createWindow(query);
    if (CAPTURE) await capture(win);
  });
  app.on('window-all-closed', () => { for (const id of PROG_IDS) stopProgram(id); app.quit(); });
}
