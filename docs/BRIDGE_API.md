# The bridge API: contract 1

The source is dc-qalink's `docs/BRIDGE_API.md` (contract 1, branch `v0.2-bridge`); `src/data/bridge-api.ts` matches it.
This app's own 0.2.0 draft (ql-app) is replaced. In short:

- HTTP on `127.0.0.1:52080`, paths under `/v0/`, every answer carries `contract: 1`, the app sends `X-Contract: 1`
  (a bridge of another contract answers 409, shown as "the bridge speaks another contract").
- The live stream is **Server-Sent Events** at `/v0/live` (read with `fetch`, so the browser, the desktop app and Node
  tests share one code path): `hello`, `status`, session-format records with `t` and `s`, run events. A row's event id
  is its picture; a reconnect resumes with `?from=<n>&session=<id>`.
- The bridge speaks the loader's words; `bridge-api.ts` maps them (`uiLink`, `uiRun`, `uiDevice`, `uiDiscovery`,
  `uiSession`): link `up` shows as Linked, run `done` with exit 0 as Passed, `sending` as Pushing, `timeout` / `reset` /
  `lost` / `refused` as Failed with the bridge's word in the notes.
- Push is multipart (`program`, `sha256`, `name`, `args`) through `pushProgram`; the bridge refuses a hash mismatch.
- Grab now is `POST /v0/stills` then the PNG at `/v0/stills/<id>`; the app keeps the picture inline so the pixel
  inspector can read it.
- `/v0/command` answers 501 for what the loader or program cannot do yet; the app says "not in this loader yet".
- Every number carries a tier: `console`, `flycast` or `mock`.

The mock bridge (`tools/mock-bridge.mjs`) speaks the same contract with tier `mock`, for demo mode and the tests;
`tests/real-bridge.test.ts` runs the app's data layer against dc-qalink's real bridge and its simulated console
(`QALINK_DCQALINK=<dc-qalink checkout>`).
