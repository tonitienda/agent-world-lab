// Play a bot match and record it as MP4s: the whole board plus a follow camera per player.
// Needs rsvg-convert and ffmpeg on PATH.
// Usage: tsx examples/record.ts [seed] [outDir] [kinds, comma separated] [ticks per second]
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { playBots, renderSvg, replayFrames, type BotKind, type View } from "../src/index.js";

const run = promisify(execFile);
const seed = Number(process.argv[2] ?? 1);
const outDir = process.argv[3] ?? "out";
const kinds = (process.argv[4] ?? "hunter,hunter").split(",") as BotKind[];
const tps = Number(process.argv[5] ?? 5);
const FPS = 30;
const HOLD_START_SECONDS = 1;
const HOLD_END_SECONDS = 2;
if (!Number.isInteger(FPS / tps)) throw new Error(`ticks per second must divide ${FPS}`);
const sub = FPS / tps;

const replay = playBots(kinds, seed);
const frames = replayFrames(replay);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "replay.json"), JSON.stringify(replay));

/** Every video frame as (replay frame, progress through its tick). */
const timeline: { n: number; t: number; settled: boolean }[] = [];
for (let k = 0; k < HOLD_START_SECONDS * FPS; k++) timeline.push({ n: 0, t: 1, settled: true });
for (let n = 1; n < frames.length; n++) for (let j = 1; j <= sub; j++) timeline.push({ n, t: j / sub, settled: false });
for (let k = 0; k < HOLD_END_SECONDS * FPS; k++) timeline.push({ n: frames.length - 1, t: 1, settled: true });

const cameras: { name: string; view: View; cell: number }[] = [
  { name: "observer", view: { kind: "board" }, cell: 96 },
  ...kinds.map((_, i) => ({ name: `follow-${i + 1}`, view: { kind: "follow", player: i, radius: 3 } as View, cell: 144 })),
];

for (const camera of cameras) {
  const started = Date.now();
  const dir = join(outDir, `frames-${camera.name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  let next = 0;
  const worker = async () => {
    for (let k = next++; k < timeline.length; k = next++) {
      const { n, t, settled } = timeline[k];
      const svgPath = join(dir, `${String(k).padStart(5, "0")}.svg`);
      writeFileSync(svgPath, renderSvg(frames[n].state, { cell: camera.cell, view: camera.view, events: settled ? [] : frames[n].events, t }));
      await run("rsvg-convert", ["-o", svgPath.replace(/svg$/, "png"), svgPath]);
    }
  };
  await Promise.all(Array.from({ length: availableParallelism() }, worker));
  const video = join(outDir, `${camera.name}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%05d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", video]);
  rmSync(dir, { recursive: true });
  console.log(`${camera.name}: ${video} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}
const end = frames.at(-1)!.events.find((e) => e.type === "match_over");
console.log(`${replay.ticks.length} ticks, ${end && end.type === "match_over" ? `winner ${end.winner === null ? "none" : replay.players[end.winner].name} (${end.reason})` : "unfinished"}`);
