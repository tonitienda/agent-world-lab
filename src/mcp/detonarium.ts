// Detonarium MCP server: one match between the connected agent (player 0) and CPU bots.
// The arena is frozen while the agent thinks; it only advances inside move_to, place_bomb,
// wait and step. Game logic lives in src/detonarium/session.ts.
// Env: DETONARIUM_SEED, DETONARIUM_BOTS (comma separated kinds, default hunter,hunter,hunter),
// DETONARIUM_ALERT_RADIUS, DETONARIUM_MAX_MACRO_TICKS, AGENT_ID, AGENT_LABEL, SESSION_LOG_DIR.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";
import { renameSync, writeFileSync } from "node:fs";
import type { BotKind } from "../../packages/detonarium/src/index.js";
import { DetonariumSession, type MacroResult } from "../detonarium/session.js";
import { SessionEvents } from "./session-events.js";

const seed = Number(process.env.DETONARIUM_SEED ?? 1);
const bots = (process.env.DETONARIUM_BOTS ?? "hunter,hunter,hunter").split(",").map((k) => k.trim()) as BotKind[];
const sessionFolder = process.env.SESSION_LOG_DIR
  ? resolve(process.env.SESSION_LOG_DIR)
  : resolve(import.meta.dirname, "../../data/detonarium-sessions", `${Date.now()}-${process.pid}`);

const events = new SessionEvents(sessionFolder);
const session = new DetonariumSession({
  seed,
  bots,
  agentName: process.env.AGENT_LABEL ?? "Claude",
  alertRadius: process.env.DETONARIUM_ALERT_RADIUS ? Number(process.env.DETONARIUM_ALERT_RADIUS) : undefined,
  maxMacroTicks: process.env.DETONARIUM_MAX_MACRO_TICKS ? Number(process.env.DETONARIUM_MAX_MACRO_TICKS) : undefined,
});
let finished = false;

function response(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

function save() {
  for (const [name, data] of [["replay.json", session.replay], ["calls.json", session.calls]] as const) {
    const file = resolve(sessionFolder, name);
    writeFileSync(file + ".tmp", JSON.stringify(data, null, 2) + "\n");
    renameSync(file + ".tmp", file);
  }
}

function record(tool: string, args: Record<string, unknown>, result: MacroResult) {
  const { view, ...rest } = result;
  events.add(tool, { ...args, ...rest, tick: view.tick, pos: view.you.pos });
  // Once the agent is out, the bots play on so the replay ends with a real result.
  if (!session.agentAlive && !session.state.over) {
    session.finishWithoutAgent();
    events.add("match_finished_without_agent", { tick: session.state.tick, result: session.result() });
  }
  save();
  return response({ ...result, view: session.observe() });
}

const intention = z.string().max(200).describe("Short action label for the log; may include coordinates. Not the spoken narration.");
const rationale = z.string().max(600).optional().describe(
  "Optional concise technical summary of the plan, threat or correction. Coordinates and fuse timing belong here, not in narration. This is not voiceover or private reasoning.");
const narration = z.string().min(3).max(300).describe(
  "Human-friendly spoken commentary in first person, supplied before the action. Usually 3–8 words for a routine action, or one short sentence for a plan or correction. " +
  "Use plain conversational language. No coordinates, row/column numbers, tick arithmetic, tool names or tactical lists. Describe the visible aim or risk; do not claim an outcome before it happens. " +
  "Example: I'll block the passage, then get around the corner before it blows.");
const gameOver = () => (finished || session.state.over || !session.agentAlive);
const overResponse = () => response({ ok: false, message: "The match is over for you", result: session.result(), view: session.observe() });

const server = new McpServer({ name: "agent-world-detonarium", version: "0.1.0" });

server.registerTool(
  "observe",
  { description: "Look at the whole arena. Your own upgrades are shown; rival upgrade totals and enemy bomb ranges are hidden. Infer them from observed pickups and explosions. Time does not pass while you look or think: the arena only moves during move_to, place_bomb, wait and step." },
  async () => {
    events.add("observe", { tick: session.state.tick });
    return response(session.observe());
  },
);

server.registerTool(
  "move_to",
  {
    description:
      "Walk toward a cell, one cell per tick, taking the shortest path around walls, crates, bombs, flames and players. " +
      "It does not avoid future explosions: that is up to you. Stops when you arrive, when the path is blocked, after max_ticks, " +
      "or early when a rival places a bomb near you. Rivals keep acting every tick.",
    inputSchema: {
      x: z.number().int().describe("Target column"),
      y: z.number().int().describe("Target row"),
      max_ticks: z.number().int().min(1).optional().describe("Stop after this many ticks even if not arrived"),
      intention,
      rationale,
      narration,
    },
  },
  async ({ x, y, max_ticks, intention, rationale, narration }) => {
    if (gameOver()) return overResponse();
    return record("move_to", { x, y, max_ticks, intention, rationale, narration }, session.moveTo({ x, y }, intention, max_ticks, rationale, narration));
  },
);

server.registerTool(
  "place_bomb",
  { description: "Drop a bomb on your cell. Takes one tick. Refused if all your bombs are already ticking.", inputSchema: { intention, rationale, narration } },
  async ({ intention, rationale, narration }) => {
    if (gameOver()) return overResponse();
    return record("place_bomb", { intention, rationale, narration }, session.placeBomb(intention, rationale, narration));
  },
);

server.registerTool(
  "wait",
  {
    description: "Stay where you are for a number of ticks. Stops early if a rival places a bomb near you.",
    inputSchema: { ticks: z.number().int().min(1).describe("How many ticks to wait"), intention, rationale, narration },
  },
  async ({ ticks, intention, rationale, narration }) => {
    if (gameOver()) return overResponse();
    return record("wait", { ticks, intention, rationale, narration }, session.wait(ticks, intention, rationale, narration));
  },
);

server.registerTool(
  "step",
  {
    description: "Take exactly one tick with one action: stay, up, down, left, right or bomb. Up is toward row 0.",
    inputSchema: { action: z.enum(["stay", "up", "down", "left", "right", "bomb"]), intention, rationale, narration },
  },
  async ({ action, intention, rationale, narration }) => {
    if (gameOver()) return overResponse();
    return record("step", { action, intention, rationale, narration }, session.stepOnce(action, intention, rationale, narration));
  },
);

server.registerTool(
  "finish_session",
  { description: "End the session and save the match record. Call once the match is over for you, or if you cannot continue." },
  async () => {
    finished = true;
    if (!session.state.over) session.finishWithoutAgent();
    events.add("session_finish", { result: session.result(), ticks: session.state.tick, calls: session.calls.length });
    save();
    setTimeout(() => process.exit(0), 350).unref();
    return response({ ok: true, result: session.result(), folder: sessionFolder });
  },
);

async function main() {
  events.add("detonarium_configuration", { seed, bots, rules: session.state.rules });
  save();
  await server.connect(new StdioServerTransport());
  process.stderr.write(`Detonarium MCP ready: seed ${seed}, ${session.names.join(" vs ")}; logging to ${sessionFolder}\n`);
}

main().catch((error) => {
  process.stderr.write(`Detonarium MCP failed: ${String(error)}\n`);
  process.exit(1);
});
