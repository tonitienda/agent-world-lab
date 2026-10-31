import { test } from "node:test";
import assert from "node:assert/strict";
import { createBot, createMatch, dangerMap, escape, step, type BotKind, type MatchEvent, type MatchState, type Rules } from "../src/index.js";

const empty = () => createMatch({ seed: 1, rules: { players: 2, crateDensity: 0, suddenDeathTick: null } });

function play(kinds: BotKind[], seed: number, rules: Partial<Rules> = {}) {
  let state: MatchState = createMatch({ seed, rules });
  const bots = kinds.map((kind, i) => createBot(kind, i, seed * 10 + i));
  const events: MatchEvent[] = [];
  while (!state.over) {
    const result = step(state, bots.map((bot) => bot(state)));
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

test("danger windows follow fuses and chain reactions", () => {
  const s = empty();
  s.bombs.push({ owner: 0, pos: { x: 5, y: 1 }, fuse: 2, range: 2 });
  s.bombs.push({ owner: 1, pos: { x: 7, y: 1 }, fuse: 9, range: 1 });
  const danger = dangerMap(s);
  assert.deepEqual(danger[1 * s.rules.width + 8], [[2, 3]], "the chained bomb's blast arrives with the first one");
});

test("a player standing on its own bomb finds the way out", () => {
  const s = empty();
  s.bombs.push({ owner: 0, pos: { x: 1, y: 1 }, fuse: 3, range: 2 });
  const first = escape(s, 0);
  assert.ok(first === "right" || first === "down");
});

test("bots escape their own bombs instead of standing in them", () => {
  let s = empty();
  s.players[1].pos = { x: 9, y: 9 };
  s = step(s, ["bomb", "stay"]).state;
  const bot = createBot("passive", 0, 1);
  for (let t = 0; t < s.rules.fuse + s.rules.flameTicks; t++) s = step(s, [bot(s), "stay"]).state;
  assert.equal(s.players[0].alive, true);
});

test("bot matches always end and are reproducible", () => {
  for (const seed of [1, 2, 3]) {
    const a = play(["hunter", "hunter", "wanderer", "passive"], seed);
    const b = play(["hunter", "hunter", "wanderer", "passive"], seed);
    assert.equal(a.state.over, true);
    assert.deepEqual(a.events, b.events);
  }
});

test("hunters clear crates and rarely blow themselves up", () => {
  // Without sudden death: the collapse endgame leaves so little room that some self-kills are expected.
  let selfKills = 0, crates = 0, bombs = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { events } = play(["hunter", "hunter", "hunter", "hunter"], seed, { suddenDeathTick: null });
    selfKills += events.filter((e) => e.type === "eliminated" && e.by === e.player).length;
    crates += events.filter((e) => e.type === "crate_destroyed").length;
    bombs += events.filter((e) => e.type === "bomb_placed").length;
  }
  assert.ok(crates > 100, `hunters destroyed only ${crates} crates in 10 matches`);
  assert.ok(selfKills / bombs < 0.02, `${selfKills} self-eliminations from ${bombs} bombs`);
});
