import { index } from "./board.js";
import { crowd, dangerMap, escape, MOVES, route, settled } from "./danger.js";
import { blastCells } from "./engine.js";
import { seededRandom } from "./rng.js";
import type { Action, Bomb, Direction, MatchState, Player, Pos } from "./types.js";

export type BotKind = "passive" | "wanderer" | "hunter";
/** A bot chooses its player's action for the next tick. Deterministic for a given seed and call sequence. */
export type Bot = (state: MatchState) => Action;
/** What a bomb placed at a cell would hit right now, and how far (Manhattan) the closest enemy is. */
export type BlastTargets = { crates: number; enemies: number; nearestEnemy: number };

function targetsAt(state: MatchState, me: Player, pos: Pos): BlastTargets {
  const cells = blastCells(state, { owner: me.id, pos, fuse: state.rules.fuse, range: me.range });
  const enemies = state.players.filter((o) => o.alive && o.id !== me.id);
  return {
    crates: cells.filter((p) => state.cells[index(state.rules, p)] === "crate").length,
    enemies: enemies.filter((o) => cells.some((p) => p.x === o.pos.x && p.y === o.pos.y)).length,
    nearestEnemy: Math.min(...enemies.map((o) => Math.abs(o.pos.x - pos.x) + Math.abs(o.pos.y - pos.y))),
  };
}

/**
 * A bomb here is allowed only with capacity and a way out of its own blast. Normally
 * the way out must survive rivals stepping into any cell next to them; a kill shot
 * (`risky`) accepts an escape that assumes they stay put, since a rival in the blast
 * line is always close and would otherwise veto every attack.
 */
function canBombSafely(state: MatchState, me: Player, risky = false): boolean {
  if (state.bombs.filter((b) => b.owner === me.id).length >= me.bombs) return false;
  if (state.bombs.some((b) => b.pos.x === me.pos.x && b.pos.y === me.pos.y)) return false;
  const bomb: Bomb = { owner: me.id, pos: me.pos, fuse: state.rules.fuse, range: me.range };
  return escape(state, me.id, { extra: [bomb], avoid: risky ? [] : crowd(state, me.id) }) !== null;
}

/** Escape preferring cells no rival can contest next tick, so solid players do not bounce us back. */
function flee(state: MatchState, me: Player, danger: ReturnType<typeof dangerMap>): Action {
  return escape(state, me.id, { danger, avoid: crowd(state, me.id) }) ?? escape(state, me.id, { danger }) ?? "stay";
}

/** Moves (and staying) after which the bot can still reach a cell no blast will touch. */
function safeMoves(state: MatchState, me: Player): Action[] {
  const danger = dangerMap(state);
  return (["stay", ...Object.keys(MOVES)] as Action[]).filter((action) => {
    const to = nextPos(me.pos, action);
    const enterable = route(state, me.id, (p, k) => k === 1 && p.x === to.x && p.y === to.y, { danger, horizon: 1 }) === action;
    return enterable && escape(state, me.id, { danger, start: to, startStep: 1 }) !== null;
  });
}
const nextPos = (p: Pos, action: Action): Pos =>
  action in MOVES ? { x: p.x + MOVES[action as Direction].x, y: p.y + MOVES[action as Direction].y } : p;

/**
 * Hunter aggression: given what a bomb at the current cell would hit, decide whether
 * to place it. Safety (capacity and an escape route) is already guaranteed by the caller.
 */
function shouldBomb(targets: BlastTargets, me: Player, random: () => number): boolean {
  // An enemy in the blast line beats any crate; a little hesitation keeps it from being exploitable.
  if (targets.enemies > 0) return random() < 0.9;
  if (targets.crates === 0) return false;
  // With a single bomb, keep it for the enemy when one is within striking distance.
  const enemyClose = targets.nearestEnemy <= me.range + 2;
  if (me.bombs === 1 && enemyClose) return random() < 0.1;
  return random() < 0.85;
}

export function createBot(kind: BotKind, player: number, seed: number): Bot {
  const random = seededRandom(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  return (state) => {
    const me = state.players[player];
    if (!me?.alive || state.over) return "stay";
    const danger = dangerMap(state);
    if (!settled(danger, index(state.rules, me.pos), 0)) return flee(state, me, danger);
    if (kind === "passive") return "stay";

    const options = safeMoves(state, me);
    if (kind === "wanderer") {
      if (targetsAt(state, me, me.pos).crates > 0 && random() < 0.4 && canBombSafely(state, me)) return "bomb";
      const moving = options.filter((a) => a !== "stay");
      return moving.length > 0 && random() < 0.8 ? pick(moving) : "stay";
    }

    const here = targetsAt(state, me, me.pos);
    if ((here.enemies > 0 || here.crates > 0) && shouldBomb(here, me, random) && canBombSafely(state, me, here.enemies > 0)) return "bomb";
    for (const wants of [(t: BlastTargets) => t.enemies > 0, (t: BlastTargets) => t.crates > 0]) {
      const step = route(state, player, (p, k) => k > 0 && wants(targetsAt(state, me, p)), { danger });
      if (step && step !== "stay" && options.includes(step)) return step;
    }
    return options.length > 0 ? pick(options) : "stay";
  };
}
