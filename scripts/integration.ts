import assert from "node:assert/strict";
import { createWorld } from "../src/environments/index.js";

const world = createWorld("minecraft");

try {
  await world.connect();
  assert.equal(world.id, "minecraft");
  const before = await world.observe() as { world: string; position: { x: number; y: number; z: number }; nearbyBlocks: unknown[] };
  assert.equal(before.world, "minecraft");
  assert.ok(Number.isFinite(before.position.x));
  assert.ok(Number.isFinite(before.position.y));
  assert.ok(Number.isFinite(before.position.z));
  assert.ok(Array.isArray(before.nearbyBlocks));

  const items = await world.act("inventory", {});
  assert.equal(items.ok, true);
  assert.ok(Array.isArray(items.data));

  const chat = await world.act("say", { message: "agent-world-lab: integration test" });
  assert.equal(chat.ok, true);

  const invalid = await world.act("mine", { x: 30000001, y: 0, z: 0 });
  assert.equal(invalid.ok, false, "Invalid world action should return a structured failure");
  assert.match(invalid.message, /Invalid x/);

  const after = await world.observe() as { position: { x: number } };
  assert.ok(Number.isFinite(after.position.x));
  console.log("PASS: real Minecraft login, observation, inventory, chat, validation and repeat observation");
} catch (error) {
  console.error("Minecraft integration test failed:", error);
  process.exitCode = 1;
} finally {
  await world.close();
}
