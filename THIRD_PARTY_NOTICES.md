# Third-party notices

QA Link Cloud is MIT licensed (`LICENSE`). It ships or builds with the parts below. Every one may be redistributed.

## Fonts (in the app, `src/styles/fonts/`)

| Font | Copyright | Licence | Full text |
|---|---|---|---|
| Inter (400, 500, 600, Latin subset) | 2016 The Inter Project Authors | SIL Open Font License 1.1 | `src/styles/fonts/LICENSE-inter.txt` |
| JetBrains Mono (400, 500, 600, Latin subset) | 2020 The JetBrains Mono Project Authors | SIL Open Font License 1.1 | `src/styles/fonts/LICENSE-jetbrains-mono.txt` |

The OFL allows bundling the fonts with software. They are unmodified subsets and are not sold on their own.

## Icons (in the app, `src/ui/icons-data.ts`)

| Icons | Copyright | Licence | Full text |
|---|---|---|---|
| Lucide (from `lucide-static`), some derived from Feather | Lucide Icons and Contributors; Cole Bemis (Feather) | ISC; MIT (Feather) | `src/ui/LICENSE-lucide.txt` |

## In the desktop app

- **Electron** (MIT) and **Chromium** (BSD-3-Clause and others): the release zip carries Electron's `LICENSE` and
  `LICENSES.chromium.html` beside `QA Link Cloud.exe`.
- **dc-qalink's bridge** (MIT, https://github.com/lamb2k/dc-qalink): the release zip carries its `pc/` folder and
  `LICENSE` in `resources/bridge/` (pinned commit in `resources/bridge/SOURCE.txt`).
- **The mock bridge and mock MCP server** (`resources/tools/`) are bundled with esbuild from this repository's code and
  the packages below that they import; the licence comments of those packages are kept at the end of each file.

## npm packages the app and its tools use at run time

`npm ls --omit=dev --all`: 92 packages, all MIT, ISC, BSD-2-Clause or BSD-3-Clause. Each package's own licence file
is in `node_modules/<name>/` after `npm ci`.

| Package | Version | Licence |
|---|---|---|
| @hono/node-server | 2.1.11 | MIT |
| @modelcontextprotocol/sdk | 1.32.2 | MIT |
| accepts | 2.0.0 | MIT |
| ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| body-parser | 2.4.0 | MIT |
| bytes | 3.1.2 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| content-disposition | 2.0.1 | MIT |
| content-type | 2.1.0 | MIT |
| cookie | 0.7.2 | MIT |
| cookie-signature | 1.2.2 | MIT |
| cors | 2.8.6 | MIT |
| cross-spawn | 7.0.6 | MIT |
| debug | 4.4.3 | MIT |
| depd | 2.0.0 | MIT |
| dunder-proto | 1.0.1 | MIT |
| ee-first | 1.1.1 | MIT |
| encodeurl | 2.0.3 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| escape-html | 1.0.3 | MIT |
| etag | 1.8.1 | MIT |
| eventsource | 3.0.7 | MIT |
| eventsource-parser | 3.1.1 | MIT |
| express | 5.3.0 | MIT |
| express-rate-limit | 8.7.5 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-uri | 3.1.9 | BSD-3-Clause |
| finalhandler | 2.1.1 | MIT |
| forwarded | 0.2.0 | MIT |
| fresh | 2.0.0 | MIT |
| function-bind | 1.1.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| gopd | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| hasown | 2.0.4 | MIT |
| hono | 4.13.20 | MIT |
| http-errors | 2.0.1 | MIT |
| iconv-lite | 0.7.3 | MIT |
| inherits | 2.0.4 | ISC |
| ip-address | 10.7.6 | MIT |
| ipaddr.js | 1.9.1 | MIT |
| is-promise | 4.0.0 | MIT |
| isexe | 2.0.0 | ISC |
| jose | 6.2.18 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| json-schema-typed | 8.0.2 | BSD-2-Clause |
| math-intrinsics | 1.1.0 | MIT |
| media-typer | 1.1.1 | MIT |
| merge-descriptors | 2.0.0 | MIT |
| mime-db | 1.54.0 | MIT |
| mime-types | 3.0.2 | MIT |
| ms | 2.1.3 | MIT |
| negotiator | 1.1.0 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.14.0 | MIT |
| on-finished | 2.4.2 | MIT |
| once | 1.4.0 | ISC |
| parseurl | 1.3.3 | MIT |
| path-key | 3.1.1 | MIT |
| path-to-regexp | 8.4.2 | MIT |
| pkce-challenge | 5.0.2 | MIT |
| proxy-addr | 2.0.8 | MIT |
| qs | 6.17.1 | BSD-3-Clause |
| range-parser | 1.3.0 | MIT |
| raw-body | 3.0.2 | MIT |
| require-from-string | 2.0.2 | MIT |
| router | 2.3.0 | MIT |
| safer-buffer | 2.1.2 | MIT |
| send | 1.2.1 | MIT |
| serve-static | 2.2.1 | MIT |
| setprototypeof | 1.2.0 | ISC |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| statuses | 2.0.2 | MIT |
| toidentifier | 1.0.1 | MIT |
| type-is | 2.1.0 | MIT |
| unpipe | 1.0.0 | MIT |
| vary | 1.1.2 | MIT |
| which | 2.0.2 | ISC |
| wrappy | 1.0.2 | ISC |
| ws | 8.23.0 | MIT |
| zod | 4.6.7 | MIT |
| zod-to-json-schema | 3.25.2 | ISC |

Build-only tools (not shipped): TypeScript (Apache-2.0), Vite and esbuild (MIT), Vitest (MIT), @electron/packager
(BSD-2-Clause), lucide-static (ISC).
