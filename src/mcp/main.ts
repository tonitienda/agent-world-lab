import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { createWorld } from "../environments/index.js";
import { requireCapability } from "../core/types.js";
import { SessionEvents } from "./session-events.js";

const world = createWorld();
const server = new McpServer({ name: "agent-world-lab", version: "0.1.0" });
const destination = process.env.RECORD_MP4 ? resolve(process.env.RECORD_MP4) : undefined;
const events = destination ? new SessionEvents(dirname(destination)) : undefined;
let isStopping = false;
let inFlight = 0;
let shuttingDown: Promise<void> | undefined;

function response(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}
async function invoke(action: string, args: Record<string, unknown>, fn: () => Promise<unknown>) {
  if (isStopping) return response({ok: false, message: "Session is stopping; no more actions accepted"});
  ++inFlight;
  events?.add(action + "_start", {args});
  try {
    const result = await fn();
    events?.add(action, {args, result});
    return response(result);
  } catch (error) {
    events?.add(action + "_error", {args, error: String(error)});
    throw error;
  } finally {
    --inFlight;
  }
}
function action(name: string, args: Record<string, unknown> = {}) {
  // Intent is a public first-person comment by the agent, not private reasoning.
  // Record it BEFORE executing the action so the editing timeline can align it.
  const {intent, ...worldArgs} = args;
  if (typeof intent === "string") {
    events?.add("report_intention", {args: {summary: intent, action: name}});
  }
  return invoke(name, worldArgs, () => world.act(name, worldArgs));
}
const intent = z.string().min(3).max(300).describe("One short first-person sentence about what you are trying to do and why, for public narration. Avoid generic action descriptions.");

server.registerTool("world_info", {description: "Discover the active world and available actions"}, () =>
  invoke("world_info", {}, async () => ({world: world.id, actions: world.capabilities})));
server.registerTool("observe", {description: "Observe the agent's immediate surroundings"}, () =>
  invoke("observe", {}, () => world.observe()));
server.registerTool("inventory", {description: "Inspect carried items"}, () => action("inventory"));
server.registerTool("move_to", {description: "Move to nearby coordinates (maximum 24 blocks per request)", inputSchema: {x: z.number().int(), y: z.number().int(), z: z.number().int(), intent}}, args => {
  requireCapability(world, "move_to");
  return action("move_to", args);
});
server.registerTool("mine", {description: "Dig a reachable block", inputSchema: {x: z.number().int(), y: z.number().int(), z: z.number().int(), intent}}, args => {
  requireCapability(world, "mine");
  return action("mine", args);
});
server.registerTool("place", {description: "Place an inventory block at an empty target", inputSchema: {x: z.number().int(), y: z.number().int(), z: z.number().int(), item: z.string(), intent}}, args => {
  requireCapability(world, "place");
  return action("place", args);
});
server.registerTool("report_intention", {description: "State your current goal or short plan for the episode documentary. This records your stated intention, not private reasoning.", inputSchema: {summary: z.string().min(1).max(300)}}, async ({summary}) => {
  return invoke("report_intention", {summary}, async () => ({ok: true, message: "Intention logged", summary}));
});
server.registerTool("say", {description: "Send a local Minecraft chat message", inputSchema: {message: z.string().min(1).max(200)}}, args => {
  requireCapability(world, "say");
  return action("say", args);
});

async function shutdown(reason: string) {
  if (shuttingDown) return shuttingDown;
  isStopping = true;
  shuttingDown = (async () => {
    // Allow already-started MCP actions to finish before finalizing the footage.
    const deadline = Date.now() + 35_000;
    while (inFlight && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 100));
    events?.add("session_end", {reason, pendingActions: inFlight});
    try { await world.close(); }
    catch (error) {
      events?.add("recorder_error", String(error));
      process.exitCode = 1;
      throw error;
    } finally {
      if (destination) {
        writeFileSync(resolve(dirname(destination), "mcp-session.json"),
          JSON.stringify({source: "mcp", agent: process.env.AGENT_ID ?? "explorer-1", events: "events.json", cameras: ["agent-pov.mp4", "observer.mp4"], finishedAt: new Date().toISOString()}, null, 2) + "\n");
      }
    }
  })();
  return shuttingDown;
}
server.registerTool("finish_session", {description: "End this agent experiment and finalize both camera recordings plus events.json. Call when your task is complete."}, async () => {
  try {
    await shutdown("agent_finished");
    // Permit MCP transport to flush its final tool response.
    setTimeout(() => process.exit(process.exitCode ?? 0), 350).unref();
    return response({ok: true, message: "Session finalized; both camera files and events.json saved", folder: destination ? dirname(destination) : null});
  } catch (error) {
    return response({ok: false, message: String(error)});
  }
});

async function main() {
  await world.connect();
  // Audit the starting state: mining a block does not guarantee its drop was collected.
  // This makes a stale player inventory visible in the session record immediately.
  const initialInventory = await world.act("inventory", {});
  events?.add("inventory_initial", {result: initialInventory});
  events?.add("recording_ready", {output: destination});
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`Connected to ${world.id} as ${process.env.AGENT_ID ?? "explorer-1"}; recording: ${destination ?? "disabled"}\n`);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => { void shutdown(signal).then(() => process.exit(process.exitCode ?? 0), error => {process.stderr.write(String(error)); process.exit(1);}); });
main().catch(error => { events?.add("startup_error", String(error)); process.stderr.write(`MCP startup failed: ${String(error)}\n`); process.exitCode = 1; });
