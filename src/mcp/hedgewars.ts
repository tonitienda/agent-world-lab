// MCP adapter for one Hedgewars team. It holds no game logic: every tool call is
// forwarded to the local session started by scripts/hedgewars-session.ts, and the
// token decides which team this process plays for.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {toolDefinitions} from '../../packages/hedgewars/src/tools.js';

const endpoint = process.env.HEDGEWARS_SESSION_URL;
const token = process.env.HEDGEWARS_SESSION_TOKEN;
if (!endpoint?.startsWith('http://127.0.0.1:') || !token) throw new Error('A local trusted Hedgewars session is required');
const server = new McpServer({name: 'agent-world-hedgewars', version: '0.1.0'});
for (const [name, definition] of Object.entries(toolDefinitions)) {
  server.registerTool(name, {description: definition.description, inputSchema: definition.schema.shape as any}, async (args: any) => {
    const result = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
      body: JSON.stringify({tool: name, args}), signal: AbortSignal.timeout(150_000)});
    if (!result.ok) throw new Error(`Session request failed: HTTP ${result.status}`);
    const data = await result.json() as {map?: {rows?: string[]}};
    // The terrain reads far better as a block of text than as a JSON array of strings.
    const map = data.map?.rows?.join('\n');
    if (data.map) delete data.map.rows;
    return {content: [{type: 'text' as const, text: JSON.stringify(data, null, 2)},
      ...(map ? [{type: 'text' as const, text: `Terrain (one character = ${(data.map as any).cell} px, top-left character is at x=${(data.map as any).originX}, y=${(data.map as any).originY}):\n${map}`}] : [])]};
  });
}
await server.connect(new StdioServerTransport());
