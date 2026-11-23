# DC QA Link Cloud desktop app (Windows)

The same UI as the web page (`src/`, TypeScript, no framework), inside an Electron shell (`desktop/`). One code base:
the UI asks `desktop()` (`src/platform/desktop.ts`) and shows desktop-only actions only when it answers.

## Build and run
```
npm install
npm run build                      # token lint, type check, web build (dist/)
npx electron tools/make-icon.mjs   # once: build/icon.ico and icon.png from the brand mark
npm run app                        # build and open the app from source (a visible window: for people, not tests)
npm run app:dist                   # portable build: <out>/DC QA Link Cloud-win32-x64/ and a zip (unsigned, not published)
npm run app:capture                # test mode: each case renders offscreen, captures itself and exits; no window
```
`tools/desktop-capture.mjs --packaged "<...>\DC QA Link Cloud.exe"` runs the same cases on the packaged app.

## How it is put together
- **The page** is served from a private `app://studio/` scheme (the web build), with a content security policy on
  every response: scripts from the app only, connections only to the app and to `127.0.0.1` / `localhost` (the bridge).
  Every request to anything else is cancelled; navigation away and new windows are refused; downloads are off (saving
  goes through the system dialog); the only permission granted is writing to the clipboard.
- **The window**: context isolation on, node integration off, sandbox on, web security on, no menu bar, devtools off
  in the packaged app.
- **The preload** (`desktop/preload.cjs`) exposes one object, `window.qalink`, and nothing else. The page never sees
  `ipcRenderer`. **The main process** (`desktop/main.mjs`) checks every call: it comes from the app page, its arguments
  have the right types, file kinds are on a list, sizes are under limits, settings keys are on a list.
- **No paths or command lines from the page.** Files the user picks or drops become handles; the page reads, watches
  and saves through them. Programs are started by id (`bridge`, `flycast`); their command lines live in the main process.

## `window.qalink` (version 1)
| Call | What |
|---|---|
| `info()` | app, Electron, Chromium and Node versions, data folder, how to launch the local MCP |
| `openFiles(purpose, multi?)` | system Open dialog; purpose `session`, `build`, `asset`, `presets`, `padscript`, `loader` sets filters and limits; returns handles with bytes |
| `readDropped(file, purpose)` | reads a file dropped on the window (its path comes from the browser's own File object) |
| `reread(handle)`, `watch(handle)`, `unwatch(handle)`, `onFileChanged(cb)` | read again and watch a granted file (assets and presets reload when saved) |
| `saveFile(purpose, name, data)` | system Save dialog, then write |
| `networkInterfaces()` | this PC's interfaces, with `lan` on the one the console can reach (private IPv4, not virtual) |
| `programs()`, `startProgram(id)`, `stopProgram(id)`, `onProgram(cb)` | the bridge and Flycast: state, pid, last lines |
| `chooseFlycast()`, `prepareFlycast()` | pick flycast.exe with the system dialog; make the app's own Flycast settings folder |
| `settings()`, `setSetting(key, value)` | `startBridgeOnLaunch`, `bridgeAddress` (local only), `mcpLocal`, `consoleOnNetwork`, `autoconnect`, `connection` (`bba`, `modem`, `flycast`), `runDeadline` (seconds as text, `''` = none, the default) |
| `builds()`, `chooseBuilds()`, `useSample()` | the builds folder: the one folder shared with the console. Chosen with the system folder dialog, or the bundled sample game copied once into the app's data folder (`<data>/sample`); a running bridge restarts with it |
| `readBuild(name)` | a program (`.elf`, `.bin`) by its plain name in the builds folder; a folder in the name, `..`, a link out of the folder or another kind is refused |
| `bridgePython()`, `chooseBridgePython()`, `defaultBridgePython()` | the bridge's Python (Settings, "Python for the bridge": a `python.exe` chosen with the system dialog, or back to `QALINK_PYTHON` / the bundled one) |
| `firewallCheck()`, `firewallAllow()` | whether a Windows Firewall rule lets that Python take UDP in (no elevation to look); add it: the app shows what changes, then Windows asks for an administrator's yes (an elevated PowerShell runs `New-NetFirewallRule`, inbound UDP, Private profile, that program only). Never run without the click |
| `swapSampleTexture()` | the sample's floor (`DEMO3D/FLOOR.BMP`) and `extras/FLOOR_ALT.BMP` trade places (only when the builds folder is the sample) |

## The first-run set-up
1. **How is your Dreamcast connected?** Broadband adapter, modem with a DreamPi, or Flycast only (`connection`).
2. **Your builds** (adapter and Flycast): a folder picker or "Start with the sample game". That folder is the bridge's
   `--files`, `--overlay` (the network disc) and `--asset-root`; the page says in one line that only this folder is
   shared with the console. **Modem:** no such step; builds are pushed only, the bridge gets `--asset-root` alone, and
   the network step says why (the network disc is too slow over the modem).
3. The network (console), the loader on the SD card (GDEMU and openMenu named; the loader from the bridge or the
   dc-qalink releases page; the app never writes a card), Flycast (Flycast only), find the console.
4. **First run**: the builds folder's program (the sample's `demo3d.elf` first) pushed, live data read, the screen grabbed
   (the game paused for the grab, so the picture is whole).
5. **Try it**: swap the texture, push again (RESET, push, grab), open the menu, the crash button, RESET.
Settings, "Console and builds", keeps every answer editable.
Starting Flycast from the app starts the bridge first: in Flycast, a bridge started after the loader had called for
about 15 s to a closed port heard its beacons but got no answer to LOAD (lane ql-demo, 2026-11-23). The "Link" button
sends the address the bridge hears the loader from (what its own auto-link uses); the console's own address is
refused by a bridge that talks only to this PC. Grabs pause the game for the read and are tried again for up to 10 s
while a just-started program has not linked yet.

The sample: settings.json `sampleDir`, else `QALINK_SAMPLE`, else the packaged `resources/sample`
(`npm run app:dist -- --sample <dc-qalink>/example/demo3d/build/stage`), else `<bridgeDir>/example/demo3d/build/stage`.
`tools/onboarding-flow.mjs --settings <machine.json> --out <dir> [--demo-shots]` drives the whole set-up in test mode
against a running loader (Flycast or a console) and writes a picture of each step and `flow.json` (each step timed, two
controls: a program outside the folder is refused; the modem shows no builds step).

## The bridge in the app
The program `bridge` is **dc-qalink's real bridge** (Python, contract 1) when the app can find it, else the mock bridge
(`tools/mock-bridge.mjs`, labelled "mock: dc-qalink's bridge not found"). Where it looks (`desktop/main.mjs`,
`realBridge()`): `settings.json`'s `bridgeDir` (a dc-qalink checkout; the page cannot set it), else `QALINK_DCQALINK`,
else the packaged `resources/bridge`. Which Python: `bridgePython`, else `QALINK_PYTHON`, else the bundled embeddable
`resources/bridge/python/python.exe`, else the system `python`. `bridgeArgs` (settings.json only) adds the bridge's own
options (`--selftest`, `--loader-disc`). The command line is
`<python> -I <dc-qalink>/pc/qalink_bridge.py --port 52080 --data <app data>/bridge [--mcp-http 52081]
[--files <builds> --overlay <builds>] [--asset-root <builds>]` (the HTTP MCP when "Local MCP" is on; the builds folder
as above); the Agents snippets name the same script with `--mcp stdio`.
The release zip bundles dc-qalink's `pc/` folder (a pinned commit, MIT) as `resources/bridge` **and its own Python**
in `resources/bridge/python/`, so the PC needs no Python at all:
- the official **Python embeddable package 3.12.10** for Windows x64 (no installer, no registry), its MD5 checked
  against python.org's release page;
- **numpy** (the live-asset converters), **Pillow** (JPEG input and resizing) and **mcp** (the bridge's MCP server)
  as binary wheels in `Lib/site-packages`; `python312._pth` holds `import site` so their `.pth` files run (pywin32);
- the app runs it as `python/python.exe -I pc/qalink_bridge.py ...` (Settings shows "bundled Python"). `-I` keeps out
  `PYTHON*` variables and the user's own site packages.

Build it in two steps:
1. `powershell -File tools/make-python.ps1 -Out <empty folder> -Pip <a Python 3.12 with pip>` (pip only downloads and
   unpacks the wheels for win_amd64; it is not bundled);
2. `npm run app:dist -- --bridge <dc-qalink checkout> --bridge-ref <commit> --python <folder>\python`.
Without `--python` the zip runs the bridge with the system Python 3.10+ (its MCP part then needs `pip install mcp`,
the asset converters numpy); without `--bridge` the app ships the mock bridge only. Licences: THIRD_PARTY_NOTICES.md.
dc-qalink stays usable alone: the same bridge runs from a plain Python install with no app.

At launch the window opens live when the app starts its bridge, or when a bridge already answers at the bridge address
(`desktop/launch.mjs`); the demo replay only when none answers. Windows may drop the console's UDP without asking when
it has no rule for the bridge's Python: the set-up's Find step and Settings say so after 20 s of listening with no
Dreamcast heard (broadband adapter, network allowed), with a button for the one rule (`desktop/firewall.mjs`). Pushes
from the app send no run deadline unless Settings names one (dc-qalink 0.2.0's bridge still stops waiting for the
loader after 900 s when none is sent; the live view stays live either way).

The source is a hard boundary: the demo, a recording and a live build each keep their own panel state (runs, memory
reads, presets and command history, assets, the disc listing; `src/data/scope.ts`), the store is the current source's
only, and a panel with nothing from the current source says so ("this build declares no presets") instead of showing
the demo's. The badge in the header and the status bar always names the source: Demo, Recording or Live on <device>.
`npm run check:boundary` checks it in the app (demo, then a mock bridge with a synthetic build, then the demo again).

## Flycast
The app never edits the user's Flycast settings. `prepareFlycast()` writes the app's own `emu.cfg` (broadband adapter
on) under the app's data folder and starts Flycast with `FLYCAST_CONFIG_DIR` / `FLYCAST_DATA_DIR` pointing there. To
confirm against the Flycast build in use (dc-qalink's Flycast runs): that these variables are read, and the exact key
names for the adapter.

## Test mode
`--capture-and-exit=<png>` with `--query=`, `--size=`, `--wait=`, `--metrics=`, `--start-bridge`, `--user-data=`,
`--eval-b64=`: the window renders offscreen (it never appears and never takes focus), the page's own loop runs at full
rate, `capturePage()` writes the PNG, the metrics file gets start time, memory and the page's console lines, and the
app exits (time limit 45 s inside, 60 s outside by pid).
