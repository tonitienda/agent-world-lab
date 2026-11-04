import { test } from "node:test";
import assert from "node:assert/strict";
import { cardTiming } from "../src/detonarium/card-timing.js";

test("cards retain global audio IDs and fit all measured speech with breathing room", () => {
  const result = cardTiming([{ line: 40, audio: "40_Chapter_1.wav", seconds: 6.123 + 0.8 }, { line: 41, audio: "41_Chapter_1.wav", seconds: 3.234 + 0.8 }], 30);
  assert.deepEqual(result.voices.map((v) => v.line), [40, 41]);
  assert.equal(result.voices[0].at, 0.25);
  assert.ok(result.voices[1].at - (result.voices[0].at + 6.123) >= 0.25);
  assert.ok(result.frames / 30 - (result.voices[1].at + 3.234) >= 0.3);
});

test("silent cards last three seconds and invalid durations fail", () => {
  assert.deepEqual(cardTiming([], 30), { frames: 90, voices: [] });
  assert.throws(() => cardTiming([], 0), /fps/);
  for (const seconds of [0, NaN, Infinity]) assert.throws(() => cardTiming([{ line: 1, audio: "1_Chapter_1.wav", seconds }], 30), /duration/);
});
