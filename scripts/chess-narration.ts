// Turn a recorded chess video's narration.json into the episode's voice script: a presenter line over
// the intro and outro cards, and the agent's own words at each cue. One line per WAV, numbered for
// production/public/<episode>/audio/<line>_Chapter_1.wav.
// Usage: tsx scripts/chess-narration.ts <video dir> <production dir>   (reads replay.json + narration.json)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_PACING, type ChessReplay, type NarrationCue, type Termination } from "../packages/chess/src/index.js";

type Slot = { start: number; duration: number };
export type Narration = { duration: number; intro: Slot; outro: Slot; cues: NarrationCue[] };
export type ScriptLine = {
  line: number;
  voice: "presenter" | "agent";
  /** Seconds into board.mp4 where the line starts, and the time it has before the next beat. */
  at: number;
  slot: number;
  ply: number | null;
  kind: "intro" | "outro" | NarrationCue["kind"];
  text: string;
  audio: string;
};

const TERMINATIONS: Record<Termination, string> = {
  checkmate: "checkmate", stalemate: "stalemate", resignation: "resignation", "move-limit": "the move limit",
  "insufficient-material": "insufficient material", "threefold-repetition": "repetition", "fifty-move-rule": "the fifty-move rule",
  "illegal-move-forfeit": "forfeit, after too many illegal moves",
};

export function presenterLines(replay: ChessReplay): { intro: string; outro: string } {
  const sides = ["white", "black"] as const;
  const agent = sides.find((s) => replay.players[s].kind === "agent");
  const other = agent === "white" ? "black" : "white";
  const name = agent ? replay.players[agent].label : replay.players.white.label;
  const rival = agent ? replay.players[other].label : replay.players.black.label;
  const intro = agent
    ? `${name} versus ${rival}. No list of legal moves, just the board.`
    : `${replay.players.white.label} plays ${replay.players.black.label}.`;
  const moves = Math.ceil(replay.moves.length / 2);
  const tried = agent ? replay.illegal.filter((a) => a.side === agent).length : 0;
  const result = replay.result;
  const how = result ? TERMINATIONS[result.termination] : null;
  const verdict = !result ? `The game stopped after ${moves} moves.`
    : result.winner ? `${replay.players[result.winner].label} wins by ${how} after ${moves} moves.`
    : `A draw by ${how} after ${moves} moves.`;
  const outro = agent ? `${verdict} Along the way, it tried ${tried} illegal move${tried === 1 ? "" : "s"}.` : verdict;
  return { intro, outro };
}

export function narrationScript(replay: ChessReplay, narration: Narration): ScriptLine[] {
  const { intro, outro } = presenterLines(replay);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const lines: Omit<ScriptLine, "line" | "audio">[] = [
    { voice: "presenter", at: r(narration.intro.start + 0.3), slot: r(narration.intro.duration - 0.3), ply: null, kind: "intro", text: intro },
    ...narration.cues.map((c) => ({ voice: "agent" as const, at: r(c.start), slot: r(c.duration), ply: c.ply, kind: c.kind, text: c.text })),
    { voice: "presenter", at: r(narration.outro.start + 0.3), slot: r(narration.outro.duration - 0.3), ply: null, kind: "outro", text: outro },
  ];
  return lines.map((l, i) => ({ line: i + 1, ...l, audio: `${i + 1}_Chapter_1.wav` }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [videoDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
  if (!videoDir || !outDir) throw Error("Usage: tsx scripts/chess-narration.ts <video dir> <production dir>");
  const replay = JSON.parse(readFileSync(join(videoDir, "replay.json"), "utf8")) as ChessReplay;
  const narration = JSON.parse(readFileSync(join(videoDir, "narration.json"), "utf8")) as Narration;
  const script = narrationScript(replay, narration);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "narration.txt"), script.map((l) => l.text.replace(/\s+/g, " ")).join("\n") + "\n");
  writeFileSync(join(outDir, "narration-manifest.json"), JSON.stringify(script, null, 2) + "\n");
  for (const l of script) {
    const needs = l.text.split(/\s+/).length / DEFAULT_PACING.wordsPerSecond;
    if (needs > l.slot) console.warn(`line ${l.line} needs ~${needs.toFixed(1)} s but has ${l.slot} s: ${l.text}`);
  }
  console.log(`${script.length} lines (${script.filter((l) => l.voice === "presenter").length} presenter) → ${outDir}`);
}
