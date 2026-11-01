import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStory, ChessMatch } from "../packages/chess/src/index.js";
import { narrationScript } from "../scripts/chess-narration.js";

test("the script brackets the agent's cues with presenter lines over the cards", () => {
  const match = new ChessMatch({ white: { id: "sf", kind: "engine", label: "Stockfish 1500" }, black: { id: "c", kind: "agent", label: "Claude" } });
  match.play("f3");
  match.play("e5", { intention: "Open the diagonal.", rationale: "Opening the diagonal lets my queen reach h4." });
  match.play("g4");
  match.play("Qh5");
  match.play("Qh4#", { intention: "Mate." });
  const replay = match.replay();
  const story = buildStory(replay, null);
  const outro = story.segments.at(-1)!;
  const script = narrationScript(replay, {
    duration: story.duration, intro: { start: 0, duration: story.segments[0].duration },
    outro: { start: story.duration - outro.duration, duration: outro.duration }, cues: story.cues,
  });
  assert.deepEqual(script.map((l) => [l.line, l.voice, l.kind, l.audio]), [
    [1, "presenter", "intro", "1_Chapter_1.wav"],
    [2, "agent", "rationale", "2_Chapter_1.wav"],
    [3, "agent", "intention", "3_Chapter_1.wav"],
    [4, "presenter", "outro", "4_Chapter_1.wav"],
  ]);
  assert.match(script[0].text, /Claude versus Stockfish 1500/);
  assert.equal(script[3].text, "Claude wins by checkmate after 2 moves. Along the way, it tried 1 illegal move.");
  assert.ok(script.every((l, i) => i === 0 || l.at >= script[i - 1].at + script[i - 1].slot - 1e-6), "lines never overlap");
});
