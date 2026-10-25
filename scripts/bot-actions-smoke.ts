import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createWorld } from "../src/environments/index.js";

type Observation = {
  position: { x: number; y: number; z: number };
  nearbyBlocks: { name: string; x: number; y: number; z: number }[];
};
type InventoryItem = { name: string; count: number };

// This is an end-to-end tool/bot test, not an LLM test. CI supplies a disposable
// superflat survival world. Do not run against a world you want to preserve:
// the test digs and then tries to replace one block.
const world = createWorld("minecraft");
const assertOk = (result: { ok: boolean; message: string }, label: string) =>
  assert.equal(result.ok, true, `${label}: ${result.message}`);

try {
  await world.connect();
  const start = await world.observe() as Observation;
  const startX = Math.floor(start.position.x);
  const feetY = Math.floor(start.position.y);
  const startZ = Math.floor(start.position.z);
  console.log("Spawned:", start.position);

  // Verify actual movement (not just an API success response).
  const destination = { x: startX + 3, y: feetY, z: startZ };
  assertOk(await world.act("move_to", destination), "move_to");
  const moved = await world.observe() as Observation;
  assert.ok(moved.position.x - start.position.x >= 1.5,
    `Agent did not move: start=${start.position.x}, end=${moved.position.x}`);
  console.log("Moved:", moved.position);

  // Dig the ground block one block ahead. Mineflayer operates in survival mode.
  const target = { x: Math.floor(moved.position.x) + 1, y: Math.floor(moved.position.y) - 1, z: Math.floor(moved.position.z) };
  const ground = moved.nearbyBlocks.find(b => b.x === target.x && b.y === target.y && b.z === target.z);
  assert.ok(ground && (ground.name === "grass_block" || ground.name === "dirt"),
    `Expected superflat grass/dirt ground at ${JSON.stringify(target)}, got ${ground?.name}`);

  assertOk(await world.act("mine", target), "mine");
  const dug = await world.observe() as Observation;
  assert.ok(!dug.nearbyBlocks.some(b => b.x === target.x && b.y === target.y && b.z === target.z),
    "Mined block is still present");
  console.log("Mined block:", target);

  // Move exactly into the mined hole to collect the drop; the default radius=1 can stop too far away.
  // Fail instead of quietly skipping block placement.
  assertOk(await world.act("move_to", { ...target, radius: 0 }), "move into drop");
  let inventory: InventoryItem[] = [];
  for (let i = 0; i < 15; i++) {
    const response = await world.act("inventory", {});
    assertOk(response, "inventory");
    inventory = response.data as InventoryItem[];
    if (inventory.some(i => i.name === "dirt" && i.count > 0)) break;
    await delay(300);
  }
  assert.ok(inventory.some(i => i.name === "dirt" && i.count > 0),
    `Mined drop was not collected: ${JSON.stringify(inventory)}`);

  // First climb to an adjacent surface block; a distant diagonal route can stall.
  assertOk(await world.act("move_to", { x: target.x, y: feetY, z: target.z + 1 }), "climb from hole");
  assertOk(await world.act("move_to", { x: target.x + 2, y: feetY, z: target.z + 1 }), "move from hole");
  assertOk(await world.act("place", { ...target, item: "dirt" }), "place");
  const restored = await world.observe() as Observation;
  assert.ok(restored.nearbyBlocks.some(b =>
    b.x === target.x && b.y === target.y && b.z === target.z && b.name === "dirt"),
    "Placed dirt block is missing");

  console.log("PASS: real bot movement, mining, item pickup, and placement");
} catch (error) {
  console.error("Bot action smoke test failed:", error);
  process.exitCode = 1;
} finally {
  await world.close();
}
