// Pad scripts, text form (one step a line, played by the bridge at the console's picture rate):
//   # a comment
//   <pictures> <what is held>
// where what is held is "-" (nothing), any of A B X Y START UP DOWN LEFT RIGHT, "stick <x> <y>" (-1..1),
// "lt <0..1>", "rt <0..1>". Example: "60 stick -1 0" holds the stick left for 2 s at 30 pictures a second.
import { PAD_BUTTONS, type PadButton, type PadStep } from './bridge-api';

export interface PadParse { steps: PadStep[]; errors: { line: number; msg: string }[]; pictures: number }

export function parsePadScript(text: string): PadParse {
  const steps: PadStep[] = []; const errors: PadParse['errors'] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim(); if (!line) return;
    const w = line.split(/\s+/); const frames = Number(w[0]);
    if (!Number.isInteger(frames) || frames < 1 || frames > 3600) { errors.push({ line: i + 1, msg: `starts with "${w[0]}": give the pictures to hold, 1 to 3600` }); return; }
    const s: PadStep = { frames, buttons: [] };
    for (let k = 1; k < w.length; k++) {
      const t = w[k].toUpperCase();
      if (t === '-') continue;
      if (t === 'STICK') { const x = Number(w[k + 1]), y = Number(w[k + 2]); if (!(Math.abs(x) <= 1 && Math.abs(y) <= 1)) { errors.push({ line: i + 1, msg: 'stick needs x and y from -1 to 1' }); return; } s.stick = [x, y]; k += 2; continue; }
      if (t === 'LT' || t === 'RT') { const v = Number(w[k + 1]); if (!(v >= 0 && v <= 1)) { errors.push({ line: i + 1, msg: `${t.toLowerCase()} needs a value from 0 to 1` }); return; } s[t === 'LT' ? 'lt' : 'rt'] = v; k += 1; continue; }
      if ((PAD_BUTTONS as readonly string[]).includes(t)) { s.buttons.push(t as PadButton); continue; }
      errors.push({ line: i + 1, msg: `"${w[k]}" is not a button (A B X Y START UP DOWN LEFT RIGHT), stick, lt or rt` }); return;
    }
    steps.push(s);
  });
  return { steps, errors, pictures: steps.reduce((a, s) => a + s.frames, 0) };
}
