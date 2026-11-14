import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {toolDefinitions} from '../../packages/openttd/src/session.js';

import {freightTools} from '../../packages/openttd/src/freight-session.js';

const endpoint = process.env.OPENTTD_SESSION_URL;
const token = process.env.OPENTTD_SESSION_TOKEN;
if (!endpoint?.startsWith('http://127.0.0.1:') || !token) throw new Error('A local trusted OpenTTD session is required');
const server = new McpServer({name: 'agent-world-openttd', version: '0.1.0'});
for (const [name, definition] of Object.entries(process.env.OPENTTD_SCENARIO === 'freight' ? freightTools : toolDefinitions)) {
  server.registerTool(name, {description: definition.description, inputSchema: definition.schema.shape as any}, async (args: any) => {
    const result = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
      body: JSON.stringify({tool: name, args}), signal: AbortSignal.timeout(150_000)});
    if (!result.ok) throw new Error(`Session request failed: HTTP ${result.status}`);
    const data = await result.json();
    return {content: [{type: 'text' as const, text: JSON.stringify(data, null, 2)}]};
  });
}
await server.connect(new StdioServerTransport());
