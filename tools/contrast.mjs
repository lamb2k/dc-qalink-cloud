// Measures WCAG 2.1 contrast for the token pairs the app uses, in both themes, from src/styles/tokens.css.
// Text pairs need 4.5:1 (AA, normal text); chart marks, control borders and the focus ring need 3:1 (AA, non-text).
// Translucent tokens are composited over the background first. Exit 1 on any failure.
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
function block(sel) { const i = css.indexOf(`\n${sel} {`); const s = css.indexOf('{', i), e = css.indexOf('}', s); const o = {}; for (const m of css.slice(s + 1, e).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) o[m[1]] = m[2].trim(); return o; }
const theme = { dark: block('[data-theme="dark"]'), light: block('[data-theme="light"]') };
function resolve(t, name, depth = 0) { const v = theme[t][name]; if (!v) throw new Error(`${t}: no ${name}`); const m = v.match(/^var\((--[\w-]+)\)$/); return m && depth < 8 ? resolve(t, m[1], depth + 1) : v; }
function rgba(v) {
  if (v.startsWith('#')) { const x = v.slice(1); const f = x.length === 3 ? [...x].map((c) => c + c).join('') : x; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)).concat(1); }
  const m = v.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error(`colour ${v}`);
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function ratio(t, fg, bg) {
  const b = rgba(resolve(t, bg)); const f = rgba(resolve(t, fg));
  const c = [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
  const [L1, L2] = [lum(c), lum(b)].sort((x, y) => y - x); return (L1 + 0.05) / (L2 + 0.05);
}
const TEXT = 4.5, UI = 3;
const pairs = [];
for (const fg of ['--text', '--text-strong', '--text-muted', '--text-faint']) for (const bg of ['--bg-app', '--bg-canvas', '--bg-panel', '--bg-raised', '--bg-inset', '--bg-hover', '--bg-selected']) pairs.push([fg, bg, TEXT, 'text']);
pairs.push(
  ['--accent', '--bg-panel', TEXT, 'active tab icon, links'], ['--accent', '--accent-soft', TEXT, 'info pill'], ['--accent', '--bg-raised', TEXT, 'replay label'],
  ['--ok', '--ok-soft', TEXT, 'ok pill'], ['--warn', '--warn-soft', TEXT, 'warn pill'], ['--err', '--err-soft', TEXT, 'error pill'],
  ['--ok', '--bg-panel', TEXT, 'status ok'], ['--warn', '--bg-panel', TEXT, 'warn text'], ['--err', '--bg-panel', TEXT, 'over-budget numbers'], ['--err', '--bg-selected', TEXT, 'guard row'],
  ['--warn', '--bg-inset', TEXT, 'log warning'], ['--text', '--err-soft', TEXT, 'lost banner'],
  ['--on-accent', '--accent-solid', TEXT, 'primary button'], ['--text-muted', '--bg-inset', TEXT, 'kbd'],
  ['--chart-axis', '--bg-panel', TEXT, 'axis labels'], ['--text', '--bg-canvas', TEXT, 'chart labels'], ['--err', '--bg-canvas', TEXT, 'chart value over budget'],
  ['--chart-draw', '--bg-canvas', UI, 'series'], ['--chart-svc', '--bg-canvas', UI, 'series'], ['--chart-behav', '--bg-canvas', UI, 'series'],
  ['--chart-budget', '--bg-canvas', UI, 'budget line'], ['--chart-cursor', '--bg-canvas', UI, 'playhead'], ['--chart-over', '--bg-canvas', UI, 'over marks'],
  // inputs and selects need a visible boundary (WCAG 1.4.11); buttons are identified by their label and keep the
  // quieter --border-strong, which is decorative and so not measured
  ['--border-input', '--bg-panel', UI, 'field boundary'], ['--border-input', '--bg-inset', UI, 'field boundary'], ['--border-input', '--bg-raised', UI, 'field in a dialog'], ['--focus', '--bg-panel', UI, 'focus ring'], ['--focus', '--bg-raised', UI, 'focus ring'],
  ['--accent-solid', '--bg-canvas', UI, 'playhead flag'],
);
let fails = 0; const rows = [];
for (const t of ['dark', 'light']) for (const [fg, bg, need, what] of pairs) {
  const r = ratio(t, fg, bg); const ok = r >= need; if (!ok) fails++;
  rows.push(`${ok ? 'pass' : 'FAIL'}  ${t.padEnd(5)} ${fg.padEnd(16)} on ${bg.padEnd(14)} ${r.toFixed(2).padStart(5)} : 1  (needs ${need}, ${what})`);
}
const show = process.argv.includes('--all') ? rows : rows.filter((r) => r.startsWith('FAIL'));
console.log(show.join('\n'));
const min = (t, k) => Math.min(...pairs.filter((p) => p[2] === k).map(([f, b]) => ratio(t, f, b)));
console.log(`contrast: ${rows.length - fails} of ${rows.length} pairs pass AA; lowest text ${min('dark', TEXT).toFixed(2)} dark / ${min('light', TEXT).toFixed(2)} light; lowest non-text ${min('dark', UI).toFixed(2)} / ${min('light', UI).toFixed(2)}`);
process.exit(fails ? 1 : 0);
