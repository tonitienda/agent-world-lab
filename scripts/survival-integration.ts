/** Owns a disposable Docker server. Never connects to the experiment server or mounts its data. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MinecraftAdapter } from "../src/environments/minecraft/adapter.js";
import {
  worldSettings,
  verifyProperties,
  verifyLevelDat,
} from "../src/environments/minecraft/world-config.js";
import { tempRoot } from "./temp-root.js";

const root = resolve(import.meta.dirname, "..");
if (
  process.env.EULA !== "TRUE" &&
  !(
    existsSync(join(root, ".env")) &&
    /^\s*EULA\s*=\s*["']?TRUE["']?\s*$/m.test(
      readFileSync(join(root, ".env"), "utf8"),
    )
  )
)
  throw Error(
    "Accept the Minecraft EULA with EULA=TRUE before running fixtures",
  );
if (process.env.RECORD_MP4)
  throw Error("Unset RECORD_MP4 for disposable integration tests");
const folder = mkdtempSync(join(tempRoot, "awl-survival-fixture-"));
console.log("Disposable fixture artifacts:", folder);
const name = `awl-fixture-${process.pid}-${Date.now()}`;
const docker = (...args: string[]) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const command = (text: string) => docker("exec", name, "rcon-cli", text);
let world: MinecraftAdapter | undefined;
try {
  // Reuse only the immutable server download; no worlds, player data or recordings copied.
  const jar = join(root, "data/minecraft/minecraft_server.1.21.4.jar");
  if (existsSync(jar))
    copyFileSync(jar, join(folder, "minecraft_server.1.21.4.jar"));
  const config = worldSettings("superflat", "12345");
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--label",
    "agent-world-lab.disposable=true",
    "-p",
    "127.0.0.1::25565",
    "-v",
    `${folder}:/data`,
    "-e",
    "EULA=TRUE",
    "-e",
    "VERSION=1.21.4",
    "-e",
    "ONLINE_MODE=FALSE",
    "-e",
    "MODE=survival",
    "-e",
    "DIFFICULTY=peaceful",
    "-e",
    "LEVEL_TYPE=minecraft:flat",
    "-e",
    `GENERATOR_SETTINGS=${config.generatorSettings}`,
    "-e",
    "SEED=12345",
    "-e",
    "SPAWN_PROTECTION=0",
    "-e",
    "ENABLE_RCON=TRUE",
    "-e",
    "RCON_PASSWORD=disposable-fixture-only",
    "-e",
    "MEMORY=1G",
    "itzg/minecraft-server:java21",
  );
  let healthy = false;
  for (let i = 0; i < 90; i++) {
    try {
      docker("exec", name, "mc-health");
      healthy = true;
      break;
    } catch {
      await delay(2000);
    }
  }
  assert.ok(healthy, "Disposable fixture server did not become ready");
  verifyProperties(
    readFileSync(join(folder, "server.properties"), "utf8").replace(
      "enable-rcon=true",
      "enable-rcon=false",
    ),
    config,
  );
  await verifyLevelDat(join(folder, "world/level.dat"), config);
  const binding = docker("port", name, "25565/tcp");
  process.env.MC_HOST = "127.0.0.1";
  process.env.MC_PORT = binding.split(":").at(-1)!;
  process.env.AGENT_ID = "survival-fixture";
  command("gamerule doDaylightCycle false");
  command("time set day");
  command("fill -12 9 -12 12 9 12 stone");
  command("fill -12 10 -12 12 16 12 air");
  world = new MinecraftAdapter({ lockPath: join(folder, "fixture.lock") });
  await world.connect();
  command("tp survival-fixture 0.5 10 0.5");
  command("clear survival-fixture");
  await delay(500);
  const action = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await world!.act(name, args);
    if (!result.ok) {
      console.error(
        "Failure inventory:",
        JSON.stringify(await world!.act("inventory", {})),
      );
      console.error(
        "Server inventory:",
        command("data get entity survival-fixture Inventory"),
      );
    }
    assert.ok(result.ok, `${name} ${JSON.stringify(args)}: ${result.message}`);
    console.log("PASS", name, args, result.message);
    return result;
  };
  const inventory = async () =>
    (await action("inventory")).data as { name: string; count: number }[];
  const has = async (name: string, count = 1) =>
    assert.ok(
      (await inventory())
        .filter((i) => i.name === name)
        .reduce((n, i) => n + i.count, 0) >= count,
      `Missing ${name}`,
    );
  for (let i = 0; i < 1; i++) {
    command("setblock 2 10 0 oak_log");
    await delay(120);
    await action("mine", { x: 2, y: 10, z: 0 });
    await action("move_to", { x: 2, y: 10, z: 0, radius: 0 });
    await delay(500);
    await action("move_to", { x: 0, y: 10, z: 0, radius: 0 });
  }
  await has("oak_log", 1);
  // Remaining recipe inputs are fixture supplies; mining/pickup was verified above.
  command("give survival-fixture oak_log 7");
  await delay(200);
  await action("recipes", { item: "wooden_pickaxe" });
  await action("craft", { item: "oak_planks", count: 32 });
  console.log(
    "Planks state",
    JSON.stringify(await inventory()),
    command("data get entity survival-fixture Inventory"),
  );
  await has("oak_planks", 32);
  await action("craft", { item: "crafting_table", count: 1 });
  await action("place", { x: 0, y: 10, z: 2, item: "crafting_table" });
  const table = { x: 0, y: 10, z: 2 };
  await action("craft", { item: "stick", count: 8 });
  await action("craft", {
    item: "wooden_pickaxe",
    count: 1,
    crafting_table_position: table,
  });
  await action("craft", {
    item: "wooden_axe",
    count: 1,
    crafting_table_position: table,
  });
  await action("equip", { item: "wooden_pickaxe", slot: "hand" });
  const equipment = (await action("equipment")).data as {
    hand: { name: string };
  };
  assert.equal(equipment.hand.name, "wooden_pickaxe");
  for (let i = 0; i < 1; i++) {
    command("setblock 2 10 0 stone");
    await delay(100);
    await action("mine", { x: 2, y: 10, z: 0 });
    await action("move_to", { x: 2, y: 10, z: 0, radius: 0 });
    await delay(400);
    await action("move_to", { x: 0, y: 10, z: 0, radius: 0 });
  }
  await has("cobblestone", 1);
  command("give survival-fixture cobblestone 7");
  await delay(200);
  await action("craft", {
    item: "furnace",
    count: 1,
    crafting_table_position: table,
  });
  await action("place", { x: 2, y: 10, z: 0, item: "furnace" });
  command("give survival-fixture raw_iron 1");
  await delay(200);
  await action("open_container", { x: 2, y: 10, z: 0 });
  await action("transfer_item", {
    direction: "deposit",
    slot: "input",
    item: "raw_iron",
    count: 1,
  });
  await action("transfer_item", {
    direction: "deposit",
    slot: "fuel",
    item: "oak_planks",
    count: 2,
  });
  let smelted = false;
  for (let i = 0; i < 30; i++) {
    const state = (await action("container")).data as {
      output?: { name: string };
    };
    if (state.output?.name === "iron_ingot") {
      smelted = true;
      break;
    }
    await delay(500);
  }
  assert.ok(smelted, "Furnace did not smelt iron");
  await action("transfer_item", {
    direction: "withdraw",
    slot: "output",
    item: "iron_ingot",
    count: 1,
  });
  await action("close_container");
  await has("iron_ingot");
  await action("craft", {
    item: "chest",
    count: 1,
    crafting_table_position: table,
  });
  await action("place", { x: -2, y: 10, z: 0, item: "chest" });
  await action("open_container", { x: -2, y: 10, z: 0 });
  await action("transfer_item", {
    direction: "deposit",
    item: "iron_ingot",
    count: 1,
  });
  assert.ok(!(await inventory()).some((i) => i.name === "iron_ingot"));
  await action("transfer_item", {
    direction: "withdraw",
    item: "iron_ingot",
    count: 1,
  });
  await action("close_container");
  await has("iron_ingot");
  command("setblock 0 10 -2 oak_door[facing=east,half=lower]");
  command("setblock 0 11 -2 oak_door[facing=east,half=upper]");
  await delay(200);
  await action("interact_block", { x: 0, y: 10, z: -2 });
  await delay(200);
  assert.match(
    command("execute if block 0 10 -2 oak_door[open=true]"),
    /Test passed/,
  );
  command("difficulty normal");
  command("give survival-fixture bread 1");
  command("effect give survival-fixture hunger 30 255 true");
  let beforeFood = 20;
  for (let i = 0; i < 30; i++) {
    await delay(500);
    beforeFood = ((await world.observe()) as { food: number }).food;
    if (beforeFood < 20) break;
  }
  command("effect clear survival-fixture minecraft:hunger");
  await delay(200);
  assert.ok(beforeFood < 20, "Fixture hunger did not reduce food");
  await action("eat", { item: "bread" });
  await delay(200);
  assert.ok(((await world.observe()) as { food: number }).food > beforeFood);
  command('summon husk 1.5 10 0.5 {NoAI:1b,Silent:1b,Tags:["fixture-target"]}');
  await delay(250);
  const observation = (await world.observe()) as {
    nearbyEntities: { id: number; type: string }[];
  };
  const hostile = observation.nearbyEntities.find((e) => e.type === "husk");
  assert.ok(hostile, "Hostile not observed");
  await action("attack", { entity_id: hostile.id });
  await delay(300);
  const health = command(
    "data get entity @e[tag=fixture-target,limit=1] Health",
  );
  assert.ok(!/20\.0f/.test(health), `Hostile took no damage: ${health}`);
  for (const [name, args] of [
    [
      "craft",
      { item: "diamond_pickaxe", count: 1, crafting_table_position: table },
    ],
    ["equip", { item: "missing", slot: "hand" }],
    ["equip", { item: "wooden_pickaxe", slot: "invalid" }],
    ["mine", { x: 100, y: 10, z: 0 }],
    ["interact_block", { x: 100, y: 10, z: 0 }],
    ["attack", { entity_id: 999999 }],
    ["unknown", {}],
    ["craft", { item: "oak_planks", count: -1 }],
  ] as [string, Record<string, unknown>][])
    assert.equal((await world.act(name, args)).ok, false, name);
  command("tp @e[tag=fixture-target] 10 10 0");
  await delay(200);
  assert.equal(
    (await world.act("attack", { entity_id: hostile.id })).ok,
    false,
  );
  await world.close();
  await world.close();
  command("difficulty peaceful");
  process.env.AGENT_ID = "legacy-smoke";
  process.env.AWL_DISPOSABLE_TEST = "1";
  // Existing tests run against untouched terrain outside the controlled arena.
  command("setworldspawn 100 10 100");
  for (const script of [
    "integration.ts",
    "bot-actions-smoke.ts",
    "mcp-session-integration.ts",
  ]) {
    console.log(
      execFileSync(
        process.execPath,
        ["--import", "tsx", join(root, "scripts", script)],
        { cwd: root, env: process.env, encoding: "utf8", timeout: 120000 },
      ),
    );
  }
  if (process.argv.includes("--capture")) {
    console.log(
      execFileSync(
        process.execPath,
        ["--import", "tsx", join(root, "scripts/capture-smoke.ts")],
        {
          cwd: root,
          env: {
            ...process.env,
            CAPTURE_OUTPUT_DIR: join(folder, "captures"),
            RECORD_WIDTH: "426",
            RECORD_HEIGHT: "240",
          },
          encoding: "utf8",
          timeout: 120000,
        },
      ),
    );
  }
  docker("rm", "-f", name);
  const normalFolder = mkdtempSync(join(tempRoot, "awl-normal-fixture-"));
  if (existsSync(jar))
    copyFileSync(jar, join(normalFolder, "minecraft_server.1.21.4.jar"));
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--label",
    "agent-world-lab.disposable=true",
    "-p",
    "127.0.0.1::25565",
    "-v",
    `${normalFolder}:/data`,
    "-e",
    "EULA=TRUE",
    "-e",
    "VERSION=1.21.4",
    "-e",
    "ONLINE_MODE=FALSE",
    "-e",
    "MODE=survival",
    "-e",
    "DIFFICULTY=normal",
    "-e",
    "LEVEL_TYPE=minecraft:normal",
    "-e",
    "GENERATOR_SETTINGS=",
    "-e",
    "SEED=12345",
    "-e",
    "ENABLE_RCON=FALSE",
    "-e",
    "MEMORY=1G",
    "itzg/minecraft-server:java21",
  );
  healthy = false;
  for (let i = 0; i < 90; i++) {
    try {
      docker("exec", name, "mc-health");
      healthy = true;
      break;
    } catch {
      await delay(2000);
    }
  }
  assert.ok(healthy, "Normal world failed to start");
  const normalConfig = worldSettings("survival", "12345");
  verifyProperties(
    readFileSync(join(normalFolder, "server.properties"), "utf8"),
    normalConfig,
  );
  await verifyLevelDat(join(normalFolder, "world/level.dat"), normalConfig);
  process.env.MC_PORT = docker("port", name, "25565/tcp").split(":").at(-1)!;
  world = new MinecraftAdapter({
    lockPath: join(normalFolder, "fixture.lock"),
  });
  await world.connect();
  console.log(
    "PASS: normal overworld generator and seed; bounded natural spawn observation",
    JSON.stringify(await world.observe()),
  );
  await world.close();
  console.log(
    "PASS: disposable live survival mechanics; fixture artifacts:",
    folder,
  );
} finally {
  await world?.close();
  try {
    docker("rm", "-f", name);
  } catch {
    /* Preserve fixture directory for diagnosis. */
  }
  writeFileSync(join(folder, "test-finished.txt"), new Date().toISOString());
}
