import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { acquireLock, activeLock } from "../src/session/lock.js";
import { SessionLifecycle } from "../src/session/lifecycle.js";
import {
  worldSettings,
  verifyProperties,
} from "../src/environments/minecraft/world-config.js";
import { MinecraftAdapter } from "../src/environments/minecraft/adapter.js";
import { SessionEvents } from "../src/mcp/session-events.js";

for (const preset of ["survival", "superflat"])
  test(`${preset} generation settings and persisted verification`, () => {
    const config = worldSettings(preset, "12345");
    assert.equal(
      config.levelType,
      preset === "survival" ? "minecraft:normal" : "minecraft:flat",
    );
    assert.equal(config.generatorSettings === "", preset === "survival");
    const properties = `level-type=${config.levelType}\nlevel-seed=12345\ngenerator-settings=${config.generatorSettings}\ngamemode=survival\ndifficulty=${config.difficulty}\nonline-mode=false\nenable-rcon=false`;
    verifyProperties(properties, config);
    if (preset === "survival")
      verifyProperties(
        properties.replace("generator-settings=\n", "generator-settings={}\n"),
        config,
      );
    assert.throws(
      () =>
        verifyProperties(properties.replace(config.levelType, "wrong"), config),
      /level-type/,
    );
    assert.throws(
      () =>
        verifyProperties(
          properties.replace("level-seed=12345", "level-seed=9"),
          config,
        ),
      /level-seed/,
    );
  });
test("reject ambiguous presets and nonreproducible seeds", () => {
  for (const [preset, seed] of [
    ["oops", "1"],
    ["survival", "NaN"],
    ["survival", "9223372036854775808"],
  ])
    assert.throws(() => worldSettings(preset, seed));
});
test("active sessions exclude reset; release is idempotent; crashed owners can be reclaimed", () => {
  const dir = mkdtempSync(join(tmpdir(), "awl-lock-test-")),
    path = join(dir, "active.lock");
  try {
    const release = acquireLock("session", path);
    assert.equal(activeLock(path)?.pid, process.pid);
    assert.throws(() => acquireLock("world reset", path), /Active session/);
    release();
    release();
    assert.equal(activeLock(path), undefined);
    const child = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
    assert.equal(child.status, 0);
    mkdirSync(path);
    writeFileSync(
      join(path, "owner.json"),
      JSON.stringify({ pid: child.pid, kind: "crashed session" }),
    );
    const reset = acquireLock("world reset", path);
    assert.equal(activeLock(path)?.kind, "world reset");
    reset();
    mkdirSync(path);
    writeFileSync(join(path, "owner.json"), "broken");
    assert.throws(() => acquireLock("world reset", path));
    assert.ok(existsSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
for (const outcome of ["completed", "stopped", "aborted"] as const)
  test(`finalization ${outcome} is exactly once, including concurrent requests`, async () => {
    const lifecycle = new SessionLifecycle();
    let closes = 0;
    const finish = () =>
      lifecycle.finish(outcome, async () => {
        closes++;
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    await Promise.all([
      finish(),
      finish(),
      lifecycle.finish("aborted", async () => {
        closes++;
      }),
    ]);
    assert.equal(closes, 1);
    assert.equal(lifecycle.outcome, outcome);
  });
test("failed finalization is not rerun and retains the error", async () => {
  const lifecycle = new SessionLifecycle();
  let count = 0;
  await assert.rejects(
    lifecycle.finish("aborted", async () => {
      count++;
      throw Error("recorder failed");
    }),
    /recorder failed/,
  );
  await assert.rejects(
    lifecycle.finish("completed", async () => {
      count++;
    }),
    /recorder failed/,
  );
  assert.equal(count, 1);
});
test("recordings cannot be overwritten by a reused event folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "awl-events-test-"));
  try {
    new SessionEvents(dir);
    assert.throws(() => new SessionEvents(dir), /already contains events/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("disconnected adapter returns structured failure and close is safe", async () => {
  const world = new MinecraftAdapter();
  assert.deepEqual(await world.act("inventory", {}), {
    ok: false,
    message: "Agent not connected / spawned",
  });
  await world.close();
  await world.close();
});

import { resetWorld } from "../src/environments/minecraft/reset.js";
import { configuredMinecraftVersion } from "../src/environments/minecraft/runtime-cache.js";
import { readFileSync } from "node:fs";
for (const preset of ["survival", "superflat"])
  test(`reset ${preset} archives only fixture data, verifies settings, and excludes concurrent sessions`, async () => {
    const root = mkdtempSync(join(tmpdir(), "awl-reset-test-"));
    const lock = join(root, "data/active-session.lock");
    const config = worldSettings(preset, "42");
    mkdirSync(join(root, "data/minecraft"), { recursive: true });
    writeFileSync(join(root, "data/minecraft", "sentinel"), "original-world");
    const version = configuredMinecraftVersion(root);
    const jar = `minecraft_server.${version}.jar`;
    if (version) {
      writeFileSync(join(root, "data/minecraft", jar), "fixture-server-runtime");
      writeFileSync(join(root, "data/minecraft/.vanilla-manifest.json"), JSON.stringify({
        "@type": "me.itzg.helpers.vanilla.VanillaManifest", minecraftVersion: version,
        serverEntry: jar, files: [jar],
      }));
    }
    let calls = 0,
      verified = false;
    const ops = {
      checkSafety: async () => {},
      verifyGeneration: async () => {
        verified = true;
      },
      docker: (_args: string[], env?: NodeJS.ProcessEnv) => {
        calls++;
        if (env) {
          // The runtime must be present before Docker starts. Old world state
          // must not be carried into the replacement directory with it.
          if (version) assert.equal(readFileSync(join(root, "data/minecraft", jar), "utf8"), "fixture-server-runtime");
          assert.equal(existsSync(join(root, "data/minecraft/sentinel")), false);
          assert.equal(env.MC_LEVEL_TYPE, config.levelType);
          assert.equal(env.GENERATOR_SETTINGS, config.generatorSettings);
          writeFileSync(
            join(root, "data/minecraft/server.properties"),
            `level-type=${config.levelType}\nlevel-seed=42\ngenerator-settings=${config.generatorSettings}\ngamemode=survival\ndifficulty=${config.difficulty}\nonline-mode=false\nenable-rcon=false`,
          );
        }
      },
    };
    try {
      const release = acquireLock("session", lock);
      await assert.rejects(resetWorld(root, config, ops), /Active session/);
      assert.equal(calls, 0);
      assert.equal(
        readFileSync(join(root, "data/minecraft/sentinel"), "utf8"),
        "original-world",
      );
      release();
      const result = await resetWorld(root, config, ops);
      assert.equal(calls, 2);
      assert.ok(verified);
      assert.equal(
        readFileSync(join(result.archive, "sentinel"), "utf8"),
        "original-world",
      );
      assert.equal(
        JSON.parse(
          readFileSync(join(root, "data/minecraft/world-config.json"), "utf8"),
        ).preset,
        preset,
      );
      assert.equal(activeLock(lock), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
test("reset preserves original data and releases lock on verification failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "awl-reset-failure-"));
  mkdirSync(join(root, "data/minecraft"), { recursive: true });
  writeFileSync(join(root, "data/minecraft/sentinel"), "original");
  try {
    let calls = 0;
    await assert.rejects(
      resetWorld(root, worldSettings("survival", "42"), {
        checkSafety: async () => {},
        verifyGeneration: async () => {},
        docker: () => {
          calls++;
        },
      }),
      /Prior world preserved/,
    );
    assert.equal(calls, 2);
    assert.equal(activeLock(join(root, "data/active-session.lock")), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { Vec3 } from "vec3";
function adapterFixture(bot: object) {
  const adapter = new MinecraftAdapter();
  // Inject the narrow test double without connecting to any real world.
  Object.assign(adapter, { bot });
  return adapter;
}
test("inventory reflects the active container view instead of the stale player window", async () => {
  const slots = Array(63).fill(null);
  slots[30] = { name: "oak_planks", count: 3, slot: 30, type: 1, metadata: 0 };
  const world = adapterFixture({
    entity: { position: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: "iron_ingot", count: 1 }] },
    currentWindow: { slots, inventoryStart: 27, inventoryEnd: 63 },
  });
  const result = await world.act("inventory", {});
  assert.ok(result.ok);
  assert.deepEqual(
    (result.data as { name: string; count: number }[]).map((i) => ({
      name: i.name,
      count: i.count,
    })),
    [{ name: "oak_planks", count: 3 }],
  );
});
test("reach and visibility failures cannot trigger block or entity operations", async () => {
  let calls = 0;
  const world = adapterFixture({
    entity: { position: new Vec3(0, 10, 0), height: 1.8 },
    entities: { 7: { position: new Vec3(10, 10, 0) } },
    blockAt: () => ({ name: "oak_door", boundingBox: "block" }),
    canSeeBlock: () => false,
    activateBlock: () => {
      calls++;
    },
    attack: () => {
      calls++;
    },
    world: { raycast: () => ({}) },
  });
  Object.assign(world, { observedEntities: new Set([7]) });
  for (const [name, args, pattern] of [
    ["interact_block", { x: 9, y: 10, z: 0 }, /reach/],
    ["interact_block", { x: 1, y: 10, z: 0 }, /visible/],
    ["attack", { entity_id: 7 }, /reach/],
    ["attack", { entity_id: 8 }, /discovered/],
    ["open_container", { x: NaN, y: 10, z: 0 }, /Invalid x/],
    ["unknown", {}, /Unsupported/],
  ] as [string, Record<string, unknown>, RegExp][]) {
    const result = await world.act(name, args);
    assert.equal(result.ok, false);
    assert.match(result.message, pattern);
  }
  assert.equal(calls, 0);
});
test("invalid quantities and equipment slots fail before inventory mutations", async () => {
  let mutations = 0;
  const world = adapterFixture({
    entity: {},
    inventory: {
      items: () => [{ name: "oak_planks", type: 1, count: 2, metadata: 0 }],
    },
    toss: () => {
      mutations++;
    },
    equip: () => {
      mutations++;
    },
  });
  for (const args of [
    { item: "oak_planks", count: 3 },
    { item: "oak_planks", count: -1 },
    { item: "oak_planks", count: 1.5 },
    { item: "oak_planks", count: Infinity },
  ]) {
    assert.equal((await world.act("drop", args)).ok, false);
  }
  assert.equal(
    (await world.act("equip", { item: "oak_planks", slot: "invalid" })).ok,
    false,
  );
  assert.equal(mutations, 0);
});

test("food lookup uses names when food-registry IDs lag protocol item IDs", async () => {
  let consumed = false;
  const bread = { name: "bread", type: 886, count: 1 };
  const world = adapterFixture({
    entity: {},
    food: 18,
    health: 20,
    inventory: { items: () => [bread] },
    registry: {
      foods: { 855: { name: "bread" } },
      foodsByName: { bread: { foodPoints: 5 } },
    },
    equip: async () => {},
    consume: async () => {
      consumed = true;
    },
  });
  assert.equal((await world.act("eat", { item: "bread" })).ok, true);
  assert.ok(consumed);
});
