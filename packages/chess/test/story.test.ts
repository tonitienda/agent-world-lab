import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStory, ChessMatch, DEFAULT_PACING, illegalOrigins, renderFrame, renderIntro, renderOutro, targetSquare,
  type Analysis, type PlayerInfo,
} from "../src/index.js";

const white: PlayerInfo = { id: "sf", kind: "engine", label: "Stockfish 1500" };
const black: PlayerInfo = { id: "claude", kind: "agent", label: "Claude" };

/** Fool's mate with the agent on black: one rejected move, then mate. */
function foolsMate() {
  const match = new ChessMatch({ white, black });
  match.play("f3");
  match.play("e5", { intention: "Open the diagonal for my queen." });
  match.play("g4");
  match.play("Qh5", { intention: "Queen to h5." });
  match.play("Qh4#", { intention: "Queen to h4 is mate: the king has no squares left." });
  return match.replay();
}

const analysis: Analysis = {
  version: 1, engine: "test", depth: 1,
  positions: [50, 50, 48, 2, 0].map((white) => ({ score: { cp: 0 }, white })),
  moves: [
    { loss: 0, grade: "best", best: "e2e4" },
    { loss: 2, grade: "best", best: "e7e5" },
    { loss: 46, grade: "blunder", best: "d2d4" },
    { loss: 0, grade: "best", best: "d8h4" },
  ],
};

test("the story opens and closes on cards and sums to its duration", () => {
  const story = buildStory(foolsMate(), analysis);
  assert.equal(story.segments[0].kind, "intro");
  assert.equal(story.segments.at(-1)!.kind, "outro");
  const total = story.segments.reduce((s, seg) => s + seg.duration, 0);
  assert.ok(Math.abs(total - story.duration) < 1e-9);
});

test("turning points get callouts and slow motion, quiet moves play fast", () => {
  const story = buildStory(foolsMate(), analysis);
  const board = story.segments.filter((s) => s.kind === "board");
  const slide = (ply: number) => board.find((s) => s.ply === ply && s.animate)!;
  const hold = (ply: number) => board.find((s) => s.ply === ply && !s.animate && !s.thinking && s.duration !== 2)!;
  assert.equal(slide(1).duration, DEFAULT_PACING.quietSlide);
  assert.equal(hold(1).callout, undefined);
  assert.deepEqual(hold(3).callout, { text: "Blunder by Stockfish 1500!", tone: "alert" });
  assert.equal(slide(3).duration, DEFAULT_PACING.keySlide);
  assert.deepEqual(hold(4).callout, { text: "Checkmate! Claude wins", tone: "highlight" });
});

test("rejected moves are shown before the move, and key agent moves are narrated", () => {
  const replay = foolsMate();
  const story = buildStory(replay, analysis);
  const rejected = story.segments.find((s) => s.kind === "board" && s.illegal);
  assert.ok(rejected && rejected.kind === "board");
  assert.deepEqual(rejected.illegal, { input: "Qh5", square: "h5", index: 0, from: ["d8"] });
  assert.equal(rejected.ply, 3, "position before the attempted move");
  // Only the mating move is key for the agent; e5 was quiet, so it is not voiced.
  assert.deepEqual(story.cues.map((c) => c.ply), [4]);
  let clock = 0;
  for (const seg of story.segments) {
    if (seg.kind === "board" && seg.caption && !seg.animate && seg.thinking) break;
    clock += seg.duration;
  }
  assert.ok(Math.abs(story.cues[0].start - clock) < 1e-9, "cue starts with its narration segment");

  const frame = renderFrame(replay, { ply: 3, t: 1, illegal: rejected.illegal, thinking: "black", clock: 0.7, whiteWin: 2 });
  assert.match(frame, /1 illegal/);
  assert.match(frame, /thinking\.\./);
  assert.match(renderFrame(replay, { ply: 2, t: 1 }), /0 illegal/);
});

test("illegalOrigins points at the piece a rejected move meant", () => {
  // Rook on e1 behind its own bishop on e3: the blocked rook, not the a1 rook, is the suspect.
  const blocked = "2kr3r/p1p2p2/2pb3p/6p1/3P3n/2P1BP2/PP1N1P1P/R3R1K1 w - - 0 23";
  assert.deepEqual(illegalOrigins(blocked, "Re6"), ["e1"]);
  // Both rooks reach c1: ambiguous SAN highlights both; disambiguation narrows it.
  assert.deepEqual(illegalOrigins(blocked, "Rc1+").sort(), ["a1", "e1"]);
  assert.deepEqual(illegalOrigins(blocked, "Rac1"), ["a1"]);
  assert.deepEqual(illegalOrigins(blocked, "e1e6"), ["e1"], "UCI names its origin");
  assert.deepEqual(illegalOrigins(blocked, "dxe5"), ["d4"], "pawn captures use the file");
  assert.deepEqual(illegalOrigins(blocked, "e2e4"), [], "no own piece on the origin");
  assert.deepEqual(illegalOrigins(blocked, "hello"), []);
});

test("targetSquare reads the destination from SAN or UCI", () => {
  assert.equal(targetSquare("Rxe6+"), "e6");
  assert.equal(targetSquare("e7e8q"), "e8");
  assert.equal(targetSquare("O-O"), null);
});

test("cards name the players, the result and the stats", () => {
  const replay = foolsMate();
  assert.match(renderIntro(replay), /Stockfish 1500.*Claude|Claude.*Stockfish 1500/s);
  assert.match(renderIntro(replay), /average club player/);
  const outro = renderOutro(replay, analysis, { next: "Next: Stockfish 2000" });
  assert.match(outro, /Claude wins by checkmate/);
  assert.match(outro, /Next: Stockfish 2000/);
  assert.match(outro, /<polyline/);
});
