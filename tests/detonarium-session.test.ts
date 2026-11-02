import assert from "node:assert/strict";
import { test } from "node:test";
import { replayFrames } from "../packages/detonarium/src/index.js";
import { AGENT, DetonariumSession } from "../src/detonarium/session.js";

const session = (bots = ["passive", "passive", "passive"] as const) =>
  new DetonariumSession({ seed: 7, bots: [...bots], agentName: "Claude" });

test("observe shows the full board with the agent in the top-left corner", () => {
  const s = session();
  const view = s.observe();
  assert.equal(view.tick, 0);
  assert.equal(view.board.length, 12); // header + 11 rows
  assert.equal(view.board[2][4], "A"); // row y=1, column x=1 (3-char row prefix)
  assert.deepEqual(view.you.pos, { x: 1, y: 1 });
  assert.equal(view.rivals.length, 3);
  assert.equal(view.result, null);
});

test("the world is frozen between calls and advances only inside a macro", () => {
  const s = session();
  s.observe();
  s.observe();
  assert.equal(s.state.tick, 0);
  const r = s.wait(3, "waiting");
  assert.equal(r.ticks, 3);
  assert.equal(s.state.tick, 3);
  assert.equal(s.replay.ticks.length, 3);
});

test("move_to walks to a reachable cell and reports arrival", () => {
  const s = session();
  const r = s.moveTo({ x: 2, y: 1 }, "one step right");
  assert.equal(r.stoppedBecause, "arrived");
  assert.equal(r.ticks, 1);
  assert.deepEqual(s.state.players[AGENT].pos, { x: 2, y: 1 });
});

test("move_to into a wall is unreachable and spends no ticks", () => {
  const s = session();
  const r = s.moveTo({ x: 0, y: 0 }, "into the wall");
  assert.equal(r.stoppedBecause, "unreachable");
  assert.equal(r.ticks, 0);
  assert.equal(r.ok, false);
  assert.equal(s.state.tick, 0);
});

test("a bomb explodes after the fuse and standing on it eliminates the agent", () => {
  const s = session();
  const placed = s.placeBomb("test bomb");
  assert.equal(placed.ticks, 1);
  assert.equal(placed.view.bombs.length, 1);
  const r = s.wait(20, "stand still");
  assert.equal(r.stoppedBecause, "eliminated");
  assert.ok(r.happened.some((line) => line.includes("your own bomb")));
  s.finishWithoutAgent();
  assert.ok(s.state.over);
});

test("a second bomb beyond capacity is refused without spending a tick", () => {
  const s = session();
  s.placeBomb("first");
  s.moveTo({ x: 2, y: 1 }, "step off");
  const r = s.placeBomb("second");
  assert.equal(r.ok, false);
  assert.equal(r.ticks, 0);
});

test("the replay reproduces the session exactly", () => {
  const s = session(["hunter", "hunter", "hunter"] as never);
  s.wait(15, "watch");
  s.moveTo({ x: 1, y: 3 }, "move down");
  s.wait(15, "watch again");
  s.finishWithoutAgent();
  const frames = replayFrames(s.replay);
  assert.deepEqual(frames.at(-1)!.state, s.state);
  assert.equal(s.replay.players[AGENT].kind, "agent");
});

test("a rival bomb nearby interrupts a long wait", () => {
  // Hunters close in quickly on a small board, so an alert must come before 40 ticks pass.
  const s = new DetonariumSession({ seed: 3, bots: ["hunter"], rules: { width: 7, height: 7, crateDensity: 0 }, alertRadius: 6, maxMacroTicks: 40 });
  let stopped = "";
  for (let i = 0; i < 5 && !stopped; i++) {
    const r = s.wait(40, "watch");
    if (r.stoppedBecause === "alert") stopped = "alert";
    if (r.stoppedBecause === "eliminated" || r.stoppedBecause === "match_over") break;
  }
  assert.equal(stopped, "alert");
});

test("calls are recorded with intentions and tick spans", () => {
  const s = session();
  s.wait(2, "breathe");
  s.moveTo({ x: 2, y: 1 }, "edge right");
  assert.deepEqual(
    s.calls.map((c) => [c.tool, c.intention, c.tickStart, c.tickEnd, c.stoppedBecause]),
    [["wait", "breathe", 0, 2, "done"], ["move_to", "edge right", 2, 3, "arrived"]],
  );
});
