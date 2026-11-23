"""Contact sheet: JPEG about 1400 px wide, two pictures a row with captions, from PNGs in a folder.
Usage: python -I tools/make-sheet.py <shots dir> <out.jpg> "<title>" name=caption [name=caption ...]"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

shots, out, title = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
items = [a.split('=', 1) for a in sys.argv[4:]]
W, PAD, GAP, COLW = 1400, 20, 16, (1400 - 2 * 20 - 16) // 2
BG, FG, MUTED, LINE = (13, 14, 16), (227, 229, 232), (162, 168, 176), (45, 48, 54)
def font(size, bold=False):
    for f in (['C:/Windows/Fonts/segoeuib.ttf'] if bold else []) + ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf']:
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return ImageFont.load_default()
ft, fc, fs = font(22, True), font(14), font(13)
thumbs = []
for name, cap in items:
    im = Image.open(shots / f'{name}.png').convert('RGB')
    h = round(im.height * COLW / im.width)
    thumbs.append((im.resize((COLW, h), Image.LANCZOS), cap))
rows = [thumbs[i:i + 2] for i in range(0, len(thumbs), 2)]
H = PAD + 34 + 26 + sum(max(t.height for t, _ in r) + 30 + GAP for r in rows) + PAD
sheet = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(sheet)
d.text((PAD, PAD), title, font=ft, fill=(245, 246, 247))
d.text((PAD, PAD + 34), 'DC QA Link Cloud (ql-app), dark, 1440x900. Synthetic demo data and the mock bridge; no console. Finished, unaudited.', font=fs, fill=MUTED)
y = PAD + 34 + 26 + 8
for r in rows:
    x = PAD
    for t, cap in r:
        sheet.paste(t, (x, y)); d.rectangle([x - 1, y - 1, x + t.width, y + t.height], outline=LINE)
        d.text((x, y + t.height + 6), cap, font=fc, fill=FG); x += COLW + GAP
    y += max(t.height for t, _ in r) + 30 + GAP
out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out, 'JPEG', quality=86); print(f'sheet {out} {W}x{H}')
