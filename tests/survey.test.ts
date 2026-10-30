import test from "node:test";
import assert from "node:assert/strict";
import { Vec3 } from "vec3";
import { MinecraftAdapter } from "../src/environments/minecraft/adapter.js";
import { surveyLimits, surveySurroundings } from "../src/environments/minecraft/survey.js";
import type { Bot } from "mineflayer";

function fixture() {
  const blocks = new Map<string, { name: string; position: Vec3; hidden?: boolean }>();
  const add = (x: number, y: number, z: number, name: string, hidden = false) =>
    blocks.set(`${x},${y},${z}`, { name, position: new Vec3(x, y, z), hidden });
  let reads = 0;
  const bot = {
    entity: { position: new Vec3(.5, 96, .5) }, health: 20, food: 20,
    time: { timeOfDay: 6000 }, equipment: Array(6).fill(null),
    isRaining: false, thunderState: 0, version: "1.21.4",
    game: { dimension: "overworld", difficulty: "peaceful", gameMode: "survival" },
    entities: {},
    getEquipmentDestSlot: () => 0,
    inventory: { slots: [null] },
    blockAt: (p: Vec3) => {
      reads++;
      return blocks.get(`${p.x},${p.y},${p.z}`) ?? { name: "air", position: p };
    },
    canSeeBlock: (block: { hidden?: boolean }) => !block.hidden,
  };
  const world = new MinecraftAdapter();
  Object.assign(world, { bot });
  return { world, bot, add, reads: () => reads };
}

test("one-use survey reveals elevated visible materials without changing normal observation range", async () => {
  const { world, add } = fixture();
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) add(x, 95, z, "stone");
  add(-4, 102, -4, "oak_log");
  add(13, 95, 0, "gold_block");
  const before = await world.observe() as { nearbyBlocks: { name: string }[]; survey: { usesRemaining: number } };
  assert.equal(before.survey.usesRemaining, 1);
  assert.ok(before.nearbyBlocks.every(b => b.name !== "oak_log"));
  const result = await world.act("survey", {});
  assert.ok(result.ok);
  const data = result.data as ReturnType<typeof surveySurroundings> & { usesRemaining: number };
  assert.equal(data.usesRemaining, 0);
  assert.ok(data.materials.find(m => m.name === "oak_log")?.samples.some(p => p.y === 102));
  assert.ok(data.materials.some(m => m.name === "gold_block"));
  const stone = data.materials.find(m => m.name === "stone")!;
  assert.ok(stone.visibleCount > 128);
  assert.equal(stone.samples.length, surveyLimits.maxSamplesPerMaterial);
  const after = await world.observe() as typeof before;
  assert.equal(after.survey.usesRemaining, 0);
  assert.ok(after.nearbyBlocks.every(b => b.name !== "oak_log"));
});

test("survey excludes occluded, unloaded and out-of-bounds blocks, regardless of supplied radius", async () => {
  const { world, bot, add } = fixture();
  add(4, 102, 0, "diamond_ore", true);
  add(17, 96, 0, "emerald_block");
  add(12, 96, 12, "gold_block"); // outside the horizontal circle
  add(0, 109, 0, "oak_log");
  add(0, 87, 0, "iron_ore");
  add(16, 108, 0, "oak_leaves"); // inclusive scan boundaries
  const read = bot.blockAt;
  bot.blockAt = p => p.x === -16 ? null as never : read(p);
  const result = await world.act("survey", { radius: 1000 });
  assert.ok(result.ok);
  const data = result.data as ReturnType<typeof surveySurroundings>;
  assert.deepEqual(data.materials.map(m => m.name), ["oak_leaves"]);
  assert.ok(data.coverage.unloadedPositions > 0);
  assert.deepEqual(data.limits, surveyLimits);
});

test("repeated and simultaneous calls cannot replenish a session's survey allowance", async () => {
  const { world, reads } = fixture();
  const results = await Promise.all([world.act("survey", {}), world.act("survey", {})]);
  assert.equal(results.filter(r => r.ok).length, 1);
  const count = reads();
  for (let i = 0; i < 3; i++) {
    const result = await world.act("survey", {});
    assert.equal(result.ok, false);
    assert.match(result.message, /only one successful survey/);
  }
  assert.equal(reads(), count, "exhausted calls must not scan terrain again");
  assert.ok((await fixture().world.act("survey", {})).ok, "a separate session gets its own allowance");
});

test("disconnection, an open container or unloaded terrain do not spend the survey", async () => {
  const disconnected = new MinecraftAdapter();
  assert.equal((await disconnected.act("survey", {})).ok, false);
  const { world, bot } = fixture();
  Object.assign(bot, { currentWindow: {} });
  assert.equal((await world.act("survey", {})).ok, false);
  Object.assign(bot, { currentWindow: undefined });
  const read = bot.blockAt;
  bot.blockAt = () => null as never;
  const empty = await world.act("survey", {});
  assert.equal(empty.ok, false);
  assert.match(empty.message, /allowance was not spent/);
  bot.blockAt = read;
  assert.ok((await world.act("survey", {})).ok);
});

test("survey reports bounded samples and explicit omission counts for diverse terrain", () => {
  const { bot, add } = fixture();
  for (let i = 0; i < 80; i++) add(i % 10 - 5, 96 + Math.floor(i / 10), 0, `fixture_material_${i}`);
  const data = surveySurroundings(bot as unknown as Bot);
  assert.equal(data.materials.length, surveyLimits.maxMaterialGroups);
  assert.equal(data.coverage.totalMaterialGroups, 80);
  assert.equal(data.coverage.omittedMaterialGroups, 16);
});
