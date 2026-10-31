import { index, inside, samePos } from "./board.js";
import { resolveMoves } from "./moves.js";
import type { Action, Bomb, Direction, MatchEvent, MatchState, Pos, StepOptions, StepResult } from "./types.js";

const ACTIONS: readonly Action[] = ["stay", "up", "down", "left", "right", "bomb"];
const OFFSETS: Record<Direction, Pos> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const add = (a: Pos, b: Pos): Pos => ({ x: a.x + b.x, y: a.y + b.y });

/** Cells a bomb's blast reaches: plus shape, stopped by walls, including (and stopping at) the first crate. */
export function blastCells(state: MatchState, bomb: Bomb): Pos[] {
  const cells = [bomb.pos];
  for (const offset of Object.values(OFFSETS)) {
    let p = bomb.pos;
    for (let n = 0; n < bomb.range; n++) {
      p = add(p, offset);
      if (!inside(state.rules, p)) break;
      const cell = state.cells[index(state.rules, p)];
      if (cell === "wall") break;
      cells.push(p);
      if (cell === "crate") break;
    }
  }
  return cells;
}

/**
 * Resolve one tick. Pure: the input state is not modified.
 * Order: bombs placed → movement → old flames fade → fuses and chain explosions
 * → sudden-death collapse → flame damage → pickups → match end.
 */
export function step(state: MatchState, actions: readonly Action[], options: StepOptions = {}): StepResult {
  if (state.over) throw new Error("match is over");
  if (actions.length !== state.players.length) throw new Error(`expected ${state.players.length} actions`);
  for (const a of actions) if (!ACTIONS.includes(a)) throw new Error(`unknown action ${String(a)}`);
  const s = structuredClone(state);
  const rules = s.rules;
  const events: MatchEvent[] = [];
  const alive = s.players.filter((p) => p.alive);
  const bombAt = (p: Pos) => s.bombs.find((b) => samePos(b.pos, p));

  for (const player of alive) {
    if (actions[player.id] !== "bomb" || bombAt(player.pos)) continue;
    if (s.bombs.filter((b) => b.owner === player.id).length >= player.bombs) continue;
    s.bombs.push({ owner: player.id, pos: player.pos, fuse: rules.fuse, range: player.range });
    events.push({ type: "bomb_placed", player: player.id, pos: player.pos });
  }

  const targets = alive.map((player) => {
    const action = actions[player.id];
    if (action === "stay" || action === "bomb") return null;
    const target = add(player.pos, OFFSETS[action]);
    if (!inside(rules, target) || s.cells[index(rules, target)] !== "floor" || bombAt(target)) {
      events.push({ type: "blocked", player: player.id, direction: action });
      return null;
    }
    return target;
  });
  const timing = alive.map((p) => options.timing?.[p.id]);
  const final = resolveMoves(alive.map((p) => p.pos), targets, timing, rules.moveTieWindowMs);
  alive.forEach((player, i) => {
    if (samePos(final[i], player.pos)) {
      if (targets[i]) events.push({ type: "bumped", player: player.id, direction: actions[player.id] as Direction });
      return;
    }
    events.push({ type: "moved", player: player.id, from: player.pos, to: final[i] });
    player.pos = final[i];
  });

  s.flames = s.flames.map((f) => ({ ...f, ticks: f.ticks - 1 })).filter((f) => f.ticks > 0);

  for (const bomb of s.bombs) bomb.fuse--;
  const queue = s.bombs.filter((b) => b.fuse <= 0);
  const revealed = new Set<number>();
  while (queue.length > 0) {
    const bomb = queue.shift()!;
    s.bombs = s.bombs.filter((b) => b !== bomb);
    const cells = blastCells(s, bomb);
    for (const p of cells) {
      const i = index(rules, p);
      if (s.cells[i] === "crate") {
        s.cells[i] = "floor";
        s.pickups[i] = s.hidden[i];
        s.hidden[i] = null;
        if (s.pickups[i]) revealed.add(i);
        events.push({ type: "crate_destroyed", pos: p, revealed: s.pickups[i] });
      } else if (s.pickups[i] && !revealed.has(i)) {
        events.push({ type: "pickup_destroyed", pos: p, kind: s.pickups[i]! });
        s.pickups[i] = null;
      }
      const chained = bombAt(p);
      if (chained && !queue.includes(chained)) {
        chained.fuse = 0;
        queue.push(chained);
      }
      s.flames = s.flames.filter((f) => !samePos(f.pos, p));
      s.flames.push({ pos: p, owner: bomb.owner, ticks: rules.flameTicks });
    }
    events.push({ type: "exploded", owner: bomb.owner, pos: bomb.pos, cells });
  }

  if (rules.suddenDeathTick !== null && s.tick >= rules.suddenDeathTick) {
    const p = s.collapseOrder[s.tick - rules.suddenDeathTick];
    if (p) {
      const i = index(rules, p);
      s.cells[i] = "wall";
      s.pickups[i] = null;
      s.hidden[i] = null;
      s.bombs = s.bombs.filter((b) => !samePos(b.pos, p));
      s.flames = s.flames.filter((f) => !samePos(f.pos, p));
      events.push({ type: "collapse", pos: p });
      for (const player of alive) {
        if (player.alive && samePos(player.pos, p)) {
          player.alive = false;
          events.push({ type: "eliminated", player: player.id, by: "collapse", pos: p });
        }
      }
    }
  }

  for (const player of alive) {
    const flame = player.alive && s.flames.find((f) => samePos(f.pos, player.pos));
    if (!flame) continue;
    player.alive = false;
    events.push({ type: "eliminated", player: player.id, by: flame.owner, pos: player.pos });
  }

  for (const player of alive) {
    const i = index(rules, player.pos);
    const kind = player.alive && s.pickups[i];
    if (!kind) continue;
    s.pickups[i] = null;
    if (kind === "bomb") player.bombs++;
    else player.range++;
    events.push({ type: "pickup_collected", player: player.id, kind, pos: player.pos });
  }

  s.tick++;
  const living = s.players.filter((p) => p.alive);
  const end = living.length === 1 ? "last_standing" : living.length === 0 ? "all_down" : s.tick >= rules.maxTicks ? "time_limit" : null;
  if (end) {
    s.over = true;
    s.winner = end === "last_standing" ? living[0].id : null;
    events.push({ type: "match_over", winner: s.winner, reason: end });
  }
  return { state: s, events };
}
