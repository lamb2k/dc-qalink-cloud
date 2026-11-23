// Runs the desktop app in its self-capturing test mode (no window shown, no focus taken), one case after another,
// each with a time limit and stopped by pid if it hangs. Pictures and metrics go to --out (default out/shots).
// Usage: node tools/desktop-capture.mjs [--packaged <path to DC QA Link Cloud.exe>] [--out <dir>] [--case name] [--runs n]
//        [--set readme]   the README's screenshot tour (synthetic demo data and the mock bridge, example paths and
//                         documentation addresses in place of this PC's: --demo-shots)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = resolve(opt('--out', join(root, 'out', 'shots')));
const SET = opt('--set', '');
const EXE = opt('--packaged', '');
const ONLY = opt('--case', '');
const RUNS = Number(opt('--runs', 1));
mkdirSync(OUT, { recursive: true });
const electronExe = EXE || (await import('electron')).default;
const base = EXE ? [] : [join(root, 'desktop', 'main.mjs')];

const both = "localStorage.setItem('qalink-cloud.setup', JSON.stringify({ console: true, flycast: true }));";
const cases = [
  ['desktop-link-dark', ['--query=?ws=link&theme=dark&at=430']],
  ['desktop-live-dark', ['--query=?ws=perf&theme=dark', '--start-bridge', '--wait=3500']],
  ['desktop-commands-dark', ['--query=?ws=commands&theme=dark', '--start-bridge', '--wait=4000', "--eval=setTimeout(() => { document.querySelector('[data-editor=warp] tbody tr.click button')?.click(); setTimeout(() => document.querySelector('[data-editor=control] .btn:nth-of-type(3)')?.click(), 400); setTimeout(() => document.querySelectorAll('[data-editor=warp] tbody tr.click button')[2]?.click(), 800); }, 1800)"]],
  ['desktop-sessions-dark', ['--query=?ws=sessions&theme=dark', '--wait=2000', "--eval=setTimeout(() => studio.pageEl.select(['builtin:demo-session.jsonl', 'builtin:demo-long.jsonl']), 900)"]],
  ['desktop-settings-dark', ['--query=?ws=settings&theme=dark', '--start-bridge', '--wait=2500']],
  ['setup-1-welcome-dark', ['--query=?theme=dark&setup=welcome', `--eval=${both} studio.openSetup('welcome')`]],
  ['setup-2-connection-dark', ['--query=?theme=dark&setup=connection']],
  ['setup-3-loader-dark', ['--query=?theme=dark&setup=loader']],
  ['setup-4-flycast-dark', ['--query=?theme=dark', `--eval=${both} studio.openSetup('flycast')`]],
  ['setup-5-find-dark', ['--query=?theme=dark&setup=find', '--start-bridge', '--wait=5500']],
  ['setup-6-test-dark', ['--query=?theme=dark&setup=test', '--start-bridge', '--wait=4500', "--eval=setTimeout(() => [...document.querySelectorAll('.setup-main .btn-primary')].find((b) => /Run the test/.test(b.textContent))?.click(), 300)"]],
  ['setup-7-agents-dark', ['--query=?theme=dark&setup=agents']],
  ['setup-8-done-dark', ['--query=?theme=dark&setup=done']],
];
// the README tour: dark, 1440x900, the demo session (synthetic) replayed or served live by the mock bridge
const commandsEval = cases.find(([n]) => n === 'desktop-commands-dark')[1][3];
const readme = [
  ['hero-link-live', ['--query=?ws=link&theme=dark', '--start-bridge', '--wait=4000']],
  ['link', ['--query=?ws=link&theme=dark&at=430']],
  ['performance', ['--query=?ws=perf&theme=dark', '--start-bridge', '--wait=3500']],
  ['capture', ['--query=?ws=capture&theme=dark&at=430']],
  ['assets', ['--query=?ws=assets&theme=dark&at=430']],
  ['debug', ['--query=?ws=debug&theme=dark&at=430']],
  ['commands', ['--query=?ws=commands&theme=dark', '--start-bridge', '--wait=4000', commandsEval]],
  ['sessions', ['--query=?ws=sessions&theme=dark', '--wait=2000', "--eval=setTimeout(() => studio.pageEl.select(['builtin:demo-session.jsonl', 'builtin:demo-long.jsonl']), 900)"]],
  ['settings', ['--query=?ws=settings&theme=dark', '--start-bridge', '--wait=2500']],
  ['setup-find', ['--query=?theme=dark&setup=find', '--start-bridge', '--wait=5500']],
  ['setup-test', ['--query=?theme=dark&setup=test', '--start-bridge', '--wait=4500', "--eval=setTimeout(() => [...document.querySelectorAll('.setup-main .btn-primary')].find((b) => /Run the test/.test(b.textContent))?.click(), 300)"]],
  ['setup-agents', ['--query=?theme=dark&setup=agents']],
].map(([n, a]) => [n, [...a, '--demo-shots']]);
const results = [];
for (const [name, extra] of (SET === 'readme' ? readme : cases).filter(([n]) => !ONLY || n === ONLY)) {
  for (let run = 1; run <= RUNS; run++) {
    const ud = join(OUT, '.userdata'); rmSync(ud, { recursive: true, force: true });
    const png = join(OUT, `${name}.png`), met = join(OUT, `${name}${RUNS > 1 ? `-run${run}` : ''}.json`);
    const t = Date.now();
    const p = spawn(electronExe, [...base, `--capture-and-exit=${png}`, `--metrics=${met}`, `--user-data=${ud}`, ...extra.map((a) => (a.startsWith('--eval=') ? `--eval-b64=${Buffer.from(a.slice(7)).toString('base64')}` : a))], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    const killer = setTimeout(() => { log += '\n(time limit 60 s: stopped by pid)'; spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); }, 60000);
    const code = await new Promise((r) => p.on('exit', r)); clearTimeout(killer);
    const m = existsSync(met) ? JSON.parse(readFileSync(met, 'utf8')) : null;
    if (m) m.startToReadyMs = m.readyAt - t; // spawn to the page ready, wall clock
    results.push({ name, run, code, wallMs: Date.now() - t, ...m });
    console.log(`${name}${RUNS > 1 ? ` run ${run}` : ''}: exit ${code}, wall ${Date.now() - t} ms${m ? `, start to ready ${m.startToReadyMs} ms, working set ${m.workingSetMB} MB, private ${m.privateMB} MB, ${JSON.stringify(m.probe)}` : ''}`);
    if (code !== 0) console.log(log.split('\n').filter((l) => !/DevTools|GPU|gpu_|ERROR:(?!.*capture)/.test(l)).slice(-12).join('\n'));
  }
}
rmSync(join(OUT, '.userdata'), { recursive: true, force: true });
writeFileSync(join(OUT, `desktop-capture-${EXE ? 'packaged' : 'dev'}.json`), JSON.stringify(results, null, 2));
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
