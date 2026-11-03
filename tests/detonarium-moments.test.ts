import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatch, step, type Action, type Frame, type MatchState } from "../packages/detonarium/src/index.js";
import { DetonariumSession, type CallRecord } from "../src/detonarium/session.js";
import { findMoments, findMomentsInFrames } from "../src/detonarium/moments.js";

const rules = { width: 7, height: 7, players: 2, crateDensity: 0, suddenDeathTick: null };

function play(start: MatchState, script: Action[][]): Frame[] {
  const frames: Frame[] = [{ state: start, events: [] }];
  let state = start;
  for (const actions of script) {
    if (state.over) break;
    const result = step(state, actions);
    frames.push(result);
    state = result.state;
  }
  return frames;
}

test("a trapped rival is a kill moment decided at the bomb placement", () => {
  const s = createMatch({ seed: 1, rules });
  const w = s.rules.width;
  // Rival boxed in at (1, 3): crates below and to the right, the agent's blast from above.
  s.players[1].pos = { x: 1, y: 3 };
  s.cells[4 * w + 1] = "crate";
  s.cells[3 * w + 2] = "crate";
  const script: Action[][] = [["bomb", "stay"], ["right", "stay"], ["right", "stay"], ["down", "stay"], ...Array(6).fill(["stay", "stay"])];
  const calls: CallRecord[] = [
    { tool: "place_bomb", args: {}, intention: "box it in", rationale: "Its only way out runs through my blast.", tickStart: 0, tickEnd: 1, stoppedBecause: "done" },
    { tool: "move_to", args: { x: 3, y: 2 }, intention: "duck behind the pillar", tickStart: 1, tickEnd: 4, stoppedBecause: "arrived" },
    { tool: "wait", args: { ticks: 6 }, intention: "wait for it", tickStart: 4, tickEnd: 10, stoppedBecause: "done" },
  ];
  const moments = findMomentsInFrames(play(s, script), ["Claude", "passive 1"], calls);
  const kill = moments.find((m) => m.kind === "kill");
  assert.ok(kill, JSON.stringify(moments.map((m) => m.summary)));
  assert.deepEqual(kill.victims, [1]);
  assert.equal(kill.decisionTick, 1);
  assert.equal(kill.payoffTick, s.rules.fuse);
  assert.equal(kill.call?.tool, "place_bomb");
  assert.equal(kill.call?.rationale, "Its only way out runs through my blast.");
  assert.ok(!moments.some((m) => m.kind === "death"));
});

test("standing on your own bomb is a death moment decided at the placement", () => {
  const s = new DetonariumSession({ seed: 1, bots: ["passive"], agentName: "Claude", rules });
  s.placeBomb("oops");
  s.wait(10, "admire it");
  const death = findMoments(s.replay, s.calls).find((m) => m.kind === "death");
  assert.ok(death);
  assert.equal(death.decisionTick, 1);
  assert.equal(death.call?.intention, "oops");
  assert.match(death.summary, /its own bomb/);
});
