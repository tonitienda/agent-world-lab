import { test } from "node:test";
import assert from "node:assert/strict";
import { flowTimeline } from "../src/detonarium/flow-timeline.js";

test("speech stretches replay motion rather than adding whole-clip freezes", () => {
  const cue = { tick: 1, seconds: 5, role: "decision" as const, line: 4 };
  const shots = flowTimeline([cue], 4, 30, () => 6);
  const voiced = shots.filter((s) => s.speech);
  assert.equal(voiced.length, 150);
  assert.ok(voiced.filter((s) => s.freeze).length <= 20);
  assert.ok(voiced.filter((s) => s.s > 0).length > 120);
  assert.ok(shots.every((s, i) => !i || s.tau >= shots[i - 1].tau));
  assert.equal(shots.at(-1)!.tau, 4);
  assert.ok(voiced[7].tau < 2, "voice starts before the planned action completes");
});

test("same-tick observation and plan stay ordered, with no early outcome or rewind", () => {
  const cues = [{ tick: 5, seconds: 4, role: "outcome" as const, line: 29 }, { tick: 5, seconds: 3, role: "decision" as const, line: 30 }, { tick: 9, seconds: 2, role: "decision" as const, line: 32 }];
  const shots = flowTimeline(cues, 12, 30, () => 6);
  assert.ok(shots.every((s, i) => !i || s.tau >= shots[i - 1].tau));
  assert.ok(shots.filter((s) => s.speech?.line === 29).every((s) => s.tau >= 5));
  const plan = shots.find((s) => s.speech?.line === 30)!;
  assert.ok(plan.tau < 6, "plan precedes the completion of its first tick");
  for (const cue of cues) assert.ok(shots.filter((s) => s.speech === cue).length >= cue.seconds * 30);
});

test("end-of-match speech holds only when no real source motion remains", () => {
  const cue = { tick: 4, seconds: 2, role: "outcome" as const };
  const shots = flowTimeline([cue], 4, 30, () => 6);
  assert.ok(shots.filter((s) => s.speech).every((s) => s.tau === 4 && s.freeze));
});
