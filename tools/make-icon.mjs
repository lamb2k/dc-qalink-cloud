// The app icon: assets/icon/dc-qalink-cloud.svg (the three-arm vortex, owner's pick 2026-11-23, also the favicon and
// the top bar's .brand-mark). Rendered by Electron offscreen (no window shown) at each size, then packed into an .ico.
// Usage: npx electron tools/make-icon.mjs   -> build/icon.png (256) and build/icon.ico (16..256)
import { app, BrowserWindow, protocol } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'build'); mkdirSync(out, { recursive: true });
const SVG = readFileSync(join(root, 'assets/icon/dc-qalink-cloud.svg'), 'utf8');
let page = '';
protocol.registerSchemesAsPrivileged([{ scheme: 'icon', privileges: { standard: true, secure: true } }]);
const SIZES = [256, 128, 64, 48, 32, 24, 16];

app.whenReady().then(async () => {
  protocol.handle('icon', () => new Response(page, { headers: { 'Content-Type': 'text/html' } }));
  const pngs = []; let x = 0; const boxes = [];
  for (const s of SIZES) {
    boxes.push([s, x, `<div style="left:${x}px;width:${s}px;height:${s}px">${SVG.replace('width="64" height="64"', `width="${s}" height="${s}"`)}</div>`]);
    x += s + 8;
  }
  page = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}div{position:absolute;top:0}svg{display:block}</style></head>
    <body>${boxes.map((b) => b[2]).join('')}</body></html>`;
  const w = new BrowserWindow({ width: x, height: 256, show: false, transparent: true, frame: false, useContentSize: true, focusable: false, skipTaskbar: true, paintWhenInitiallyHidden: true });
  await w.loadURL('icon://x/sheet.html');
  await new Promise((r) => setTimeout(r, 500));
  for (const [s, bx] of boxes) pngs.push([s, (await w.webContents.capturePage({ x: bx, y: 0, width: s, height: s })).resize({ width: s, height: s, quality: 'best' }).toPNG()]);
  w.destroy();
  writeFileSync(join(out, 'icon.png'), pngs[0][1]);
  // ICO: header, directory, PNG payloads (Vista+ reads PNG entries)
  const head = Buffer.alloc(6 + 16 * pngs.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(([s, b], i) => { const e = 6 + 16 * i; head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12); off += b.length; });
  writeFileSync(join(out, 'icon.ico'), Buffer.concat([head, ...pngs.map(([, b]) => b)]));
  // a preview strip for review
  for (const [s, b] of pngs) writeFileSync(join(out, `icon-${s}.png`), b);
  console.log(`icon: ${SIZES.join(', ')} px -> build/icon.ico, build/icon.png`);
  app.exit(0);
});
setTimeout(() => { console.error('make-icon: time limit'); process.exit(3); }, 30000);
