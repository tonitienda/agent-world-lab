import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { createWorld } from "../environments/index.js";
import { requireCapability } from "../core/types.js";
import { sessionLockPath } from "../session/lock.js";
import { SessionLifecycle, type SessionOutcome } from "../session/lifecycle.js";
import { readWorldConfig } from "../environments/minecraft/world-config.js";
import { readRavineManifest, verifyRavineStart, type RavineManifest } from "../environments/minecraft/ravine.js";
import { SessionEvents } from "./session-events.js";

const world = createWorld();
const server = new McpServer({ name: "agent-world-lab", version: "0.1.0" });
const destination = process.env.RECORD_MP4
  ? resolve(process.env.RECORD_MP4)
  : undefined;
const sessionFolder = destination
  ? dirname(destination)
  : process.env.SESSION_LOG_DIR
    ? resolve(process.env.SESSION_LOG_DIR)
    : resolve(
        import.meta.dirname,
        "../../data/mcp-sessions",
        `${Date.now()}-${process.pid}`,
      );
const events = new SessionEvents(sessionFolder);
let isStopping = false;
let inFlight = 0;
let finalizedOutcome: SessionOutcome | undefined;
const lifecycle = new SessionLifecycle();
const worldConfig = readWorldConfig(
  resolve(import.meta.dirname, "../../data/minecraft/world-config.json"),
);
let scenario: RavineManifest | undefined;
let controlTimer: ReturnType<typeof setInterval> | undefined;

function response(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}
async function invoke(
  action: string,
  args: Record<string, unknown>,
  fn: () => Promise<unknown>,
) {
  if (isStopping)
    return response({
      ok: false,
      message: "Session is stopping; no more actions accepted",
    });
  ++inFlight;
  events?.add(action + "_start", { args });
  try {
    const result = await fn();
    events?.add(action, { args, result });
    return response(result);
  } catch (error) {
    events?.add(action + "_error", { args, error: String(error) });
    throw error;
  } finally {
    --inFlight;
  }
}
function action(name: string, args: Record<string, unknown> = {}) {
  if (isStopping)
    return Promise.resolve(
      response({ ok: false, message: "Session is stopping" }),
    );
  requireCapability(world, name);
  // Intent is a public first-person comment by the agent, not private reasoning.
  // Record it BEFORE executing the action so the editing timeline can align it.
  const { intent, ...worldArgs } = args;
  if (typeof intent === "string") {
    events?.add("report_intention", {
      args: { summary: intent, action: name },
    });
  }
  return invoke(name, worldArgs, () => world.act(name, worldArgs));
}
const intent = z
  .string()
  .min(3)
  .max(300)
  .describe(
    "Speak naturally to viewers in first person as the Minecraft agent. For routine actions, prefer a very short intention (usually 3–8 words); use a fuller sentence for a new strategy or an observed discovery. Avoid padding repetitive actions, coordinates, API names, task lists and repeated openings such as 'So', 'Okay' or 'I'm going to'. Follow the goal's narration personality; occasional dry humor may fit an actual setback, but most lines should be straightforward. Never invent events or claim success before executing an action. This is public commentary, not private reasoning.",
  );

server.registerTool(
  "world_info",
  { description: "Discover the active world and available actions" },
  () =>
    invoke("world_info", {}, async () => ({
      world: world.id,
      actions: world.capabilities,
      ...(scenario ? { scenario } : {}),
    })),
);
server.registerTool(
  "observe",
  { description: "Observe the agent's immediate surroundings" },
  () => invoke("observe", {}, async () => {
    const observation = await world.observe();
    return scenario ? { ...(observation as Record<string, unknown>), scenario } : observation;
  }),
);
server.registerTool("inventory", { description: "Inspect carried items" }, () =>
  action("inventory"),
);
server.registerTool(
  "survey",
  {
    description: "One-use wider survey of loaded, visible terrain around your current position: horizontal radius 16 blocks, 8 blocks below and 12 above. Returns material groups, visible bounds and sample coordinates, including elevated terrain. Only ONE successful use per session, enforced by the server; observe reports the remaining allowance. Does not reveal hidden blocks, unloaded terrain or solutions. Choose when to spend it.",
    inputSchema: { intent },
  },
  args => action("survey", args),
);
server.registerTool(
  "move_to",
  {
    description: "Move to nearby coordinates (maximum 24 blocks per request)",
    inputSchema: {
      x: z.number().int(),
      y: z.number().int(),
      z: z.number().int(),
      radius: z.number().int().min(0).max(1).optional(),
      intent,
    },
  },
  (args) => {
    requireCapability(world, "move_to");
    return action("move_to", args);
  },
);
server.registerTool(
  "mine",
  {
    description: "Dig a reachable block",
    inputSchema: {
      x: z.number().int(),
      y: z.number().int(),
      z: z.number().int(),
      intent,
    },
  },
  (args) => {
    requireCapability(world, "mine");
    return action("mine", args);
  },
);
server.registerTool(
  "place",
  {
    description: "Place an inventory block at an empty target",
    inputSchema: {
      x: z.number().int(),
      y: z.number().int(),
      z: z.number().int(),
      item: z.string(),
      intent,
    },
  },
  (args) => {
    requireCapability(world, "place");
    return action("place", args);
  },
);
const position = {
  x: z.number().int().min(-30000000).max(30000000),
  y: z.number().int().min(-30000000).max(30000000),
  z: z.number().int().min(-30000000).max(30000000),
};
const item = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9_]+$/);
const count = z.number().int().min(1).max(2304);
server.registerTool(
  "recipes",
  {
    description:
      "Inspect recipes and ingredient counts, including table requirements. Omit item for a bounded recipe list.",
    inputSchema: { item: item.optional() },
  },
  (args) => action("recipes", args),
);
server.registerTool(
  "equipment",
  { description: "Inspect held items and armor" },
  () => action("equipment"),
);
server.registerTool(
  "craft",
  {
    description:
      "Craft an exact output quantity, a multiple of recipe output. Does not collect ingredients or craft intermediates.",
    inputSchema: {
      item,
      count,
      crafting_table_position: z.object(position).optional(),
      intent,
    },
  },
  (args) => action("craft", args),
);
server.registerTool(
  "equip",
  {
    description: "Equip a carried item",
    inputSchema: {
      item,
      slot: z.enum(["hand", "head", "torso", "legs", "feet", "off-hand"]),
      intent,
    },
  },
  (args) => action("equip", args),
);
server.registerTool(
  "drop",
  { description: "Drop carried items", inputSchema: { item, count, intent } },
  (args) => action("drop", args),
);
for (const name of ["interact_block", "open_container"] as const)
  server.registerTool(
    name,
    {
      description:
        name === "open_container"
          ? "Open a reachable chest, furnace or other supported container"
          : "Activate a visible door, gate, button, lever or bell; inspect a crafting table",
      inputSchema: { ...position, intent },
    },
    (args) => action(name, args),
  );
for (const name of ["interact_entity", "attack"] as const)
  server.registerTool(
    name,
    {
      description: "Act on a recently observed visible entity within 3 blocks",
      inputSchema: { entity_id: z.number().int().nonnegative(), intent },
    },
    (args) => action(name, args),
  );
server.registerTool(
  "container",
  {
    description:
      "Inspect open container contents or furnace input, fuel, output and progress",
  },
  () => action("container"),
);
server.registerTool(
  "close_container",
  { description: "Close the current container", inputSchema: { intent } },
  (args) => action("close_container", args),
);
server.registerTool(
  "transfer_item",
  {
    description:
      "Move items between inventory and the open container. Furnaces require input/fuel/output slot.",
    inputSchema: {
      item,
      count,
      direction: z.enum(["deposit", "withdraw"]),
      slot: z.enum(["input", "fuel", "output"]).optional(),
      intent,
    },
  },
  (args) => action("transfer_item", args),
);
for (const name of ["eat", "use_item"] as const)
  server.registerTool(
    name,
    {
      description:
        name === "eat"
          ? "Consume carried food; omit item to choose the first edible stack"
          : "Activate a held item for 500ms; observe to determine effect",
      inputSchema: { item: item.optional(), intent },
    },
    (args) => action(name, args),
  );

server.registerTool(
  "report_intention",
  {
    description:
      "Speak briefly to viewers in first person about your observed situation, current goal or next experiment. Natural spoken commentary, not commands or private reasoning.",
    inputSchema: { summary: z.string().min(1).max(300) },
  },
  async ({ summary }) => {
    return invoke("report_intention", { summary }, async () => ({
      ok: true,
      message: "Intention logged",
      summary,
    }));
  },
);
server.registerTool(
  "say",
  {
    description: "Send a local Minecraft chat message",
    inputSchema: { message: z.string().min(1).max(200) },
  },
  (args) => {
    requireCapability(world, "say");
    return action("say", args);
  },
);

async function shutdown(reason: string, outcome: SessionOutcome = "stopped") {
  isStopping = true;
  return lifecycle.finish(outcome, async () => {
    if (controlTimer) clearInterval(controlTimer);
    // Allow already-started MCP actions to finish before finalizing the footage.
    const deadline = Date.now() + 35_000;
    while (inFlight && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    events?.add("session_finalizing", {
      reason,
      outcome,
      pendingActions: inFlight,
    });
    let finalOutcome: SessionOutcome = inFlight ? "aborted" : outcome;
    try {
      // This observation comes from the adapter, never from agent-authored text.
      try { events.add("objective_observation", { result: await world.observe() }); }
      catch (error) { events.add("objective_observation_error", { error: String(error) }); }
      await world.close();
    } catch (error) {
      finalOutcome = "aborted";
      events?.add("recorder_error", String(error));
      process.exitCode = 1;
      throw error;
    } finally {
      if (finalOutcome === "aborted") process.exitCode = 1;
      finalizedOutcome = finalOutcome;
      events?.add("session_end", {
        reason,
        outcome: finalOutcome,
        pendingActions: inFlight,
      });
      {
        writeFileSync(
          resolve(sessionFolder, "mcp-session.json"),
          JSON.stringify(
            {
              outcome: finalOutcome,
              reason,
              worldConfig,
              ...(scenario ? { scenario } : {}),
              source: "mcp",
              agent: process.env.AGENT_ID ?? "explorer-1",
              events: "events.json",
              cameras: destination ? ["agent-pov.mp4", "observer.mp4", "follow.mp4"] : [],
              finishedAt: new Date().toISOString(),
            },
            null,
            2,
          ) + "\n",
        );
      }
    }
  });
}
server.registerTool(
  "finish_session",
  {
    description:
      "End this agent experiment and finalize all three camera recordings plus events.json. Call when finished, whether the challenge succeeded or failed. The completed outcome describes session finalization, not challenge success.",
  },
  async () => {
    try {
      await shutdown("agent_finished", "completed");
      // Permit MCP transport to flush its final tool response.
      setTimeout(() => process.exit(process.exitCode ?? 0), 350).unref();
      return response({
        ok: true,
        message: destination
          ? "Session finalized; all three camera files (agent-pov.mp4, observer.mp4, follow.mp4) and events.json saved"
          : "Session finalized; events.json saved (recording disabled)",
        outcome: finalizedOutcome,
        folder: sessionFolder,
      });
    } catch (error) {
      return response({ ok: false, message: String(error) });
    }
  },
);

async function main() {
  if (process.env.SCENARIO_FILE) {
    scenario = readRavineManifest(resolve(process.env.SCENARIO_FILE), worldConfig as {seed?: string; verifiedAt?: string}, process.env.AGENT_ID ?? "explorer-1");
    writeFileSync(resolve(sessionFolder, "scenario.json"), JSON.stringify(scenario, null, 2) + "\n");
  }
  await world.connect();
  events?.add("world_configuration", worldConfig);
  // Operator requests are handled by this process; no agent continuation or force-kill.
  const requestFile = resolve(sessionLockPath, "control.json");
  writeFileSync(resolve(sessionLockPath, "mcp-control-ready"), String(process.pid));
  controlTimer = setInterval(() => {
    if (!existsSync(requestFile)) return;
    try {
      const request = JSON.parse(readFileSync(requestFile, "utf8"));
      unlinkSync(requestFile);
      if (!["completed", "stopped", "aborted"].includes(request.outcome))
        throw Error("Invalid control outcome");
      void shutdown("operator_control", request.outcome).then(
        () => process.exit(process.exitCode ?? 0),
        () => process.exit(1),
      );
    } catch (error) {
      process.stderr.write(`Session control error: ${String(error)}\n`);
    }
  }, 250);
  // Audit the starting state: mining a block does not guarantee its drop was collected.
  // This makes a stale player inventory visible in the session record immediately.
  const initialInventory = await world.act("inventory", {});
  events?.add("inventory_initial", { result: initialInventory });
  if (process.env.EMERGENCE_EXPECTED_START) {
    const expected = JSON.parse(process.env.EMERGENCE_EXPECTED_START);
    const actual = await world.observe() as {position: {x:number;y:number;z:number}; health:number; food:number; environment:{gameMode:string}};
    const p = actual.position;
    if (![expected.x, expected.y, expected.z].every(Number.isFinite) ||
        Math.hypot(p.x-expected.x,p.y-expected.y,p.z-expected.z) > 0.5 ||
        actual.health !== 20 || actual.food !== 20 || actual.environment.gameMode !== "survival" ||
        !initialInventory.ok || !Array.isArray(initialInventory.data) || initialInventory.data.length !== 0)
      throw Error("Frozen scenario starting position, inventory or survival state mismatch");
    events.add("objective_observation", {result: actual});
  }
  if (scenario) {
    if (!initialInventory.ok || !Array.isArray(initialInventory.data)) throw Error("Could not verify initial ravine inventory");
    verifyRavineStart(await world.observe() as Parameters<typeof verifyRavineStart>[0], initialInventory.data);
    events.add("scenario_ready", scenario);
  }
  events?.add("recording_ready", { output: destination });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const transportClosed = () => {
    void shutdown("transport_closed").then(
      () => process.exit(process.exitCode ?? 0),
      () => process.exit(1),
    );
  };
  server.server.onclose = transportClosed;
  process.stdin.once("end", transportClosed);
  process.stderr.write(
    `Connected to ${world.id} as ${process.env.AGENT_ID ?? "explorer-1"}; recording: ${destination ?? "disabled"}\n`,
  );
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void shutdown(signal).then(
      () => process.exit(process.exitCode ?? 0),
      (error) => {
        process.stderr.write(String(error));
        process.exit(1);
      },
    );
  });
main().catch(async (error) => {
  events?.add("startup_error", String(error));
  process.stderr.write(`MCP startup failed: ${String(error)}\n`);
  process.exitCode = 1;
  await shutdown("startup_error", "aborted");
});
