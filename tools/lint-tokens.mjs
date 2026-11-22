// Fails when a page, stylesheet or script uses a raw colour or a px value outside tokens.css.
// Rules carried over unchanged from the design lane's lint-tokens.mjs (ql-design 21edad1); only the file list
// changed: every *.html at the root and every *.ts / *.css under src/, except src/styles/tokens.css (the one source)
// and generated icon data (src/ui/icons-data.ts). Exit code 1 on any finding; `npm run build` runs it first.
// Self-test: `node tools/lint-tokens.mjs --probe` lints a planted probe and must fail.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const skip = new Set(['src/styles/tokens.css', 'src/ui/icons-data.ts']);
function walk(dir, out) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|css|html)$/.test(f)) out.push(p);
  }
  return out;
}
const files = readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => join(root, f)).concat(walk(join(root, 'src'), []))
  .filter((p) => !skip.has(relative(root, p).replace(/\\/g, '/')));
const rules = [
  ['raw hex colour', /(?<![&\w])#[0-9a-fA-F]{3,8}\b(?![\w-])/g],
  ['raw rgb/hsl colour', /\b(rgba?|hsla?)\s*\(/g],
  ['raw px value', /(?<![\w-])\d*\.?\d+px\b/g],
];
const sources = files.map((f) => [relative(root, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]);
if (process.argv.includes('--probe')) sources.push(['(probe)', 'a { color: #fff; background: rgb(0,0,0); width: 12px; }']);
let bad = 0;
for (const [f, text] of sources) {
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [name, re] of rules) for (const m of line.matchAll(re)) { bad++; console.log(`${f}:${i + 1}: ${name}: ${m[0]}`); }
  });
}
console.log(bad ? `lint-tokens: ${bad} finding(s) in ${sources.length} files` : `lint-tokens: clean, ${sources.length} files`);
process.exit(bad ? 1 : 0);
