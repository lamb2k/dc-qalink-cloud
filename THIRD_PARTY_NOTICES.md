# Third-party notices

DC QA Link Cloud is MIT licensed (`LICENSE`). It ships or builds with the parts below. Every one may be redistributed.

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
  `LICENSES.chromium.html` beside `DC QA Link Cloud.exe`.
- **dc-qalink's bridge** (MIT, https://github.com/lamb2k/dc-qalink): the release zip carries its `pc/` folder and
  `LICENSE` in `resources/bridge/` (pinned commit in `resources/bridge/SOURCE.txt`).
- **The mock bridge and mock MCP server** (`resources/tools/`) are bundled with esbuild from this repository's code and
  the packages below that they import; the licence comments of those packages are kept at the end of each file.
- **Python** (the bridge's interpreter, `resources/bridge/python/`; made by `tools/make-python.ps1`, see below).

## Python, bundled with the bridge (`resources/bridge/python/`)

The release zip runs dc-qalink's bridge with its own Python, so the PC needs none. It is the official **Python
embeddable package 3.12.10 for Windows x64** from python.org, unmodified except for `python312._pth` (one line,
`import site`, so `Lib\site-packages` is on the path), with binary wheels from PyPI unpacked into `Lib\site-packages`.

| Part | Licence | Full text in the zip |
|---|---|---|
| Python 3.12.10 (interpreter and standard library; its bundled OpenSSL, libffi, SQLite, zlib, bzip2, xz, expat and the Microsoft Visual C++ runtime, which Python's licence and Microsoft's redistribution terms cover) | Python Software Foundation License 2 (and the licences listed in it) | `resources/bridge/python/LICENSE.txt` |

The packages, read from each one's own metadata (`License-Expression`, else its licence classifiers). Each package's
licence files are kept in its `.dist-info` folder under `resources/bridge/python/Lib/site-packages/`.

| Package | Version | Licence | Why it is there |
|---|---|---|---|
| numpy | 2.5.5 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0; its wheel bundles OpenBLAS (BSD-3-Clause) and the MSVC C++ runtime in `numpy.libs` | the asset converters (live assets) |
| pillow | 13.0.0 | MIT-CMU | JPEG input and resizing for the asset converters |
| mcp | 2.3.0 | MIT | the bridge's MCP server (agents) |
| mcp-types | 2.3.0 | MIT | a dependency of mcp |
| annotated-types | 0.8.0 | MIT | a dependency of mcp |
| anyio | 4.16.0 | MIT | a dependency of mcp |
| attrs | 26.1.0 | MIT | a dependency of mcp |
| cffi | 2.1.1 | MIT-0 | a dependency of mcp |
| click | 8.5.1 | BSD-3-Clause | a dependency of mcp |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause | a dependency of mcp; its wheel carries OpenSSL (Apache-2.0) |
| h11 | 0.16.0 | MIT | a dependency of mcp |
| httpcore2 | 2.16.2 | BSD-3-Clause | a dependency of mcp |
| httpx2 | 2.16.2 | BSD-3-Clause | a dependency of mcp |
| idna | 3.20 | BSD-3-Clause | a dependency of mcp |
| jsonschema | 4.26.0 | MIT | a dependency of mcp |
| jsonschema-specifications | 2025.9.1 | MIT | a dependency of mcp |
| opentelemetry-api | 1.45.2 | Apache-2.0 | a dependency of mcp |
| pycparser | 3.12 | BSD-3-Clause | a dependency of mcp |
| pydantic | 2.14.4 | MIT | a dependency of mcp |
| pydantic_core | 2.50.5 | MIT | a dependency of mcp |
| PyJWT | 2.15.1 | MIT | a dependency of mcp |
| python-multipart | 0.0.34 | Apache-2.0 | a dependency of mcp |
| pywin32 | 312 | PSF | a dependency of mcp (its Windows console handling) |
| referencing | 0.37.0 | MIT | a dependency of mcp |
| rpds-py | 2026.9.1 | MIT | a dependency of mcp |
| sse-starlette | 3.7.1 | BSD-3-Clause | a dependency of mcp |
| starlette | 1.10.0 | BSD-3-Clause | a dependency of mcp |
| truststore | 0.10.5 | MIT | a dependency of mcp |
| typing_extensions | 4.16.0 | PSF-2.0 | a dependency of mcp |
| typing-inspection | 0.4.5 | MIT | a dependency of mcp |
| uvicorn | 0.54.0 | BSD-3-Clause | a dependency of mcp |

Left out of the bundle, as the bridge does not use them: numpy's test suites, pywin32's GUI editor (`pythonwin`), the
packages' command-line launchers and byte-code caches.

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
