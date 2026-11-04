import { test } from "node:test";
import assert from "node:assert/strict";
import { gameNarration, type NarrationCue } from "../src/detonarium/narration.js";

const cue = (line: number, tick: number, game = 1): NarrationCue => ({ line, tick, game, text: `Line ${line}`, audio: `${line}_Chapter_1.wav`, seconds: 2, role: "decision" });

test("narration keeps same-tick speech ordered, includes first/last states, excludes other games", () => {
  const input = [cue(3, 260), cue(1, 0), cue(2, 0), cue(4, 0, 2)];
  assert.deepEqual(gameNarration(input, 1, 260).map((c) => c.line), [1, 2, 3]);
  assert.deepEqual(input.map((c) => c.line), [3, 1, 2, 4]);
});

test("narration rejects missing games, out-of-replay cues and invalid speech durations", () => {
  assert.throws(() => gameNarration([cue(1, 0)], 2, 260), /No narration/);
  for (const tick of [-1, 261, 1.5]) assert.throws(() => gameNarration([cue(1, tick)], 1, 260), /Invalid narration/);
  for (const seconds of [0, -1, Infinity, NaN]) assert.throws(() => gameNarration([{ ...cue(1, 0), seconds }], 1, 260), /Invalid narration/);
});
