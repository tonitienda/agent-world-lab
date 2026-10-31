import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, resolveMoves, step, type Action, type Pos } from "../src/index.js";

const p = (x: number, y: number): Pos => ({ x, y });

test("two players entering the same cell at once both bounce", () => {
  assert.deepEqual(resolveMoves([p(1, 1), p(3, 1)], [p(2, 1), p(2, 1)]), [p(1, 1), p(3, 1)]);
});

test("contests are bounces when within the window, and won by a clear lead", () => {
  const from = [p(1, 1), p(3, 1)], to = [p(2, 1), p(2, 1)];
  assert.deepEqual(resolveMoves(from, to, [1000, 1150], 200), from);
  assert.deepEqual(resolveMoves(from, to, [1000, 1200], 200), [p(2, 1), p(3, 1)]);
  assert.deepEqual(resolveMoves(from, to, [1300, 1000], 200), [p(1, 1), p(2, 1)]);
  assert.deepEqual(resolveMoves(from, to, [1000, undefined], 200), from, "missing timing means a bounce");
});

test("a three-way contest needs a lead over every rival", () => {
  const from = [p(1, 2), p(3, 2), p(2, 1)], to = [p(2, 2), p(2, 2), p(2, 2)];
  assert.deepEqual(resolveMoves(from, to, [0, 500, 100], 200), from);
  assert.deepEqual(resolveMoves(from, to, [0, 500, 300], 200), [p(2, 2), p(3, 2), p(2, 1)]);
});

test("solid players cannot swap or enter a standing player's cell", () => {
  assert.deepEqual(resolveMoves([p(1, 1), p(2, 1)], [p(2, 1), p(1, 1)]), [p(1, 1), p(2, 1)]);
  assert.deepEqual(resolveMoves([p(1, 1), p(2, 1)], [p(2, 1), null]), [p(1, 1), p(2, 1)]);
});

test("following into a vacated cell works, and blocking propagates down the line", () => {
  assert.deepEqual(resolveMoves([p(1, 1), p(2, 1)], [p(2, 1), p(3, 1)]), [p(2, 1), p(3, 1)]);
  // The leader bounces off a third player, so the follower is blocked too.
  assert.deepEqual(
    resolveMoves([p(1, 1), p(2, 1), p(3, 2)], [p(2, 1), p(3, 1), p(3, 1)]),
    [p(1, 1), p(2, 1), p(3, 2)],
  );
});

test("the result does not depend on player order", () => {
  const from = [p(1, 1), p(2, 1), p(3, 2), p(5, 5)], to = [p(2, 1), p(3, 1), p(3, 1), p(5, 6)];
  const forward = resolveMoves(from, to);
  const reversed = resolveMoves([...from].reverse(), [...to].reverse()).reverse();
  assert.deepEqual(forward, reversed);
});

test("step reports bumps and uses timing to break contests", () => {
  const s = createMatch({ seed: 1, rules: { players: 2, crateDensity: 0, suddenDeathTick: null } });
  s.players[0].pos = p(1, 1);
  s.players[1].pos = p(3, 1);
  const actions: Action[] = ["right", "left"];
  const bounce = step(s, actions);
  assert.deepEqual(bounce.state.players.map((pl) => pl.pos), [p(1, 1), p(3, 1)]);
  assert.equal(bounce.events.filter((e) => e.type === "bumped").length, 2);
  const timed = step(s, actions, { timing: [5000, 4000] });
  assert.deepEqual(timed.state.players.map((pl) => pl.pos), [p(1, 1), p(2, 1)]);
});
