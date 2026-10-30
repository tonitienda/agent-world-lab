import {
  existsSync,
  mkdirSync,
  renameSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { acquireLock } from "../../session/lock.js";
import { worldSettings, verifyProperties } from "./world-config.js";
import { configuredMinecraftVersion, restoreRuntimeCache } from "./runtime-cache.js";

/** Call only after CLI confirmation. Injected operations let tests use temporary worlds. */
export async function resetWorld(
  root: string,
  config: ReturnType<typeof worldSettings>,
  operations: {
    checkSafety: () => Promise<void>;
    docker: (args: string[], env?: NodeJS.ProcessEnv) => void;
    verifyGeneration: (file: string) => Promise<void>;
  },
) {
  const release = acquireLock(
    "world reset",
    join(root, "data/active-session.lock"),
  );
  const world = join(root, "data/minecraft");
  const archive = join(
    root,
    "data/world-archives",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`,
  );
  try {
    await operations.checkSafety();
    const version = configuredMinecraftVersion(root);
    operations.docker(["compose", "stop", "--timeout", "30", "minecraft"]);
    mkdirSync(join(root, "data/world-archives"), { recursive: true });
    if (existsSync(world)) renameSync(world, archive);
    mkdirSync(world, { recursive: true });
    try {
      if (restoreRuntimeCache(root, world, version, archive))
        console.log(`Reusing cached Minecraft ${version} server runtime; world and player data remain fresh.`);
      operations.docker(
        ["compose", "up", "-d", "--wait", "--wait-timeout", "300", "minecraft"],
        {
          ...process.env,
          MC_LEVEL_TYPE: config.levelType,
          GENERATOR_SETTINGS: config.generatorSettings,
          MC_SEED: config.seed,
          MC_DIFFICULTY: config.difficulty,
        },
      );
      verifyProperties(
        readFileSync(join(world, "server.properties"), "utf8"),
        config,
      );
      await operations.verifyGeneration(join(world, "world/level.dat"));
      const playerData = join(world, "world/playerdata");
      if (existsSync(playerData) && readdirSync(playerData).length)
        throw Error("Fresh world unexpectedly contains saved players");
      writeFileSync(
        join(world, "world-config.json"),
        JSON.stringify(
          { ...config, verifiedAt: new Date().toISOString() },
          null,
          2,
        ) + "\n",
      );
      return { archive, config };
    } catch (e) {
      throw Error(
        `Reset verification failed. Prior world preserved at ${archive}. ${String(e)}`,
      );
    }
  } finally {
    release();
  }
}
