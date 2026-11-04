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

function hiddenStatsFixture() {
  const s = session();
  s.state.players[0].range = 4;
  s.state.players[0].bombs = 2;
  s.state.players[1].range = 9;
  s.state.players[1].bombs = 7;
  s.state.bombs = [
    { owner: 0, pos: { ...s.state.players[0].pos }, fuse: 7, range: 3 },
    { owner: 1, pos: { ...s.state.players[1].pos }, fuse: 7, range: 9 },
  ];
  return s;
}

function assertHiddenStats(view: ReturnType<DetonariumSession["observe"]>) {
  for (const rival of view.rivals) assert.deepEqual(Object.keys(rival).sort(), ["alive", "name", "pos", "symbol"]);
  for (const bomb of view.bombs) {
    if (bomb.owner === "Claude") assert.ok(Object.hasOwn(bomb, "range"));
    else assert.deepEqual(Object.keys(bomb).sort(), ["owner", "pos", "ticksToExplode"]);
  }
}

test("private rival upgrades and enemy bomb reach cannot change an observation", () => {
  const s = hiddenStatsFixture();
  s.state.flames = [{ pos: { x: 3, y: 3 }, owners: [1], ticks: 2 }];
  const before = s.observe();
  assertHiddenStats(before);
  assert.equal(before.you.range, 4);
  assert.equal(before.you.bombCapacity, 2);
  assert.equal(before.bombs[0].range, 3, "own bombs keep their placement-time range");
  assert.deepEqual(before.flames, [{ pos: { x: 3, y: 3 }, ticksLeft: 2 }]);
  assert.equal(before.board[4][6], "*", "existing fire remains visible");
  s.state.players[1].range = 15;
  s.state.players[1].bombs = 12;
  s.state.bombs[1].range = 15;
  assert.deepEqual(s.observe(), before);
  assert.equal(s.state.bombs[1].range, 15, "authoritative simulation retains private stats");
});

test("successful and refused actions all return observations without rival stats", () => {
  const actions = [
    (s: DetonariumSession) => s.wait(2, "watch"),
    (s: DetonariumSession) => s.stepOnce("stay", "watch"),
    (s: DetonariumSession) => s.moveTo({ x: 2, y: 1 }, "move"),
    (s: DetonariumSession) => s.moveTo({ x: 0, y: 0 }, "blocked target"),
    (s: DetonariumSession) => s.placeBomb("already a bomb here"),
    (s: DetonariumSession) => { s.state.bombs.shift(); return s.placeBomb("new bomb"); },
    (s: DetonariumSession) => { s.state.over = true; return s.wait(1, "finished"); },
  ];
  for (const action of actions) {
    const result = action(hiddenStatsFixture());
    assertHiddenStats(result.view);
    assert.ok(result.happened.every((line) => !/range[=:]|capacity[=:]/i.test(line)));
  }
});

test("macro pickup evidence names the rival and tick without supplying an upgrade total", () => {
  const s = session();
  const rival = s.state.players[1];
  s.state.pickups[rival.pos.y * s.state.rules.width + rival.pos.x] = "range";
  const result = s.wait(3, "watch for pickups");
  assert.deepEqual(result.happened.filter((line) => line.includes("collected")), ["[tick 1] Passive 1 collected +range"]);
  assert.equal(rival.range, 2, "step uses a fresh state rather than mutating the old player");
  assert.equal(s.state.players[1].range, 3);
  assertHiddenStats(result.view);
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

test("spoken narration stays separate from technical summaries without changing game actions", () => {
  const narrated = session();
  const plain = session();
  narrated.moveTo({ x: 2, y: 1 }, "move (2,1)", 20, "Reach the crate lane", "Closer to that crate.");
  plain.moveTo({ x: 2, y: 1 }, "move (2,1)");
  narrated.placeBomb("bomb (2,1)", "Fuse runs for eight ticks", "A bomb here should open the passage.");
  plain.placeBomb("bomb (2,1)");
  narrated.stepOnce("left", "left", "Leave the bomb cell", "Back around the corner.");
  plain.stepOnce("left", "left");
  narrated.wait(1, "wait 1", "Let the fuse advance", "Waiting for the blast.");
  plain.wait(1, "wait 1");
  assert.deepEqual(narrated.state, plain.state);
  assert.deepEqual(narrated.calls.map((c) => c.narration), [
    "Closer to that crate.", "A bomb here should open the passage.", "Back around the corner.", "Waiting for the blast.",
  ]);
  assert.equal(narrated.calls[1].rationale, "Fuse runs for eight ticks");
  assert.equal(narrated.calls[1].intention, "bomb (2,1)");
  assert.ok(plain.calls.every((c) => c.narration === undefined));
});
