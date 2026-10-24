import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createWorld } from "../environments/index.js";
import { requireCapability } from "../core/types.js";

const world = createWorld();
const server = new McpServer({ name: "agent-world-lab", version: "0.1.0" });

function response(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}
server.registerTool("world_info", { description: "Discover the active world and available actions" }, async () =>
  response({ world: world.id, actions: world.capabilities }));
server.registerTool("observe", { description: "Observe the agent's immediate surroundings" }, async () =>
  response(await world.observe()));
server.registerTool("inventory", { description: "Inspect carried items" }, async () =>
  response(await world.act("inventory", {})));
server.registerTool("move_to", { description: "Move to nearby coordinates (maximum 24 blocks per request)", inputSchema: { x: z.number().int(), y: z.number().int(), z: z.number().int() } }, async args => {
  requireCapability(world, "move_to");
  return response(await world.act("move_to", args));
});
server.registerTool("mine", { description: "Dig a reachable block", inputSchema: { x: z.number().int(), y: z.number().int(), z: z.number().int() } }, async args => {
  requireCapability(world, "mine");
  return response(await world.act("mine", args));
});
server.registerTool("place", { description: "Place an inventory block at an empty target", inputSchema: { x: z.number().int(), y: z.number().int(), z: z.number().int(), item: z.string() } }, async args => {
  requireCapability(world, "place");
  return response(await world.act("place", args));
});
server.registerTool("say", { description: "Send a local Minecraft chat message", inputSchema: { message: z.string().min(1).max(200) } }, async args => {
  requireCapability(world, "say");
  return response(await world.act("say", args));
});

async function main() {
  await world.connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`Connected to ${world.id} as ${process.env.AGENT_ID ?? "explorer-1"}\n`);
}
async function shutdown() { await world.close(); process.exit(0); }
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
main().catch(e => { process.stderr.write(`MCP startup failed: ${String(e)}\n`); process.exitCode = 1; });
