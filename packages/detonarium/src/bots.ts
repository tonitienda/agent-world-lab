import { index } from "./board.js";
import { crowd, dangerMap, escape, MOVES, route, settled } from "./danger.js";
import { blastCells } from "./engine.js";
import { seededRandom } from "./rng.js";
import type { Action, Bomb, Direction, MatchState, Player, Pos } from "./types.js";

export type BotKind = "passive" | "wanderer" | "hunter";
/** A bot chooses its player's action for the next tick. Deterministic for a given seed and call sequence. */
export type Bot = (state: MatchState) => Action;
/** What a bomb placed at a cell would hit right now, and how far (Manhattan) the closest enemy is. */
export type BlastTargets = { crates: number; enemies: number; pickups: number; nearestEnemy: number };
/** How many steps a bot will detour to collect a revealed pickup. */
const PICKUP_REACH = 6;

function targetsAt(state: MatchState, me: Player, pos: Pos, doomed: Set<number>): BlastTargets {
  const cells = blastCells(state, { owner: me.id, pos, fuse: state.rules.fuse, range: me.range });
  const enemies = state.players.filter((o) => o.alive && o.id !== me.id);
  return {
    crates: cells.filter((p) => state.cells[index(state.rules, p)] === "crate" && !doomed.has(index(state.rules, p))).length,
    enemies: enemies.filter((o) => cells.some((p) => p.x === o.pos.x && p.y === o.pos.y)).length,
    // Blasts stop at crates but sweep over pickups; ones already doomed are lost either way.
    pickups: cells.filter((p) => state.pickups[index(state.rules, p)] !== null && !doomed.has(index(state.rules, p))).length,
    nearestEnemy: Math.min(...enemies.map((o) => Math.abs(o.pos.x - pos.x) + Math.abs(o.pos.y - pos.y))),
  };
}

/** Cells some bomb already on the board will blast: crates and pickups there are as good as gone. */
function doomedCells(state: MatchState): Set<number> {
  return new Set(state.bombs.flatMap((b) => blastCells(state, b).map((p) => index(state.rules, p))));
}
const armed = (state: MatchState, me: Player) => state.bombs.filter((b) => b.owner === me.id).length < me.bombs;

/**
 * A bomb here is allowed only with capacity and a way out of its own blast. Normally
 * the way out must survive rivals stepping into any cell next to them; a kill shot
 * (`risky`) accepts an escape that assumes they stay put, since a rival in the blast
 * line is always close and would otherwise veto every attack.
 */
function canBombSafely(state: MatchState, me: Player, risky = false): boolean {
  if (!armed(state, me)) return false;
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
const REVERSE: Partial<Record<Action, Action>> = { up: "down", down: "up", left: "right", right: "left" };
const nextPos = (p: Pos, action: Action): Pos =>
  action in MOVES ? { x: p.x + MOVES[action as Direction].x, y: p.y + MOVES[action as Direction].y } : p;

/**
 * Hunter aggression: given what a bomb at the current cell would hit, decide whether
 * to place it. Safety (capacity and an escape route) is already guaranteed by the caller.
 */
function shouldBomb(targets: BlastTargets, me: Player, random: () => number): boolean {
  // An enemy in the blast line beats any crate; a little hesitation keeps it from being exploitable.
  if (targets.enemies > 0) return random() < 0.9;
  // Never trade a pickup for crates.
  if (targets.crates === 0 || targets.pickups > 0) return false;
  // With a single bomb, keep it for the enemy when one is within striking distance.
  const enemyClose = targets.nearestEnemy <= me.range + 2;
  if (me.bombs === 1 && enemyClose) return random() < 0.1;
  return random() < 0.85;
}

export function createBot(kind: BotKind, player: number, seed: number): Bot {
  const random = seededRandom(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  let last: Action = "stay";
  const bot: Bot = (state) => (last = decide(state));
  const decide: Bot = (state) => {
    const me = state.players[player];
    if (!me?.alive || state.over) return "stay";
    const danger = dangerMap(state);
    if (!settled(danger, index(state.rules, me.pos), 0)) return flee(state, me, danger);
    if (kind === "passive") return "stay";

    const options = safeMoves(state, me);
    const doomed = doomedCells(state);
    const here = targetsAt(state, me, me.pos, doomed);
    // A kill shot beats everything else, picking up items included.
    if (kind === "hunter" && here.enemies > 0 && shouldBomb(here, me, random) && canBombSafely(state, me, true)) return "bomb";
    // Then free power nearby, before a later blast burns it. This also ends waiting for a bomb to come back.
    const grab = route(state, player, (p, k) => k > 0 && state.pickups[index(state.rules, p)] !== null && !doomed.has(index(state.rules, p)), { danger, horizon: PICKUP_REACH });
    if (grab && grab !== "stay" && options.includes(grab)) return grab;
    // Every bomb is out: wait for one to come back rather than pace around (fleeing is handled above).
    if (!armed(state, me) && options.includes("stay")) return "stay";
    if (kind === "wanderer") {
      if (here.crates > 0 && here.pickups === 0 && random() < 0.4 && canBombSafely(state, me)) return "bomb";
      const moving = options.filter((a) => a !== "stay");
      return moving.length > 0 && random() < 0.8 ? pick(moving) : "stay";
    }

    if (here.enemies === 0 && here.crates > 0 && shouldBomb(here, me, random) && canBombSafely(state, me)) return "bomb";
    for (const wants of [(t: BlastTargets) => t.enemies > 0, (t: BlastTargets) => t.crates > 0 && t.pickups === 0]) {
      const step = route(state, player, (p, k) => k > 0 && wants(targetsAt(state, me, p, doomed)), { danger });
      if (!step || step === "stay" || !options.includes(step)) continue;
      // A chase that would undo the last step means the target moved: wait a tick for it to settle.
      return step === REVERSE[last] && options.includes("stay") ? "stay" : step;
    }
    // Nothing worth walking to: mostly hold still, with the odd step so it never looks frozen.
    if (options.includes("stay") && random() < 0.75) return "stay";
    return options.length > 0 ? pick(options) : "stay";
  };
  return bot;
}
