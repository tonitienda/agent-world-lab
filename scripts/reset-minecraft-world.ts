import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";

import { randomBytes } from "node:crypto";
import { resetWorld } from "../src/environments/minecraft/reset.js";
import {
  worldSettings,
  verifyLevelDat,
} from "../src/environments/minecraft/world-config.js";

const options = process.argv.slice(2);
for (let i = 0; i < options.length; i++) {
  if (options[i] === "--yes") continue;
  if (
    !["--preset", "--seed"].includes(options[i]) ||
    options[i + 1] === undefined
  )
    throw Error(`Unknown or incomplete option ${options[i]}`);
  i++;
}
const option = (name: string, fallback: string) =>
  options.includes(name) ? options[options.indexOf(name) + 1] : fallback;
const config = worldSettings(
  option("--preset", "superflat"),
  option("--seed", randomBytes(8).readBigInt64BE().toString()),
);
const root = resolve(import.meta.dirname, "..");
const world = join(root, "data", "minecraft");
const archives = join(root, "data", "world-archives");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archive = join(archives, stamp);
const yes = process.argv.includes("--yes");
if (!yes) {
  console.log("Dry run: Minecraft world reset");
  console.log("World settings:", config);
  console.log("Current Minecraft server data:", world);
  console.log("Backup destination:", archive);
  console.log(
    "The server will be stopped, data archived, and a fresh configured world created.",
  );
  console.log(
    "All data in the server's /data mount (world, server configs, logs) is archived.",
  );
  console.log(
    "Stop Claude/Codex MCP sessions and wait for MP4 files to finalize first.",
  );
  console.log("Run npm run world:reset -- --yes to proceed.");
  process.exit(0);
}

function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
  console.log("$ docker", args.join(" "));
  const result = spawnSync("docker", args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`Docker command failed with exit ${result.status}`);
}
async function isPortOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port });
    sock.setTimeout(600);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}
const result = await resetWorld(root, config, {
  docker: run,
  verifyGeneration: (file) => verifyLevelDat(file, config),
  checkSafety: async () => {
    for (const port of [3007, 3008, 3009]) {
      if (await isPortOpen(port))
        throw Error(
          `Recorder viewer port ${port} is active. Finalize the MCP session first.`,
        );
    }
    const envFile = join(root, ".env");
    const accepted =
      existsSync(envFile) &&
      /^\s*EULA\s*=\s*["']?TRUE["']?\s*$/m.test(readFileSync(envFile, "utf8"));
    if (process.env.EULA !== "TRUE" && !accepted)
      throw Error(
        "Accept the Minecraft EULA with EULA=TRUE. No server or data changed.",
      );
  },
});
console.log(
  "Verified fresh world configuration, generator, seed and empty player data:",
  result,
);
