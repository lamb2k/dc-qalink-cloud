// Builds the Windows desktop app (portable, unsigned) from the web build in dist/:
//   stage (desktop/, web/, package.json) -> bundle the mock bridge and the mock MCP server into single files
//   (esbuild, so the app ships no node_modules) -> @electron/packager (asar, icon) -> a portable zip. Nothing is
//   published or signed. Private recordings never enter: the stage is checked and the build stops if one is found.
// Usage: npm run app:dist [-- --out <dir>] [-- --bridge <dc-qalink checkout> --bridge-ref <commit>]
//   --out     where the app folder and zip go (default out/app; the folder is emptied first, so give a build folder)
//   --bridge  bundle dc-qalink's bridge (its pc/ folder and LICENSE) as resources/bridge, so the app runs the real
//             bridge with the system Python; without it the app starts the mock bridge. QALINK_BRIDGE_SRC works too.
//   --python  with --bridge: a prepared Python embeddable folder (python.exe, python312._pth with `import site`, and
//             Lib/site-packages holding numpy, Pillow and mcp; tools/make-python.ps1 makes one). It goes in as
//             resources/bridge/python, so the zip needs no Python on the PC. QALINK_PYTHON_EMBED works too.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { packager } from '@electron/packager';

const root = fileURLToPath(new URL('..', import.meta.url));
const oi = process.argv.indexOf('--out');
const OUT = resolve(oi > 0 ? process.argv[oi + 1] : join(root, 'out', 'app'));
const bi = process.argv.indexOf('--bridge');
const BRIDGE = bi > 0 ? resolve(process.argv[bi + 1]) : process.env.QALINK_BRIDGE_SRC ? resolve(process.env.QALINK_BRIDGE_SRC) : '';
const ri = process.argv.indexOf('--bridge-ref');
const BRIDGE_REF = ri > 0 ? process.argv[ri + 1] : process.env.QALINK_BRIDGE_REF ?? 'unknown';
const pi = process.argv.indexOf('--python');
const PYEMBED = pi > 0 ? resolve(process.argv[pi + 1]) : process.env.QALINK_PYTHON_EMBED ? resolve(process.env.QALINK_PYTHON_EMBED) : '';
if (PYEMBED && !BRIDGE) throw new Error('--python needs --bridge (the Python runs the bundled bridge)');
// --sample <dir>: dc-qalink's sample game, staged (make -C example/demo3d OUT=build stage: build/stage), bundled as
// resources/sample for the set-up's "Start with the sample game". QALINK_SAMPLE_SRC works too; without it the app looks
// beside the bridge (example/demo3d/build/stage) and offers no sample when there is none.
const si = process.argv.indexOf('--sample');
const SAMPLE = si > 0 ? resolve(process.argv[si + 1]) : process.env.QALINK_SAMPLE_SRC ? resolve(process.env.QALINK_SAMPLE_SRC) : '';
if (SAMPLE && !existsSync(join(SAMPLE, 'demo3d.elf'))) throw new Error(`--sample ${SAMPLE}: no demo3d.elf there (stage it first)`);
let pyInfo = null;   // the bundled Python's versions, when --python is given
const CHANNEL = pkg_channel();
function pkg_channel() { try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).releaseChannel ?? ''; } catch { return ''; } }
const STAGE = join(OUT, '..', 'stage');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const t0 = Date.now();

if (!existsSync(join(root, 'dist/index.html'))) throw new Error('run npm run build first (dist/ is the web build)');
if (!existsSync(join(root, 'build/icon.ico'))) throw new Error('run npx electron tools/make-icon.mjs first');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, 'app', 'desktop'), { recursive: true });
mkdirSync(join(STAGE, 'res', 'tools'), { recursive: true });

// the app (inside app.asar)
cpSync(join(root, 'desktop/main.mjs'), join(STAGE, 'app/desktop/main.mjs'));
cpSync(join(root, 'desktop/preload.cjs'), join(STAGE, 'app/desktop/preload.cjs'));
for (const f of ['launch.mjs', 'firewall.mjs']) cpSync(join(root, 'desktop', f), join(STAGE, 'app/desktop', f));   // imported by main.mjs
cpSync(join(root, 'dist'), join(STAGE, 'app/web'), { recursive: true, filter: (s) => !/speed(\.html|-[\w-]+\.js)$/.test(s) });
writeFileSync(join(STAGE, 'app/package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, license: pkg.license, type: 'module', main: 'desktop/main.mjs' }, null, 2));

// programs the app starts (resources/tools, outside the asar so Electron-as-Node can run them)
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
for (const f of ['mock-bridge.mjs', 'mock-mcp.mjs']) {
  await build({ entryPoints: [join(root, 'tools', f)], outfile: join(STAGE, 'res/tools', f), bundle: true, platform: 'node', format: 'esm', target: 'node20', banner, external: ['bufferutil', 'utf-8-validate'], legalComments: 'eof', logLevel: 'warning' });
}
cpSync(join(root, 'public/demo-session.jsonl'), join(STAGE, 'res/tools/demo-session.jsonl'));
cpSync(join(root, 'build/icon.png'), join(STAGE, 'res/icon.png'));

// dc-qalink's bridge (MIT), only its pc/ folder and licence: Python sources and the MCP tool list, no caches
if (SAMPLE) cpSync(SAMPLE, join(STAGE, 'res/sample'), { recursive: true });
if (BRIDGE) {
  if (!existsSync(join(BRIDGE, 'pc', 'qalink_bridge.py'))) throw new Error(`--bridge ${BRIDGE}: no pc/qalink_bridge.py there`);
  cpSync(join(BRIDGE, 'pc'), join(STAGE, 'res/bridge/pc'), { recursive: true, filter: (s) => !/[\\/](__pycache__|ev)([\\/]|$)|\.pyc$/.test(s.slice(BRIDGE.length)) });
  cpSync(join(BRIDGE, 'LICENSE'), join(STAGE, 'res/bridge/LICENSE'));
  if (PYEMBED) {
    const exe = join(PYEMBED, 'python.exe');
    if (!existsSync(exe) || !existsSync(join(PYEMBED, 'Lib', 'site-packages'))) throw new Error(`--python ${PYEMBED}: no python.exe and Lib/site-packages there`);
    // the bundle must import what the bridge needs, isolated from any Python on this PC
    const out = execFileSync(exe, ['-I', '-c', 'import sys, numpy, PIL, mcp; from PIL import Image; from importlib.metadata import version as v; print(sys.version.split()[0], numpy.__version__, Image.__version__, v("mcp"))'], { encoding: 'utf8' }).trim().split(' ');
    pyInfo = { python: out[0], numpy: out[1], pillow: out[2], mcp: out[3] };
    cpSync(PYEMBED, join(STAGE, 'res/bridge/python'), { recursive: true, filter: (s) => !/[\\/]__pycache__([\\/]|$)|\.pyc$/.test(s.slice(PYEMBED.length)) });
  }
  writeFileSync(join(STAGE, 'res/bridge/SOURCE.txt'), `dc-qalink bridge, https://github.com/lamb2k/dc-qalink commit ${BRIDGE_REF} (MIT, see LICENSE).
${pyInfo
    ? `Run by DC QA Link Cloud with the bundled Python ${pyInfo.python} (python/, the official Windows embeddable package) with numpy ${pyInfo.numpy},
Pillow ${pyInfo.pillow} and mcp ${pyInfo.mcp} in python/Lib/site-packages; each package's licence is in its .dist-info folder there.
Command: python/python.exe -I pc/qalink_bridge.py`
    : `Run by DC QA Link Cloud with the system Python 3.10+: python -I pc/qalink_bridge.py. Its MCP part needs: pip install mcp`}
`);
  const theirs = readFileSync(join(STAGE, 'res/bridge/pc/bridge/mcp-tools.json'), 'utf8');
  const ours = execFileSync(process.execPath, [join(root, 'tools/gen-mcp-doc.mjs'), '--json'], { encoding: 'utf8' });
  const names = (t) => JSON.stringify((JSON.parse(t).tools ?? JSON.parse(t)).map((x) => x.name));
  if (names(theirs) !== names(ours)) console.warn('warning: the bundled bridge serves a different MCP tool list than this app');
}
// private data must never be in the stage
const bad = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else { if (/private/i.test(f)) bad.push(p); if (/\.(js|html|jsonl|mjs)$/.test(f) && /@private\/|private-data/.test(readFileSync(p, 'utf8'))) bad.push(`${p} (mentions private data)`); } } };
walk(STAGE);
if (bad.length) { console.error('private data in the stage, stopping:\n' + bad.join('\n')); process.exit(1); }

rmSync(OUT, { recursive: true, force: true });
const [dir] = await packager({
  dir: join(STAGE, 'app'), out: OUT, name: pkg.productName, executableName: pkg.productName, platform: 'win32', arch: 'x64', electronVersion,
  icon: join(root, 'build/icon.ico'), asar: true, prune: false, overwrite: true, quiet: true,
  extraResource: [join(STAGE, 'res/tools'), join(STAGE, 'res/icon.png'), ...(BRIDGE ? [join(STAGE, 'res/bridge')] : []), ...(SAMPLE ? [join(STAGE, 'res/sample')] : [])],
  appVersion: pkg.version, appCopyright: 'MIT licence; built on dc-qalink',
  win32metadata: { CompanyName: 'dc-qalink', FileDescription: pkg.productName, ProductName: pkg.productName, InternalName: pkg.name },
});
// this app's licence and notices beside Electron's own LICENSE and LICENSES.chromium.html
cpSync(join(root, 'LICENSE'), join(dir, 'LICENSE.DC-QA-Link-Cloud.txt'));
cpSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(dir, 'THIRD_PARTY_NOTICES.md'));
// only the English locale ships (the UI is English); Chromium falls back to it
for (const f of readdirSync(join(dir, 'locales'))) if (f !== 'en-US.pak') rmSync(join(dir, 'locales', f));
const size = (p) => { let n = 0; const w = (d) => { for (const f of readdirSync(d)) { const q = join(d, f); const s = statSync(q); if (s.isDirectory()) w(q); else n += s.size; } }; statSync(p).isDirectory() ? w(p) : (n = statSync(p).size); return n; };
const zip = join(OUT, `DC-QA-Link-Cloud-${pkg.version}${CHANNEL ? `-${CHANNEL}` : ''}-win-x64.zip`);
// Windows' own tar (bsdtar) writes the zip; a GNU tar earlier on PATH (Git Bash) would read "E:" as a host
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
execFileSync(TAR, ['-a', '-c', '-f', zip, '-C', OUT, dir.split(/[\\/]/).pop()], { stdio: 'inherit' });
const res = { dir, exe: join(dir, `${pkg.productName}.exe`), folderMB: +(size(dir) / 1048576).toFixed(1), zipMB: +(size(zip) / 1048576).toFixed(1), asarMB: +(size(join(dir, 'resources/app.asar')) / 1048576).toFixed(2), toolsKB: Math.round(size(join(dir, 'resources/tools')) / 1024), bridge: BRIDGE ? { ref: BRIDGE_REF, KB: Math.round(size(join(dir, 'resources/bridge')) / 1024), python: pyInfo ?? 'system Python' } : 'mock only', zip, electronVersion, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
writeFileSync(join(OUT, 'build.json'), JSON.stringify(res, null, 2));
rmSync(STAGE, { recursive: true, force: true });
console.log(JSON.stringify(res, null, 2));
