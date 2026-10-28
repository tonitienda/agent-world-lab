import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { readFileSync } from "node:fs";

/** Constructed course: these coordinates and materials are independent of the seed. */
export const RAVINE = {
  id: "ravine-v1",
  constructed: true,
  bounds: { min: [-12, 71, -16], max: [27, 127, 16] },
  start: { x: 2.5, y: 96, z: 0.5 },
  goal: { x: 15.5, y: 96, z: 0.5, block: "gold_block" },
  gap: { minX: 4, maxX: 11, minZ: -16, maxZ: 16, bottomY: 71, bankY: 95 },
  resources: [{ x: -1, y: 96, z: -5 }, { x: -6, y: 96, z: 6 }],
} as const;
export type Cuboid = { min: number[]; max: number[]; block: string };
export type RavineManifest = {
  id: typeof RAVINE.id;
  agent: string;
  verifiedAt: string;
  world: { seed: string; verifiedAt: string };
  course: typeof RAVINE;
};
export function agentName(agent: string) {
  if (!/^[A-Za-z0-9_\-]{1,16}$/.test(agent)) throw Error("Agent must be a Minecraft username (1–16 letters, digits, underscores or hyphens)");
  return agent;
}
export function ravineCuboids(): Cuboid[] {
  const box = (min: number[], max: number[], block: string) => ({ min, max, block });
  const result = [
    box([-12, 96, -16], [27, 127, 16], "air"),
    box([-12, 71, -16], [27, 92, 16], "stone"),
    box([-12, 93, -16], [27, 94, 16], "dirt"),
    box([-12, 95, -16], [27, 95, 16], "grass_block"),
    box([4, 72, -16], [11, 95, 16], "air"),
    box([14, 95, -1], [16, 95, 1], "gold_block"),
    box([18, 96, 0], [18, 99, 0], "emerald_block"),
  ];
  for (const { x, y, z } of RAVINE.resources) {
    result.push(box([x - 2, y + 3, z - 2], [x + 2, y + 4, z + 2], "oak_leaves[persistent=true]"));
    result.push(box([x, y, z], [x, y + 3, z], "oak_log"));
  }
  return result;
}
/** Keep every fill below vanilla's default modification limit. */
export function fillCommands(cube: Cuboid): string[] {
  const lengths = cube.max.map((v, i) => v - cube.min[i] + 1);
  if (lengths.some(n => !Number.isInteger(n) || n <= 0)) throw Error("Invalid fill volume");
  if (lengths.reduce((a, b) => a * b, 1) <= 32768)
    return [`fill ${cube.min.join(" ")} ${cube.max.join(" ")} minecraft:${cube.block}`];
  const axis = lengths.indexOf(Math.max(...lengths));
  const mid = Math.floor((cube.min[axis] + cube.max[axis]) / 2);
  const left = { ...cube, max: [...cube.max] }, right = { ...cube, min: [...cube.min] };
  left.max[axis] = mid; right.min[axis] = mid + 1;
  return [...fillCommands(left), ...fillCommands(right)];
}
export function expectedRavineBlocks() {
  const blocks = new Map<string, string>();
  for (const c of ravineCuboids())
    for (let x = c.min[0]; x <= c.max[0]; x++)
      for (let y = c.min[1]; y <= c.max[1]; y++)
        for (let z = c.min[2]; z <= c.max[2]; z++) blocks.set(`${x},${y},${z}`, c.block.split("[")[0]);
  return blocks;
}
let expected: Map<string, string> | undefined;
export function verifyRavineBlocks(blockAt: (x: number, y: number, z: number) => string | undefined) {
  expected ??= expectedRavineBlocks();
  for (const [key, name] of expected) {
    const [x, y, z] = key.split(",").map(Number);
    const actual = blockAt(x, y, z);
    if (actual !== name) throw Error(`Ravine mismatch at ${key}: expected ${name}, got ${actual ?? "unloaded terrain"}`);
  }
  return { blocksVerified: expected.size };
}
export function verifyRavineStart(state: {position: {x: number; y: number; z: number}; health: number; food: number; environment: {gameMode: string}}, inventory: unknown[]) {
  const p = state.position, start = RAVINE.start;
  if (Math.hypot(p.x - start.x, p.y - start.y, p.z - start.z) > .3) throw Error("Agent is not at the verified ravine starting position");
  if (state.health !== 20 || state.food !== 20 || inventory.length || state.environment.gameMode !== "survival")
    throw Error("Ravine requires survival mode, full health/food and an empty inventory");
}
export async function waitUntil(check: () => void, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { check(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}
export function botRavineState(bot: Bot) {
  return {position: bot.entity.position, health: bot.health, food: bot.food, environment: {gameMode: bot.game.gameMode}};
}
export function verifyBotRavine(bot: Bot) {
  verifyRavineBlocks((x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name);
  verifyRavineStart(botRavineState(bot), bot.inventory.items());
  const yawError = Math.atan2(Math.sin(bot.entity.yaw - 3 * Math.PI / 2), Math.cos(bot.entity.yaw - 3 * Math.PI / 2));
  if (Math.abs(yawError) > .05) throw Error("Agent must face east toward the ravine");
}
/** Console commands are harness setup, never agent actions or narration. RCON stays disabled. */
export async function prepareRavine(bot: Bot, command: (text: string) => Promise<void>) {
  const agent = agentName(bot.username);
  await command(`gamemode spectator ${agent}`);
  await command(`tp ${agent} 2.5 130 0.5 -90 15`);
  await waitUntil(() => {
    if (Math.abs(bot.entity.position.x - 2.5) > 1 || Math.abs(bot.entity.position.z - .5) > 1 || bot.game.gameMode !== "spectator") throw Error("Waiting for setup teleport");
    for (const x of [-12, 27]) for (const z of [-16, 16])
      if (!bot.blockAt(new Vec3(x, 95, z))) throw Error("Waiting for course chunks");
  }, 30000);
  for (const text of [
    "gamerule doDaylightCycle false", "gamerule doWeatherCycle false", "gamerule doMobSpawning false", "gamerule randomTickSpeed 0",
    "time set day", "weather clear", "gamerule spawnRadius 0",
    ...ravineCuboids().flatMap(fillCommands),
    "setworldspawn 2 96 0", `spawnpoint ${agent} 2 96 0`,
    `clear ${agent}`, `effect clear ${agent}`,
    `effect give ${agent} minecraft:instant_health 1 10 true`, `effect give ${agent} minecraft:saturation 1 10 true`,
    `gamemode survival ${agent}`, `tp ${agent} 2.5 96 0.5 -90 15`,
  ]) await command(text);
  await waitUntil(() => verifyBotRavine(bot), 30000);
}
export function readRavineManifest(file: string, world: { seed?: string; verifiedAt?: string }, agent: string): RavineManifest {
  const value = JSON.parse(readFileSync(file, "utf8")) as RavineManifest;
  if (value.id !== RAVINE.id || value.agent !== agent || JSON.stringify(value.course) !== JSON.stringify(RAVINE) || !Number.isFinite(Date.parse(value.verifiedAt)) || !world.verifiedAt || value.world?.seed !== world.seed || value.world?.verifiedAt !== world.verifiedAt)
    throw Error("Ravine manifest is missing, stale, or belongs to another agent/world; run scenario:ravine setup again");
  return value;
}
export function ravineBriefing() {
  return `Scenario definition: ${RAVINE.id}. This is a constructed, repeatable survival course, not a natural ravine.
Start: (2.5, 96, 0.5), facing east. The gap occupies x=4 through x=11, z=-16 through z=16; the stone bottom is y=71, 24 blocks below the banks.
Goal: reach the gold landing pad centered at (15.5, 96, 0.5) alive. A tall emerald pillar at (18, 96, 0) marks the far bank. Near-bank wood is at (-1, 96, -5) and (-6, 96, 6). You begin with full health/food and an empty inventory.
The goal coordinates are supplied because observe is a local scan, not a distant visual panorama. Choose your own strategy. Finalize on the landing pad if successful, or report clearly why you failed. Session completion alone does not certify challenge success.`;
}
