import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, seededRandom, step, type Action, type MatchEvent, type MatchState, type Rules } from "../src/index.js";

const empty = (rules: Partial<Rules> = {}) =>
  createMatch({ seed: 1, rules: { crateDensity: 0, suddenDeathTick: null, ...rules } });
const stay = (s: MatchState): Action[] => s.players.map(() => "stay");
const withAction = (s: MatchState, player: number, action: Action): Action[] =>
  stay(s).map((a, i) => (i === player ? action : a));
function run(s: MatchState, ticks: number, actions: (s: MatchState) => Action[] = stay) {
  const events: MatchEvent[] = [];
  for (let t = 0; t < ticks && !s.over; t++) {
    const r = step(s, actions(s));
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

test("boards are reproducible from the seed and keep spawns clear", () => {
  assert.deepEqual(createMatch({ seed: 42 }), createMatch({ seed: 42 }));
  assert.notDeepEqual(createMatch({ seed: 42 }).cells, createMatch({ seed: 43 }).cells);
  const s = createMatch({ seed: 42 });
  for (const p of s.players) assert.equal(s.cells[p.pos.y * s.rules.width + p.pos.x], "floor");
  assert.equal(s.cells[0], "wall");
});

test("step is pure", () => {
  const s = empty();
  const before = structuredClone(s);
  step(s, withAction(s, 0, "right"));
  assert.deepEqual(s, before);
});

test("walls block movement and floor allows it", () => {
  const s = empty();
  const up = step(s, withAction(s, 0, "up"));
  assert.deepEqual(up.state.players[0].pos, { x: 1, y: 1 });
  assert.ok(up.events.some((e) => e.type === "blocked"));
  assert.deepEqual(step(s, withAction(s, 0, "right")).state.players[0].pos, { x: 2, y: 1 });
});

test("a bomb explodes after its fuse and credits the kill", () => {
  let s = empty({ players: 2, fuse: 3 });
  s.players[1].pos = { x: 3, y: 1 };
  s = step(s, withAction(s, 0, "bomb")).state;
  s.players[0].pos = { x: 3, y: 3 }; // off both blast lines of the bomb at (1,1)
  const { state, events } = run(s, 5);
  assert.equal(state.players[1].alive, false);
  assert.ok(events.some((e) => e.type === "eliminated" && e.player === 1 && e.by === 0));
  assert.deepEqual(events.find((e) => e.type === "match_over"), { type: "match_over", winner: 0, reason: "last_standing" });
});

test("bomb capacity limits how many bombs tick at once", () => {
  let s = empty({ players: 2 });
  s = step(s, withAction(s, 0, "bomb")).state;
  s = step(s, withAction(s, 0, "right")).state;
  s = step(s, withAction(s, 0, "bomb")).state;
  assert.equal(s.bombs.length, 1);
});

test("blasts chain into other bombs in the same tick", () => {
  let s = empty({ players: 2, fuse: 5 });
  s.bombs.push({ owner: 1, pos: { x: 5, y: 1 }, fuse: 99, range: 2 });
  s.bombs.push({ owner: 0, pos: { x: 3, y: 1 }, fuse: 1, range: 2 });
  const { events } = step(s, stay(s));
  assert.equal(events.filter((e) => e.type === "exploded").length, 2);
});

test("crates stop blasts and reveal hidden pickups that can be collected", () => {
  let s = empty({ players: 2 });
  const crate = 1 * s.rules.width + 3;
  s.cells[crate] = "crate";
  s.hidden[crate] = "range";
  s.bombs.push({ owner: 1, pos: { x: 2, y: 1 }, fuse: 1, range: 3 });
  s.players[0].pos = { x: 2, y: 3 };
  s.players[1].pos = { x: 9, y: 9 };
  const blast = step(s, stay(s));
  assert.ok(blast.events.some((e) => e.type === "crate_destroyed" && e.revealed === "range"));
  assert.ok(!blast.state.flames.some((f) => f.pos.x === 4 && f.pos.y === 1));
  s = run(blast.state, 3).state; // let flames fade
  s.players[0].pos = { x: 3, y: 1 }; // stand on the revealed pickup
  const grab = step(s, stay(s));
  assert.equal(grab.state.players[0].range, s.rules.startRange + 1);
});

test("sudden death collapses the outer ring first and crushes players", () => {
  const s = empty({ players: 2, suddenDeathTick: 0 });
  const { events, state } = run(s, 1);
  assert.deepEqual(events[0], { type: "collapse", pos: { x: 1, y: 1 } });
  assert.equal(state.players[0].alive, false);
  assert.equal(state.winner, 1);
});

test("random matches always end and replay identically", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const play = () => {
      const random = seededRandom(seed * 101);
      const options: Action[] = ["stay", "up", "down", "left", "right", "bomb"];
      return run(createMatch({ seed }), 10_000, (s) => s.players.map(() => options[Math.floor(random() * options.length)]));
    };
    const a = play(), b = play();
    assert.equal(a.state.over, true);
    assert.ok(a.state.tick <= a.state.rules.maxTicks);
    assert.deepEqual(a.events, b.events);
  }
});
