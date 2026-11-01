// Record a chess replay as an MP4. Needs rsvg-convert and ffmpeg on PATH.
// Usage:
//   tsx examples/record.ts <outDir> [replay.json]          record an existing replay (e.g. a Claude game)
//   tsx examples/record.ts <outDir> --engines 1500,2000    play Stockfish vs Stockfish first (white,black Elo)
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { playEngines, renderFrame, replayPositions, type ChessReplay } from "../src/index.js";

const run = promisify(execFile);
const FPS = 30;
const MOVE_SECONDS = 0.4;
const HOLD_SECONDS = 0.8;
const HOLD_START_SECONDS = 1.5;
const HOLD_END_SECONDS = 4;

const outDir = process.argv[2] ?? "out";
const source = process.argv[3];
let replay: ChessReplay;
if (source === "--engines") {
  const [w, b] = (process.argv[4] ?? "1500,2000").split(",").map(Number);
  console.log(`Playing Stockfish ${w} (white) vs Stockfish ${b} (black)…`);
  replay = await playEngines({ white: { elo: w }, black: { elo: b } });
} else if (source) {
  replay = JSON.parse(readFileSync(source, "utf8"));
} else throw Error("Pass a replay.json or --engines <whiteElo,blackElo>");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "replay.json"), JSON.stringify(replay, null, 2));
const positions = replayPositions(replay);
const title = process.env.CHESS_TITLE ?? "Episode 003 · Chess";

/** Every video frame as (plies applied, progress through the last one). */
const timeline: { ply: number; t: number }[] = [];
const hold = (ply: number, seconds: number) => { for (let k = 0; k < seconds * FPS; k++) timeline.push({ ply, t: 1 }); };
hold(0, HOLD_START_SECONDS);
for (let ply = 1; ply <= replay.moves.length; ply++) {
  const slide = Math.round(MOVE_SECONDS * FPS);
  for (let j = 1; j <= slide; j++) timeline.push({ ply, t: j / slide });
  hold(ply, ply === replay.moves.length ? HOLD_END_SECONDS : HOLD_SECONDS);
}

const started = Date.now();
const dir = join(outDir, "frames");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
let next = 0;
const worker = async () => {
  for (let k = next++; k < timeline.length; k = next++) {
    const { ply, t } = timeline[k];
    const caption = ply > 0 ? replay.moves[ply - 1].intention : undefined;
    const svgPath = join(dir, `${String(k).padStart(5, "0")}.svg`);
    writeFileSync(svgPath, renderFrame(replay, { ply, t, positions, title, caption }));
    await run("rsvg-convert", ["-o", svgPath.replace(/svg$/, "png"), svgPath]);
  }
};
await Promise.all(Array.from({ length: availableParallelism() }, worker));
const video = join(outDir, "board.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%05d.png"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", video]);
rmSync(dir, { recursive: true });
const result = replay.result;
console.log(`${replay.moves.length} plies, ${result ? `${result.winner ?? "draw"} (${result.termination})` : "unfinished"}`);
console.log(`${video} (${timeline.length} frames, ${((Date.now() - started) / 1000).toFixed(0)} s)`);
