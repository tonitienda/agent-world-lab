import mineflayer, { type Bot } from "mineflayer";
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { acquireLock } from "../src/session/lock.js";
import { prepareRavine, verifyBotRavine, waitUntil, agentName, RAVINE, ravineCuboids, fillCommands, ravineBriefing, readRavineManifest, type RavineManifest } from "../src/environments/minecraft/ravine.js";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (["--yes", "--verify-only", "--briefing"].includes(args[i])) continue;
  if (args[i] !== "--agent" || !args[i + 1] || args[i + 1].startsWith("--")) throw Error("Usage: scenario:ravine -- [--yes | --verify-only | --briefing] [--agent NAME]");
  i++;
}
if (args.filter(a => ["--yes", "--verify-only", "--briefing"].includes(a)).length > 1) throw Error("Choose one scenario mode");
const agent = agentName(args.includes("--agent") ? args[args.indexOf("--agent") + 1] : process.env.AGENT_ID ?? "emergent-002");
const file = resolve(root, "data/minecraft/scenario.json");
const readWorld = () => JSON.parse(readFileSync(resolve(root, "data/minecraft/world-config.json"), "utf8")) as { seed: string; verifiedAt: string; preset: string };
if (args.includes("--briefing")) {
  readRavineManifest(file, readWorld(), agent);
  console.log(ravineBriefing());
} else if (!args.includes("--yes") && !args.includes("--verify-only")) {
  console.log("Dry run: constructed ravine course. --yes builds the defined course, fixes daylight/weather/spawning, and resets the selected player's starting state.");
  console.log(ravineBriefing());
  console.log(ravineCuboids().flatMap(fillCommands).join("\n"));
} else {
  const world = readWorld();
  if (process.env.RECORD_MP4) throw Error("Unset RECORD_MP4 during scenario setup/verification");
  if (world.preset !== "survival") throw Error("Ravine setup requires a verified survival reset");
  if (process.env.MC_HOST && !["127.0.0.1", "localhost"].includes(process.env.MC_HOST) || process.env.MC_PORT && process.env.MC_PORT !== "25565") throw Error("This setup targets the local Compose server on port 25565 only");
  const release = acquireLock("ravine setup/verification");
  let bot: Bot | undefined;
  try {
    if (args.includes("--verify-only")) readRavineManifest(file, world, agent);
    else if (existsSync(file)) unlinkSync(file); // An interrupted rebuild must not leave a valid old manifest.
    const exec = promisify(execFile);
    bot = mineflayer.createBot({host:"127.0.0.1",port:25565,username:agent,auth:"offline"});
    const connected = bot;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Scenario bot spawn timed out")), 60000);
      connected.once("spawn", () => {clearTimeout(timer);resolve();});
      connected.once("error", error => {clearTimeout(timer);reject(error);});
      connected.once("end", () => {clearTimeout(timer);reject(Error("Disconnected during scenario startup"));});
    });
    bot.on("error", error => console.error("Scenario bot:", error));
    if (args.includes("--yes")) {
      await prepareRavine(bot, async text => {
        await exec("docker", ["compose","exec","-T","--user","1000","minecraft","mc-send-to-console",text], {cwd:root,timeout:10000});
      });
      const manifest: RavineManifest = {id:RAVINE.id,agent,verifiedAt:new Date().toISOString(),world:{seed:world.seed,verifiedAt:world.verifiedAt},course:RAVINE};
      writeFileSync(file + ".tmp", JSON.stringify(manifest,null,2)+"\n");
      renameSync(file + ".tmp",file);
    } else await waitUntil(() => verifyBotRavine(connected), 30000);
    console.log("PASS: course blocks, gap, gold marker, wood, starting position, facing, survival mode, health, food and empty inventory verified.");
  } finally {
    if (bot) {
      const connected = bot;
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {connected.end();resolve();}, 3000);
        connected.once("end", () => {clearTimeout(timer);resolve();});
        connected.quit();
      });
    }
    release();
  }
}
