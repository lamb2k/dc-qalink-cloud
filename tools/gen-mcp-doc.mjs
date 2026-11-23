// Writes docs/MCP_TOOLS.md from src/data/mcp-tools.ts (the one source). `--check` fails when the file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MCP_TOOLS, MCP_TOOLS_VERSION, MCP_BRIDGE_API } from '../src/data/mcp-tools.ts';

const out = fileURLToPath(new URL('../docs/MCP_TOOLS.md', import.meta.url));
const props = (s) => Object.entries(s.properties ?? {}).map(([k, v]) => `\`${k}\`${(s.required ?? []).includes(k) ? '' : '?'}`).join(', ') || 'none';
const level = { read: 'read', control: 'control', run: 'run code' };
let md = `# MCP tool list, version ${MCP_TOOLS_VERSION} (bridge API ${MCP_BRIDGE_API})

Generated from \`src/data/mcp-tools.ts\` by \`node tools/gen-mcp-doc.mjs\`; do not edit by hand. The TypeScript file is
the source: it holds every tool's name, purpose, permission level, the bridge API call it maps to, and its inputs and
outputs as JSON Schema. It moves to dc-qalink beside the bridge API when the bridge implements it.

**Who serves it**
- \`tools/mock-mcp.mjs\` (this repository): the reference, over the mock bridge, with the official TypeScript MCP SDK
  on stdio. \`tests/mcp.test.ts\` lists the tools and calls \`grab_screen\`, \`live_summary\` and \`push_build\`.
- The bridge (Python, dc-qalink): the same list with the Python MCP SDK, on stdio and a local HTTP port. It loads
  the list from a JSON export of this file (\`node tools/gen-mcp-doc.mjs --json\`), so names and schemas cannot drift.
- DC QA Link Cloud (L3b): the same list over HTTP with sign-in, each call through the job queue.

**Permission levels.** A server is started at one level and lists and accepts only the tools at or below it:
read (data, sessions), control (warp, pause, step, pad, grab, reset, assets), run code (push and run a build).
Every call is logged with who made it. Arguments are checked against the input schema before the bridge is called.

**Use it from Claude Code on this PC:** \`claude mcp add qalink -- node <qalink-cloud>/tools/mock-mcp.mjs --level control\`
(the desktop app's Settings, Agents, shows the exact line for the installed app).

| Tool | Level | What it is for | Inputs | Bridge call |
|---|---|---|---|---|
${MCP_TOOLS.map((t) => `| \`${t.name}\` | ${level[t.level]} | ${t.description.replace(/\|/g, '\\|')} | ${props(t.inputSchema)} | \`${t.bridge}\` |`).join('\n')}

## Schemas

${MCP_TOOLS.map((t) => `### \`${t.name}\`: ${t.title}\n\nLevel: ${level[t.level]}. Bridge: \`${t.bridge}\`.${t.image ? ' Answers with a PNG image block as well.' : ''}\n\nInput:\n\`\`\`json\n${JSON.stringify(t.inputSchema, null, 1)}\n\`\`\`\nOutput:\n\`\`\`json\n${JSON.stringify(t.outputSchema)}\n\`\`\``).join('\n\n')}
`;
if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify({ version: MCP_TOOLS_VERSION, bridgeApi: MCP_BRIDGE_API, tools: MCP_TOOLS }, null, 1)); process.exit(0); }
if (process.argv.includes('--check')) { const cur = readFileSync(out, 'utf8'); if (cur !== md) { console.error('docs/MCP_TOOLS.md is stale: run node tools/gen-mcp-doc.mjs'); process.exit(1); } console.log('docs/MCP_TOOLS.md is current'); process.exit(0); }
writeFileSync(out, md); console.log(`docs/MCP_TOOLS.md: ${MCP_TOOLS.length} tools`);
