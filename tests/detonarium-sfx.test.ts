import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, type Frame, type MatchEvent } from "../packages/detonarium/src/index.js";
import { soundCues, SFX_KINDS, synthesizeEffect, pcmWav, mixEffects } from "../src/detonarium/sfx.js";
import { flowTimeline } from "../src/detonarium/flow-timeline.js";

const frames = (events: MatchEvent[]): Frame[] => [[], [], events, []].map((events) => ({ state: createMatch({ seed: 1 }), events }));
const explosion = { type: "exploded", owner: 1, pos: { x: 3, y: 3 }, cells: [] } as const;

test("effects use the first visible animation frame, and holds never retrigger them", () => {
  const fs = frames([{ ...explosion, cells: [] }, { type: "collapse", pos: { x: 5, y: 5 } }]);
  const clock = [0, 1, 1, 1, 1.2, 1.4, 1.8, 2, 2, 2, 3].map((tau) => ({ tau, s: 1 }));
  const cues = soundCues(fs, clock, 10, 1);
  assert.equal(cues.filter((c) => c.kind === "explosion").length, 1);
  assert.equal(cues.find((c) => c.kind === "explosion")!.frame, 4);
  assert.equal(cues.find((c) => c.kind === "collapse")!.frame, 7, "the thud waits until the falling block reaches the floor");
});

test("longer replacement narration moves event sounds with the replay, not a raw tick conversion", () => {
  const fs = frames([{ ...explosion, cells: [] }]);
  const make = (seconds: number) => soundCues(fs, flowTimeline([{ tick: 0, seconds, role: "decision" }], 3, 30, () => 6), 30, 6).find((c) => c.kind === "explosion")!;
  const short = make(2), long = make(8);
  assert.ok(long.frame > short.frame + 30);
  assert.notEqual(long.time, 2 / 6);
});

test("chains are grouped without losing identities, while an elimination remains a separate cue", () => {
  const cues = soundCues(frames([{ ...explosion, cells: [] }, { ...explosion, cells: [], owner: 2 }, { type: "eliminated", player: 2, by: [1, 2], pos: { x: 3, y: 3 } }]), [0, .5, 1, 1.5, 2, 3].map((tau) => ({ tau, s: 1 })), 30, 1);
  assert.equal(cues.filter((c) => c.kind === "explosion").length, 1);
  assert.equal(cues.find((c) => c.kind === "explosion")!.eventIds.length, 2);
  assert.equal(cues.filter((c) => c.kind === "elimination").length, 1);
});

test("slow-motion transitions ignore holds and use hysteresis", () => {
  const rates = [...Array(6).fill(6), ...Array(6).fill(.8), ...Array(8).fill(0), ...Array(6).fill(.8), ...Array(6).fill(6)];
  let tau = 0;
  const clock = rates.map((s) => ({ tau: tau += s / 10, s }));
  const cues = soundCues([], clock, 10, 6);
  assert.deepEqual(cues.map((c) => c.kind), ["slow-in", "slow-out"]);
  assert.deepEqual(cues.map((c) => c.frame), [6, 26]);
  const tiny = [6, .8, ...Array(30).fill(0), 6, 6].map((s, i) => ({ tau: i, s }));
  assert.deepEqual(soundCues([], tiny, 30, 6), [], "held frames do not count as sustained slow playback");
});

test("original sounds are deterministic, bounded, non-silent WAVs and overlapping stems do not clip", () => {
  for (const kind of SFX_KINDS) {
    const samples = synthesizeEffect(kind);
    assert.deepEqual(samples, synthesizeEffect(kind));
    assert.ok(samples.some((s) => Math.abs(s) > .05));
    assert.ok(samples.every((s) => Number.isFinite(s) && Math.abs(s) <= 1));
    const wav = pcmWav(samples);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(40), samples.length * 2);
  }
  const cue = { kind: "explosion" as const, frame: 0, time: 0, tick: 1, eventIds: ["1:0:exploded"], gain: 1 };
  const mix = mixEffects(Array(10).fill(cue), 1);
  assert.equal(mix.samples.length, 48000);
  assert.ok(mix.samples.every((s) => Math.abs(s) <= .500001));
  assert.throws(() => soundCues([], [{ tau: 2, s: 1 }, { tau: 1, s: 1 }], 30, 6), /Invalid sound clock/);
});

test("a collapse elimination lands with the stone on a stretched replay tick", () => {
  const pos = { x: 3, y: 1 };
  const cues = soundCues(frames([
    { type: "collapse", pos },
    { type: "eliminated", player: 0, by: "collapse", pos },
  ]), [0, 1, 1.05, 1.4, 1.8, 1.97, 1.99, 2, 3].map(tau => ({ tau, s: 1 })), 60, 5);
  const impacts = cues.filter(cue => cue.kind === "collapse" || cue.kind === "elimination");
  assert.deepEqual(impacts.map(cue => [cue.kind, cue.frame]), [["collapse", 6], ["elimination", 6]]);
});
