// Play a bot match and write replay.json + viewer.html.
// Usage: tsx examples/bot-replay.ts [seed] [outDir] [kinds, comma separated]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { playBots, viewerHtml, type BotKind } from "../src/index.js";

const seed = Number(process.argv[2] ?? 1);
const outDir = process.argv[3] ?? "out";
const kinds = (process.argv[4] ?? "hunter,hunter,wanderer,hunter").split(",") as BotKind[];

const replay = playBots(kinds, seed);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "replay.json"), JSON.stringify(replay));
writeFileSync(join(outDir, "viewer.html"), viewerHtml(replay));
console.log(`${replay.ticks.length} ticks → ${join(outDir, "viewer.html")}`);
