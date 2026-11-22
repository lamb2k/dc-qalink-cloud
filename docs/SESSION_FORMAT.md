# Session format, version 1

A session is what a linked program sent while it ran, written down. The bridge's live stream carries the same
records, so a recording is the stream saved to a file and a replay feeds them back on a clock.
Types: `src/data/format.ts` (`SESSION_FORMAT = "dc-qalink.session"`, `SESSION_FORMAT_VERSION = 1`).

## File

- JSON lines, UTF-8: one record per line, `\n` or `\r\n` endings; blank lines are skipped.
- The first record is `meta`. Every record has a type field `t`.
- Records may come in any order after `meta`; a reader orders them by picture `n`.
- A picture number `n` counts from 1. A picture with no `row` is a **gap**: it never arrived. Readers show a gap as a
  gap (lines break, the span is hatched, statistics leave it out); they never fill it in.
- A reader refuses a file whose `meta.version` is newer than the one it knows, or whose `format` is not
  `dc-qalink.session`, and names the line.
- Game pictures and run data are private: session files are kept out of public repositories.

## Records

| `t` | Fields | Meaning |
|---|---|---|
| `meta` | `format`, `version`, `id`, `label`, `program {name, bytes?, hash?}`, `device {kind: flycast or console, name, transport: bba or modem}`, `tier`, `tierDetail?`, `source?`, `recorded` (ISO time), `rate` (pictures a second), `units`, `phases[]`, `extras[]?`, `window? [first, last]`, `counters[]?`, `lanes[]?`, `outline[]?`, `synthetic?` | What ran, on what, and how to read the numbers. `tier` is the evidence label shown beside every number (for example "Flycast, calibrated model"). `synthetic: true` marks generated demo data. |
| `row` | `n`, `ph {key: ms}`, `f?` (fields shown), `x? {key: value}` | One picture: time per phase, and extra values named in `meta.extras`. |
| `ctr` | `n`, `v {key: value}` | Counter values from picture `n` on (the latest snapshot at or before a picture applies). |
| `log` | `n` (or `null` while loading), `lv` (`info`, `warn`, `err`, `stub`), `ph?` (`load`, `play`), `msg` | A log line. |
| `trace` | `lane`, `n` (start picture), `d?` (pictures; 0 or absent = an instant), `label` | An event on a trace lane. |
| `grab` | `n`, `w`, `h`, `fmt: "png"`, `data` (base64) or `url`, `label?`, `kind?` (`console` default, `reference`) | A screen grab. `reference` pictures are for comparison and never shown as the console's screen. |
| `end` | `n`, `reason?` | The program stopped. |

### `meta.phases[]`

`{ key, label, budget?, color?, total? }`. `budget` is in `units` (ms per picture) and draws the budget line;
`color` names a chart token (`--chart-draw`, `--chart-svc`, `--chart-behav`, `--chart-wait`); `total: true` marks the
whole-picture time (busy plus pacer wait), drawn in its own strip and never stacked. "Busy" is the sum of the other
phases; the slowest pictures are ranked by it, because the pacer makes picture totals tie.

### `meta.counters[]`

`{ key, name, group, unit?, guard }`. A guard is a counter expected to stay 0; any other value shows red.

### `meta.window`

`[first, last]`: the measured pictures. Pictures before `first` are warm-up: shaded and left out of statistics.

### `meta.outline[]`

`{ depth, icon, label, value? }`: the Outliner's tree (device, loader, program, scene items). `icon` is a Lucide name.

## Example

```
{"t":"meta","format":"dc-qalink.session","version":1,"id":"demo-0001","label":"Spinning cubes, demo","program":{"name":"example.elf"},"device":{"kind":"flycast","name":"Flycast on this PC","transport":"bba"},"tier":"synthetic demo data","recorded":"2026-11-22T10:42:10Z","rate":30,"units":"ms per picture","phases":[{"key":"draw","label":"Drawing","budget":14,"color":"--chart-draw"},{"key":"frame","label":"Picture","budget":33.3,"total":true}],"window":[31,900],"synthetic":true}
{"t":"log","n":null,"lv":"info","ph":"load","msg":"loader 0.2.0: received example.elf"}
{"t":"row","n":1,"ph":{"draw":13.4,"frame":33.3},"f":2}
{"t":"trace","lane":"Pad script","n":32,"d":40,"label":"#0 stick 0,80"}
{"t":"grab","n":15,"w":640,"h":480,"fmt":"png","data":"iVBORw0KGgo..."}
{"t":"end","n":900,"reason":"script finished"}
```

## Versions

- **1** (2026-11-22, ql-ui): first version. Adding an optional field or a record type a reader may ignore keeps the
  version; anything else bumps it.
