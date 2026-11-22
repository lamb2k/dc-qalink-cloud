# MCP tool list, version 0.3.0 (bridge API 1.0)

Generated from `src/data/mcp-tools.ts` by `node tools/gen-mcp-doc.mjs`; do not edit by hand. The TypeScript file is
the source: it holds every tool's name, purpose, permission level, the bridge API call it maps to, and its inputs and
outputs as JSON Schema. It moves to dc-qalink beside the bridge API when the bridge implements it.

**Who serves it**
- `tools/mock-mcp.mjs` (this repository): the reference, over the mock bridge, with the official TypeScript MCP SDK
  on stdio. `tests/mcp.test.ts` lists the tools and calls `grab_screen`, `live_summary` and `push_build`.
- The bridge (Python, dc-qalink): the same list with the Python MCP SDK, on stdio and a local HTTP port. It loads
  the list from a JSON export of this file (`node tools/gen-mcp-doc.mjs --json`), so names and schemas cannot drift.
- QA Link Cloud (L3b): the same list over HTTP with sign-in, each call through the job queue.

**Permission levels.** A server is started at one level and lists and accepts only the tools at or below it:
read (data, sessions), control (warp, pause, step, pad, grab, reset, assets), run code (push and run a build).
Every call is logged with who made it. Arguments are checked against the input schema before the bridge is called.

**Use it from Claude Code on this PC:** `claude mcp add qalink -- node <qalink-cloud>/tools/mock-mcp.mjs --level control`
(the desktop app's Settings, Agents, shows the exact line for the installed app).

| Tool | Level | What it is for | Inputs | Bridge call |
|---|---|---|---|---|
| `link_status` | read | Is a Dreamcast or Flycast linked, which one, over what (broadband adapter or modem), and which session is recording. Call this first. | none | `GET /v0/status` |
| `list_devices` | read | Devices the bridge knows: Flycast on this PC and consoles whose loader it has heard, with address and loader version. | none | `GET /v0/devices, GET /v0/discovery` |
| `push_build` | run code | Send a program (ELF or BIN) to the linked device and start it. Give a file path on the bridge's PC or the bytes as base64. The bridge checks the hash on receipt. Returns the queued run; use get_run or run_and_wait for its report. | `path`?, `base64`?, `name`?, `device`? | `POST /v0/runs` |
| `run_and_wait` | run code | Push a build, run it, and wait until it ends or the time limit passes. Returns the run with its report (exit, seconds, pictures, numbers with their tier, notes, crash with source lines). | `path`?, `base64`?, `name`?, `device`?, `timeout_s`? | `POST /v0/runs, then GET /v0/runs/<id> until it ends` |
| `get_run` | read | One run with its report, or the list of runs newest first when no id is given. | `id`? | `GET /v0/runs/<id> (or GET /v0/runs for the list)` |
| `self_test` | run code | Push and run the bridge's own small test program to prove the link end to end; wait for its report. | `timeout_s`? | `POST /v0/selftest` |
| `grab_screen` | control | The picture on the console now, as a PNG image (640x480 unless the program sets another mode), with the picture number it was taken at. | none | `POST /v0/stills, then GET /v0/stills/<id>` |
| `live_summary` | read | Time per phase against its budget (mean, p95, worst and where, pictures over budget) over the measured window, guards that should read 0, pictures missing, and the tier of the numbers. | none | `GET /v0/summary` |
| `slowest_pictures` | read | The slowest pictures in the measured window by busy time (the sum of the phases), with each phase's time. | `count`? | `GET /v0/summary?slowest=<count>` |
| `query_trace` | read | Trace events (pad script steps, scenes, loads, sound) in a picture range, optionally one lane. | `from`?, `to`?, `limit`?, `lane`? | `GET /v0/trace` |
| `read_log` | read | The program's log lines in a picture range, filtered by level or text; the newest lines when over the limit. | `from`?, `to`?, `limit`?, `level`?, `q`? | `GET /v0/log` |
| `list_presets` | read | Warp presets, test options and pad scripts the running program registered with the link. | none | `GET /v0/presets` |
| `warp` | control | Move the running program to a preset it registered (see list_presets). | `preset` | `POST /v0/command {cmd: warp}` |
| `pause` | control | Pause the program at the end of the current picture. | none | `POST /v0/command {cmd: pause}` |
| `resume` | control | Resume after a pause or steps. | none | `POST /v0/command {cmd: resume}` |
| `step` | control | Run a number of pictures and pause again. | `count`? | `POST /v0/command {cmd: step}` |
| `set_option` | control | Change a test option the program registered (see list_presets). | `name`, `value` | `POST /v0/command {cmd: option}` |
| `send_pad` | control | Hold buttons, the stick and triggers until the next pad call (state), or play a pad script of steps, each held for a number of pictures (steps). | `state`?, `steps`? | `POST /v0/command {cmd: pad}` |
| `reset` | control | Bring the device back to the loader: "return" asks the program, "watchdog" forces it, "power" uses the smart plug if one is set up. | `level` | `POST /v0/command {cmd: reset}` |
| `read_memory` | read | Read up to 64 KB of the console's memory at an address (hex). Returns base64 bytes and the picture they were read at. | `addr`, `len` | `POST /v0/memory/read` |
| `upload_asset` | control | Send a texture (PNG) or model (OBJ) to the console's live-asset block; it is checked against the console budget first and refused with the reason when over. | `path`?, `base64`?, `name`? | `POST /v0/assets` |
| `list_sessions` | read | Recorded sessions: id, label, device, when, pictures, tier. | none | `GET /v0/sessions` |
| `export_session` | read | A session as its file (JSON lines, session format 1). Large sessions are cut at max_bytes and say so. | `id`, `max_bytes`? | `GET /v0/sessions/<id>` |

## Schemas

### `link_status`: Link status

Level: read. Bridge: `GET /v0/status`.

Input:
```json
{
 "type": "object",
 "properties": {},
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"contract":{"type":"integer","description":"bridge contract (1)"},"bridge":{"type":"string","description":"bridge program and version"},"link":{"type":"string","description":"the loader's link state","enum":["searching","up","lost","refused"]},"device":{"description":"the device this bridge owns: kind, tier, name, transport, address, loader, program"},"session":{"type":"string","description":"session being recorded"},"rate_bps":{"type":"number","description":"bytes a second from the console"},"mode":{"type":"string","description":"full (adapter) or summary (modem)","enum":["full","summary"]},"tier":{"type":"string","description":"where the numbers come from","enum":["console","flycast","mock"]}},"required":["contract","link","mode","tier"]}
```

### `list_devices`: List devices

Level: read. Bridge: `GET /v0/devices, GET /v0/discovery`.

Input:
```json
{
 "type": "object",
 "properties": {},
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"devices":{"type":"array","items":{"type":"object","description":"device: id, kind, tier, name, transport, address, loader"}},"discovery":{"type":"array","items":{"type":"object","description":"a loader heard: address, kind, beacons, chosen"}}},"required":["devices"]}
```

### `push_build`: Push a build

Level: run code. Bridge: `POST /v0/runs`.

Input:
```json
{
 "type": "object",
 "properties": {
  "path": {
   "type": "string",
   "description": "path of the build on the bridge's PC (local MCP only)"
  },
  "base64": {
   "type": "string",
   "description": "the build bytes, base64"
  },
  "name": {
   "type": "string",
   "description": "file name to show (default: from the path)"
  },
  "device": {
   "type": "string",
   "description": "device kind to run on",
   "enum": [
    "flycast",
    "console"
   ]
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"id":{"type":"string","description":"run id (opaque)"},"program":{"type":"object","properties":{"name":{"type":"string","description":"build file name"},"sha256":{"type":"string","description":"hash of the bytes received"},"bytes":{"type":"integer","description":"size"}},"required":[]},"args":{"type":"string","description":"arguments"},"state":{"type":"string","description":"the loader's run state","enum":["queued","sending","running","done","crashed","timeout","reset","lost","refused"]},"times":{"type":"object","description":"seconds: push_s, run_s, report_s, total_s"},"way_back":{"type":"string","description":"stub, watchdog or power"},"queued_at":{"type":"string","description":"ISO time"},"ended_at":{"type":"string","description":"ISO time"},"by":{"type":"string","description":"who sent it"},"device":{"type":"string","description":"device it ran on"},"tier":{"type":"string","description":"console, flycast or mock"},"summary":{"type":"object","properties":{"exit":{"description":"exit code (integer), null while running"},"state":{"type":"string","description":"run state"},"seconds":{"type":"number","description":"run time"},"pictures":{"type":"integer","description":"pictures drawn"},"tier":{"type":"string","description":"console, flycast or mock"},"numbers":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string","description":"name"},"value":{"type":"number","description":"value"},"unit":{"type":"string","description":"unit"},"tier":{"type":"string","description":"tier"}},"required":[]}},"notes":{"type":"array","items":{"type":"string","description":"note"}},"crash":{"type":"object","description":"crash: event, pc, pr, sp"}},"required":[]},"crash":{"type":"object","description":"crash: event, pc, pr, sp"},"error":{"type":"string","description":"why it did not run or come back"},"stills":{"type":"array","items":{"type":"string","description":"still id"}},"report":{"type":"string","description":"the report text (get_run)"}},"required":["id","program","state","tier"]}
```

### `run_and_wait`: Run and wait for the report

Level: run code. Bridge: `POST /v0/runs, then GET /v0/runs/<id> until it ends`.

Input:
```json
{
 "type": "object",
 "properties": {
  "path": {
   "type": "string",
   "description": "path of the build on the bridge's PC"
  },
  "base64": {
   "type": "string",
   "description": "the build bytes, base64"
  },
  "name": {
   "type": "string",
   "description": "file name to show"
  },
  "device": {
   "type": "string",
   "description": "device kind",
   "enum": [
    "flycast",
    "console"
   ]
  },
  "timeout_s": {
   "type": "integer",
   "description": "seconds to wait (default 60)",
   "minimum": 1,
   "maximum": 900
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"id":{"type":"string","description":"run id (opaque)"},"program":{"type":"object","properties":{"name":{"type":"string","description":"build file name"},"sha256":{"type":"string","description":"hash of the bytes received"},"bytes":{"type":"integer","description":"size"}},"required":[]},"args":{"type":"string","description":"arguments"},"state":{"type":"string","description":"the loader's run state","enum":["queued","sending","running","done","crashed","timeout","reset","lost","refused"]},"times":{"type":"object","description":"seconds: push_s, run_s, report_s, total_s"},"way_back":{"type":"string","description":"stub, watchdog or power"},"queued_at":{"type":"string","description":"ISO time"},"ended_at":{"type":"string","description":"ISO time"},"by":{"type":"string","description":"who sent it"},"device":{"type":"string","description":"device it ran on"},"tier":{"type":"string","description":"console, flycast or mock"},"summary":{"type":"object","properties":{"exit":{"description":"exit code (integer), null while running"},"state":{"type":"string","description":"run state"},"seconds":{"type":"number","description":"run time"},"pictures":{"type":"integer","description":"pictures drawn"},"tier":{"type":"string","description":"console, flycast or mock"},"numbers":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string","description":"name"},"value":{"type":"number","description":"value"},"unit":{"type":"string","description":"unit"},"tier":{"type":"string","description":"tier"}},"required":[]}},"notes":{"type":"array","items":{"type":"string","description":"note"}},"crash":{"type":"object","description":"crash: event, pc, pr, sp"}},"required":[]},"crash":{"type":"object","description":"crash: event, pc, pr, sp"},"error":{"type":"string","description":"why it did not run or come back"},"stills":{"type":"array","items":{"type":"string","description":"still id"}},"report":{"type":"string","description":"the report text (get_run)"}},"required":["id","program","state","tier"]}
```

### `get_run`: Get a run

Level: read. Bridge: `GET /v0/runs/<id> (or GET /v0/runs for the list)`.

Input:
```json
{
 "type": "object",
 "properties": {
  "id": {
   "type": "string",
   "description": "run id; omit for the list"
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"runs":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"run id (opaque)"},"program":{"type":"object","properties":{"name":{"type":"string","description":"build file name"},"sha256":{"type":"string","description":"hash of the bytes received"},"bytes":{"type":"integer","description":"size"}},"required":[]},"args":{"type":"string","description":"arguments"},"state":{"type":"string","description":"the loader's run state","enum":["queued","sending","running","done","crashed","timeout","reset","lost","refused"]},"times":{"type":"object","description":"seconds: push_s, run_s, report_s, total_s"},"way_back":{"type":"string","description":"stub, watchdog or power"},"queued_at":{"type":"string","description":"ISO time"},"ended_at":{"type":"string","description":"ISO time"},"by":{"type":"string","description":"who sent it"},"device":{"type":"string","description":"device it ran on"},"tier":{"type":"string","description":"console, flycast or mock"},"summary":{"type":"object","properties":{"exit":{"description":"exit code (integer), null while running"},"state":{"type":"string","description":"run state"},"seconds":{"type":"number","description":"run time"},"pictures":{"type":"integer","description":"pictures drawn"},"tier":{"type":"string","description":"console, flycast or mock"},"numbers":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string","description":"name"},"value":{"type":"number","description":"value"},"unit":{"type":"string","description":"unit"},"tier":{"type":"string","description":"tier"}},"required":[]}},"notes":{"type":"array","items":{"type":"string","description":"note"}},"crash":{"type":"object","description":"crash: event, pc, pr, sp"}},"required":[]},"crash":{"type":"object","description":"crash: event, pc, pr, sp"},"error":{"type":"string","description":"why it did not run or come back"},"stills":{"type":"array","items":{"type":"string","description":"still id"}},"report":{"type":"string","description":"the report text (get_run)"}},"required":["id","program","state","tier"]}}},"required":["runs"]}
```

### `self_test`: Run the self test

Level: run code. Bridge: `POST /v0/selftest`.

Input:
```json
{
 "type": "object",
 "properties": {
  "timeout_s": {
   "type": "integer",
   "description": "seconds to wait (default 30)",
   "minimum": 1,
   "maximum": 300
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"id":{"type":"string","description":"run id (opaque)"},"program":{"type":"object","properties":{"name":{"type":"string","description":"build file name"},"sha256":{"type":"string","description":"hash of the bytes received"},"bytes":{"type":"integer","description":"size"}},"required":[]},"args":{"type":"string","description":"arguments"},"state":{"type":"string","description":"the loader's run state","enum":["queued","sending","running","done","crashed","timeout","reset","lost","refused"]},"times":{"type":"object","description":"seconds: push_s, run_s, report_s, total_s"},"way_back":{"type":"string","description":"stub, watchdog or power"},"queued_at":{"type":"string","description":"ISO time"},"ended_at":{"type":"string","description":"ISO time"},"by":{"type":"string","description":"who sent it"},"device":{"type":"string","description":"device it ran on"},"tier":{"type":"string","description":"console, flycast or mock"},"summary":{"type":"object","properties":{"exit":{"description":"exit code (integer), null while running"},"state":{"type":"string","description":"run state"},"seconds":{"type":"number","description":"run time"},"pictures":{"type":"integer","description":"pictures drawn"},"tier":{"type":"string","description":"console, flycast or mock"},"numbers":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string","description":"name"},"value":{"type":"number","description":"value"},"unit":{"type":"string","description":"unit"},"tier":{"type":"string","description":"tier"}},"required":[]}},"notes":{"type":"array","items":{"type":"string","description":"note"}},"crash":{"type":"object","description":"crash: event, pc, pr, sp"}},"required":[]},"crash":{"type":"object","description":"crash: event, pc, pr, sp"},"error":{"type":"string","description":"why it did not run or come back"},"stills":{"type":"array","items":{"type":"string","description":"still id"}},"report":{"type":"string","description":"the report text (get_run)"}},"required":["id","program","state","tier"]}
```

### `grab_screen`: Grab the screen

Level: control. Bridge: `POST /v0/stills, then GET /v0/stills/<id>`. Answers with a PNG image block as well.

Input:
```json
{
 "type": "object",
 "properties": {},
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"n":{"type":"integer","description":"picture number"},"w":{"type":"integer","description":"width"},"h":{"type":"integer","description":"height"},"label":{"type":"string","description":"what it is"},"bytes":{"type":"integer","description":"PNG size"},"id":{"type":"string","description":"still id"},"tier":{"type":"string","description":"console, flycast or mock"}},"required":["n","w","h"]}
```

### `live_summary`: Live summary

Level: read. Bridge: `GET /v0/summary`.

Input:
```json
{
 "type": "object",
 "properties": {},
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"session":{"type":"string","description":"session id"},"label":{"type":"string","description":"session label"},"device":{"type":"string","description":"device"},"tier":{"type":"string","description":"what kind of numbers these are"},"pictures":{"type":"integer","description":"pictures so far"},"measured":{"type":"integer","description":"pictures in the measured window"},"missing":{"type":"integer","description":"pictures never received (gaps)"},"phases":{"type":"array","items":{"type":"object","description":"phase: key, label, budget, mean, p95, worst, worstAt, over"}},"guards":{"type":"array","items":{"type":"object","description":"guard: key, name, value"}}},"required":["session","tier","phases"]}
```

### `slowest_pictures`: Slowest pictures

Level: read. Bridge: `GET /v0/summary?slowest=<count>`.

Input:
```json
{
 "type": "object",
 "properties": {
  "count": {
   "type": "integer",
   "description": "how many (default 10)",
   "minimum": 1,
   "maximum": 50
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"tier":{"type":"string","description":"tier"},"slowest":{"type":"array","items":{"type":"object","description":"picture: n, total, phases"}}},"required":["slowest"]}
```

### `query_trace`: Query the trace

Level: read. Bridge: `GET /v0/trace`.

Input:
```json
{
 "type": "object",
 "properties": {
  "from": {
   "type": "integer",
   "description": "first picture (default 0)",
   "minimum": 0
  },
  "to": {
   "type": "integer",
   "description": "last picture (default: newest)",
   "minimum": 0
  },
  "limit": {
   "type": "integer",
   "description": "most items to return (default 500)",
   "minimum": 1,
   "maximum": 5000
  },
  "lane": {
   "type": "string",
   "description": "lane name, e.g. \"Loads\""
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"from":{"type":"integer","description":"from"},"to":{"type":"integer","description":"to"},"events":{"type":"array","items":{"type":"object","description":"event: lane, n, d, label"}},"truncated":{"type":"boolean"}},"required":["events"]}
```

### `read_log`: Read the log

Level: read. Bridge: `GET /v0/log`.

Input:
```json
{
 "type": "object",
 "properties": {
  "from": {
   "type": "integer",
   "description": "first picture (default 0)",
   "minimum": 0
  },
  "to": {
   "type": "integer",
   "description": "last picture (default: newest)",
   "minimum": 0
  },
  "limit": {
   "type": "integer",
   "description": "most items to return (default 500)",
   "minimum": 1,
   "maximum": 5000
  },
  "level": {
   "type": "string",
   "description": "only this level (\"warn\" includes errors)",
   "enum": [
    "info",
    "warn",
    "err",
    "stub"
   ]
  },
  "q": {
   "type": "string",
   "description": "text to find"
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"from":{"type":"integer","description":"from"},"to":{"type":"integer","description":"to"},"lines":{"type":"array","items":{"type":"object","description":"line: n, lv, msg"}},"truncated":{"type":"boolean"}},"required":["lines"]}
```

### `list_presets`: List warp presets and test options

Level: read. Bridge: `GET /v0/presets`.

Input:
```json
{
 "type": "object",
 "properties": {},
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"program":{"type":"string","description":"program"},"presets":{"type":"array","items":{"type":"object","description":"preset: id, label, group, detail"}},"options":{"type":"array","items":{"type":"object","description":"option: name, label, type, values, value"}},"scripts":{"type":"array","items":{"type":"object","description":"pad script: name, text"}}},"required":["presets","options"]}
```

### `warp`: Warp

Level: control. Bridge: `POST /v0/command {cmd: warp}`.

Input:
```json
{
 "type": "object",
 "properties": {
  "preset": {
   "type": "string",
   "description": "preset id"
  }
 },
 "required": [
  "preset"
 ],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"ok":{"type":"boolean"},"id":{"type":"string","description":"command id"},"n":{"type":"integer","description":"picture the command took effect at"},"error":{"type":"string","description":"why it failed"}},"required":["ok","id"]}
```

### `pause`: Pause

Level: control. Bridge: `POST /v0/command {cmd: pause}`.

Input:
```json
{
 "type": "object",
 "properties": {},
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"ok":{"type":"boolean"},"id":{"type":"string","description":"command id"},"n":{"type":"integer","description":"picture the command took effect at"},"error":{"type":"string","description":"why it failed"}},"required":["ok","id"]}
```

### `resume`: Resume

Level: control. Bridge: `POST /v0/command {cmd: resume}`.

Input:
```json
{
 "type": "object",
 "properties": {},
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"ok":{"type":"boolean"},"id":{"type":"string","description":"command id"},"n":{"type":"integer","description":"picture the command took effect at"},"error":{"type":"string","description":"why it failed"}},"required":["ok","id"]}
```

### `step`: Step pictures

Level: control. Bridge: `POST /v0/command {cmd: step}`.

Input:
```json
{
 "type": "object",
 "properties": {
  "count": {
   "type": "integer",
   "description": "pictures (default 1)",
   "minimum": 1,
   "maximum": 600
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"ok":{"type":"boolean"},"id":{"type":"string","description":"command id"},"n":{"type":"integer","description":"picture the command took effect at"},"error":{"type":"string","description":"why it failed"}},"required":["ok","id"]}
```

### `set_option`: Set a test option

Level: control. Bridge: `POST /v0/command {cmd: option}`.

Input:
```json
{
 "type": "object",
 "properties": {
  "name": {
   "type": "string",
   "description": "option name"
  },
  "value": {
   "description": "new value: boolean, integer or one of its values"
  }
 },
 "required": [
  "name",
  "value"
 ],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"ok":{"type":"boolean"},"id":{"type":"string","description":"command id"},"n":{"type":"integer","description":"picture the command took effect at"},"error":{"type":"string","description":"why it failed"}},"required":["ok","id"]}
```

### `send_pad`: Send pad input

Level: control. Bridge: `POST /v0/command {cmd: pad}`.

Input:
```json
{
 "type": "object",
 "properties": {
  "state": {
   "type": "object",
   "properties": {
    "buttons": {
     "type": "array",
     "items": {
      "type": "string",
      "description": "button",
      "enum": [
       "A",
       "B",
       "X",
       "Y",
       "START",
       "UP",
       "DOWN",
       "LEFT",
       "RIGHT"
      ]
     }
    },
    "stick": {
     "type": "array",
     "items": {
      "type": "number",
      "minimum": -1,
      "maximum": 1
     },
     "description": "analogue stick x, y from -1 to 1"
    },
    "lt": {
     "type": "number",
     "minimum": 0,
     "maximum": 1,
     "description": "left trigger 0..1"
    },
    "rt": {
     "type": "number",
     "minimum": 0,
     "maximum": 1,
     "description": "right trigger 0..1"
    }
   },
   "required": [
    "buttons"
   ],
   "additionalProperties": false
  },
  "steps": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "buttons": {
      "type": "array",
      "items": {
       "type": "string",
       "description": "button",
       "enum": [
        "A",
        "B",
        "X",
        "Y",
        "START",
        "UP",
        "DOWN",
        "LEFT",
        "RIGHT"
       ]
      }
     },
     "stick": {
      "type": "array",
      "items": {
       "type": "number",
       "minimum": -1,
       "maximum": 1
      },
      "description": "analogue stick x, y from -1 to 1"
     },
     "lt": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "left trigger 0..1"
     },
     "rt": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "right trigger 0..1"
     },
     "frames": {
      "type": "integer",
      "description": "pictures to hold this step",
      "minimum": 1,
      "maximum": 3600
     }
    },
    "required": [
     "buttons",
     "frames"
    ],
    "additionalProperties": false
   }
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"ok":{"type":"boolean"},"id":{"type":"string","description":"command id"},"n":{"type":"integer","description":"picture the command took effect at"},"error":{"type":"string","description":"why it failed"}},"required":["ok","id"]}
```

### `reset`: Reset

Level: control. Bridge: `POST /v0/command {cmd: reset}`.

Input:
```json
{
 "type": "object",
 "properties": {
  "level": {
   "type": "string",
   "description": "reset ladder step",
   "enum": [
    "return",
    "watchdog",
    "power"
   ]
  }
 },
 "required": [
  "level"
 ],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"ok":{"type":"boolean"},"id":{"type":"string","description":"command id"},"n":{"type":"integer","description":"picture the command took effect at"},"error":{"type":"string","description":"why it failed"}},"required":["ok","id"]}
```

### `read_memory`: Read memory

Level: read. Bridge: `POST /v0/memory/read`.

Input:
```json
{
 "type": "object",
 "properties": {
  "addr": {
   "type": "string",
   "description": "address in hex, e.g. \"8C010000\"",
   "pattern": "^(0x)?[0-9A-Fa-f]+$"
  },
  "len": {
   "type": "integer",
   "description": "bytes",
   "minimum": 1,
   "maximum": 65536
  }
 },
 "required": [
  "addr",
  "len"
 ],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"addr":{"type":"integer","description":"address"},"data":{"type":"string","description":"base64"},"n":{"type":"integer","description":"picture"}},"required":["addr","data","n"]}
```

### `upload_asset`: Upload an asset

Level: control. Bridge: `POST /v0/assets`.

Input:
```json
{
 "type": "object",
 "properties": {
  "path": {
   "type": "string",
   "description": "path on the bridge's PC"
  },
  "base64": {
   "type": "string",
   "description": "the bytes, base64"
  },
  "name": {
   "type": "string",
   "description": "file name"
  }
 },
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"name":{"type":"string","description":"name"},"bytes":{"type":"integer","description":"size"},"sha256":{"type":"string","description":"hash"},"state":{"type":"string","description":"sent or refused","enum":["sent","refused"]},"reason":{"type":"string","description":"why"},"ram":{"type":"integer","description":"main memory bytes"},"vram":{"type":"integer","description":"graphics memory bytes"}},"required":["name","state"]}
```

### `list_sessions`: List sessions

Level: read. Bridge: `GET /v0/sessions`.

Input:
```json
{
 "type": "object",
 "properties": {},
 "required": [],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"sessions":{"type":"array","items":{"type":"object","description":"session summary"}}},"required":["sessions"]}
```

### `export_session`: Export a session

Level: read. Bridge: `GET /v0/sessions/<id>`.

Input:
```json
{
 "type": "object",
 "properties": {
  "id": {
   "type": "string",
   "description": "session id"
  },
  "max_bytes": {
   "type": "integer",
   "description": "most bytes to return (default 1,000,000)",
   "minimum": 1000,
   "maximum": 20000000
  }
 },
 "required": [
  "id"
 ],
 "additionalProperties": false
}
```
Output:
```json
{"type":"object","properties":{"id":{"type":"string","description":"id"},"bytes":{"type":"integer","description":"full size"},"truncated":{"type":"boolean"},"text":{"type":"string","description":"the session file"}},"required":["id","text","truncated"]}
```
