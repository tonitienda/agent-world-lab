// Record a chess replay as an MP4. Needs rsvg-convert and ffmpeg on PATH.
// Usage:
//   tsx examples/record.ts <outDir> [replay.json]          record an existing replay (e.g. a Claude game)
//   tsx examples/record.ts <outDir> --engines 1500,2000    play Stockfish vs Stockfish first (white,black Elo)
// Env: CHESS_TITLE, CHESS_CHANNEL (intro wordmark), CHESS_NEXT (outro hook), CHESS_ANALYSIS_DEPTH (default 18; 0 skips analysis).
// Writes board.mp4, replay.json, analysis.json (cached between runs) and narration.json (card and cue timestamps).
import { execFile, execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  analyseReplay, buildStory, playEngines, renderFrame, renderIntro, renderOutro, replayPositions,
  type Analysis, type ChessReplay,
} from "../src/index.js";

const run = promisify(execFile);
const FPS = 30;

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
const next = process.env.CHESS_NEXT;
const channel = process.env.CHESS_CHANNEL ?? "The Agent Terrarium";

// Analysis drives the win bar, callouts and pacing; reuse it while the game and depth are unchanged.
const depth = Number(process.env.CHESS_ANALYSIS_DEPTH ?? 18);
const analysisPath = join(outDir, "analysis.json");
let analysis: Analysis | null = null;
if (depth > 0) {
  const cached: Analysis | null = existsSync(analysisPath) ? JSON.parse(readFileSync(analysisPath, "utf8")) : null;
  if (cached && cached.depth === depth && cached.positions.length === positions.length) analysis = cached;
  else {
    console.log(`Analysing ${replay.moves.length} plies at depth ${depth}…`);
    analysis = await analyseReplay(replay, { depth });
    writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
  }
}

const story = buildStory(replay, analysis);
const outro = story.segments.at(-1)!;
writeFileSync(join(outDir, "narration.json"), JSON.stringify({
  duration: story.duration,
  intro: { start: 0, duration: story.segments[0].duration },
  outro: { start: story.duration - outro.duration, duration: outro.duration },
  cues: story.cues,
}, null, 2));

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const whiteWin = (ply: number, t: number) => {
  if (!analysis) return undefined;
  const to = analysis.positions[ply].white;
  if (ply === 0 || t >= 1) return to;
  const from = analysis.positions[ply - 1].white;
  return from + (to - from) * ease(t);
};

// Every frame's SVG; identical frames (most holds) are rendered once and hard-linked.
const svgs: string[] = [];
// Segment boundaries snap to frames on the cumulative clock, so narration cues stay in sync.
let elapsed = 0;
for (const seg of story.segments) {
  const first = Math.round(elapsed * FPS);
  elapsed += seg.duration;
  const n = Math.round(elapsed * FPS) - first;
  for (let k = 0; k < n; k++) {
    const clock = (first + k) / FPS;
    const progress = (k + 1) / n;
    if (seg.kind === "board") {
      const t = seg.animate ? progress : 1;
      svgs.push(renderFrame(replay, {
        ply: seg.ply, t, positions, title, caption: seg.caption, callout: seg.callout, calloutAge: k / FPS,
        illegal: seg.illegal, thinking: seg.thinking, clock, whiteWin: whiteWin(seg.ply, t),
      }));
    } else if (seg.kind === "intro") svgs.push(renderIntro(replay, { title, channel, t: progress }));
    else svgs.push(renderOutro(replay, analysis, { title, next, t: progress }));
  }
}

const started = Date.now();
const dir = join(outDir, "frames");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const framePath = (k: number) => join(dir, `${String(k).padStart(5, "0")}.png`);
const firstSeen = new Map<string, number>();
const unique: number[] = [];
svgs.forEach((svg, k) => { if (!firstSeen.has(svg)) (firstSeen.set(svg, k), unique.push(k)); });
let cursor = 0;
const worker = async () => {
  for (let i = cursor++; i < unique.length; i = cursor++) {
    const k = unique[i];
    const svgPath = framePath(k).replace(/png$/, "svg");
    writeFileSync(svgPath, svgs[k]);
    await run("rsvg-convert", ["-o", framePath(k), svgPath]);
    rmSync(svgPath);
  }
};
await Promise.all(Array.from({ length: availableParallelism() }, worker));
svgs.forEach((svg, k) => { const first = firstSeen.get(svg)!; if (first !== k) linkSync(framePath(first), framePath(k)); });

const video = join(outDir, "board.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%05d.png"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", video]);
rmSync(dir, { recursive: true });
const result = replay.result;
console.log(`${replay.moves.length} plies, ${result ? `${result.winner ?? "draw"} (${result.termination})` : "unfinished"}`);
console.log(`${video}: ${story.duration.toFixed(1)} s, ${svgs.length} frames (${unique.length} unique), ${story.cues.length} narration cues, ${((Date.now() - started) / 1000).toFixed(0)} s`);
