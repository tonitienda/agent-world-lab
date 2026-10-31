import { test } from "node:test";
import assert from "node:assert/strict";
import { createBot, createMatch, playBots, renderSvg, replayFrames, step, viewBox, viewerHtml } from "../src/index.js";

test("a replay rebuilds the same match as playing it directly", () => {
  const replay = playBots(["hunter", "wanderer", "hunter"], 5);
  let state = createMatch({ seed: 5, rules: { players: 3 } });
  const bots = ["hunter", "wanderer", "hunter"].map((kind, i) => createBot(kind as "hunter", i, 50 + i));
  while (!state.over) state = step(state, bots.map((bot) => bot(state))).state;
  const frames = replayFrames(JSON.parse(JSON.stringify(replay)));
  assert.equal(frames.length, replay.ticks.length + 1);
  assert.deepEqual(frames.at(-1)!.state, state);
});

test("frames render as SVG and follow views stay on the board", () => {
  const state = createMatch({ seed: 2 });
  const svg = renderSvg(state, { cell: 10 });
  assert.match(svg, /^<svg [^>]*viewBox="0 0 110 110"/);
  assert.equal((svg.match(/data-player=/g) ?? []).length, 4, "one body per player");
  assert.deepEqual(viewBox(state, { kind: "follow", player: 0, radius: 3 }, 10), [0, 0, 70, 70]);
  assert.deepEqual(viewBox(state, { kind: "follow", player: 1, radius: 3 }, 10), [40, 40, 70, 70]);
});

test("the viewer is one self-contained page", () => {
  const html = viewerHtml(playBots(["hunter", "hunter"], 1, { width: 7, height: 7 }));
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script src=|<link /);
});
