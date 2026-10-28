import mineflayer from "mineflayer";
import { createConnection } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MinecraftAdapter,
  minecraftCapabilities,
} from "../src/environments/minecraft/adapter.js";
import {
  worldSettings,
  verifyProperties,
  verifyLevelDat,
} from "../src/environments/minecraft/world-config.js";

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--exercise") continue;
  if (args[i] !== "--profile" || !args[i + 1])
    throw Error(`Unknown or incomplete option ${args[i]}`);
  i++;
}
const profile = args.includes("--profile")
  ? args[args.indexOf("--profile") + 1]
  : "survival";
if (!["survival", "superflat"].includes(profile))
  throw Error("Profile must be survival or superflat");
const root = resolve(import.meta.dirname, "..");
let failed = false;
function report(check: string, ok: boolean, detail: unknown) {
  console.log(JSON.stringify({ check, ok, detail }));
  if (!ok) failed = true;
}
report(
  "Node runtime",
  Number(process.versions.node.split(".")[0]) >= 22,
  process.version,
);
const expectedVersion = process.env.MC_VERSION ?? "1.21.4";
const versions = (
  mineflayer as typeof mineflayer & { testedVersions: string[] }
).testedVersions;
report(
  "Minecraft version in Mineflayer tested versions (static)",
  versions.includes(expectedVersion),
  { expectedVersion, latestTested: versions.at(-1) },
);
for (const name of ["mineflayer", "mineflayer-pathfinder"]) {
  const pkg = JSON.parse(
    readFileSync(resolve(root, "node_modules", name, "package.json"), "utf8"),
  );
  report(`installed ${name}`, true, {
    version: pkg.version,
    node: process.version,
  });
}
try {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "data/minecraft/world-config.json"), "utf8"),
  );
  if (manifest.preset !== profile)
    throw Error(`Expected ${profile}, recorded ${manifest.preset}`);
  verifyProperties(
    readFileSync(resolve(root, "data/minecraft/server.properties"), "utf8"),
    worldSettings(profile, manifest.seed),
  );
  await verifyLevelDat(
    resolve(root, "data/minecraft/world/level.dat"),
    worldSettings(profile, manifest.seed),
  );
  report("static configuration and actual generated overworld", true, manifest);
} catch (e) {
  report("static configuration", false, String(e));
}
report("registered adapter capabilities (static)", true, minecraftCapabilities);
const host = process.env.MC_HOST ?? "127.0.0.1",
  port = Number(process.env.MC_PORT ?? 25565);
const connected = await new Promise<boolean>((resolve) => {
  const socket = createConnection({ host, port });
  socket.setTimeout(2000);
  socket.once("connect", () => {
    socket.destroy();
    resolve(true);
  });
  socket.once("error", () => resolve(false));
  socket.once("timeout", () => {
    socket.destroy();
    resolve(false);
  });
});
report("TCP connectivity", connected, { host, port });
if (args.includes("--exercise") && connected) {
  if (process.env.RECORD_MP4)
    throw Error("Preflight must run with RECORD_MP4 unset");
  const world = new MinecraftAdapter();
  try {
    await world.connect();
    report(
      "live protocol, chunks, pathfinder, observation initialization",
      true,
      await world.observe(),
    );
    const recipe = await world.act("recipes", { item: "wooden_pickaxe" });
    report("live recipe registry", recipe.ok, recipe);
    report(
      "live inventory and equipment",
      (await world.act("equipment", {})).ok,
      await world.act("inventory", {}),
    );
  } catch (e) {
    report("live initialization", false, String(e));
  } finally {
    await world.close();
  }
}
console.log(
  "Static checks and TCP connectivity do not exercise survival mechanics. --exercise logs in and inspects only; run survival integration in a disposable fixture to exercise mutations. Spawn/resources and challenge success are not guaranteed.",
);
process.exitCode = failed ? 1 : 0;
