import { index, inside, samePos } from "./board.js";
import { blastCells } from "./engine.js";
import type { Action, Bomb, Direction, MatchState, Pos } from "./types.js";

/**
 * Time model used by planners: k = 1 is the state after the next step. A bomb with
 * fuse F explodes on step F and its flames are deadly on steps F..F+flameTicks-1.
 * A bomb placed this step with fuse R also explodes on step R.
 */
export type DangerMap = [number, number][][];

export const MOVES: Record<Direction, Pos> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const STEPS: [Action, Pos][] = [["stay", { x: 0, y: 0 }], ...(Object.entries(MOVES) as [Direction, Pos][])];

/** Per cell, the step windows during which standing there is deadly. Chain reactions included. */
export function dangerMap(state: MatchState, extra: Bomb[] = []): DangerMap {
  const { rules } = state;
  const bombs = [...state.bombs, ...extra].map((b) => ({ ...b }));
  const reach = bombs.map((b) => blastCells(state, b));
  for (let changed = true; changed; ) {
    changed = false;
    bombs.forEach((bomb, i) => {
      for (const p of reach[i]) {
        for (const other of bombs) {
          if (samePos(other.pos, p) && other.fuse > bomb.fuse) {
            other.fuse = bomb.fuse;
            changed = true;
          }
        }
      }
    });
  }
  const windows: DangerMap = Array.from({ length: rules.width * rules.height }, () => []);
  bombs.forEach((bomb, i) => {
    for (const p of reach[i]) windows[index(rules, p)].push([bomb.fuse, bomb.fuse + rules.flameTicks - 1]);
  });
  for (const flame of state.flames) {
    if (flame.ticks > 1) windows[index(rules, flame.pos)].push([1, flame.ticks - 1]);
  }
  // Sudden death is scheduled: a cell collapses on the step that starts at suddenDeathTick + its order.
  // Only collapses within a bomb's lookahead count; eventually every cell falls, so a longer view
  // would leave no cell ever safe.
  if (rules.suddenDeathTick !== null) {
    const lookahead = rules.fuse + rules.flameTicks + 2;
    state.collapseOrder.forEach((p, n) => {
      const k = rules.suddenDeathTick! + n - state.tick + 1;
      if (k >= 1 && k <= lookahead) windows[index(rules, p)].push([k, Infinity]);
    });
  }
  return windows;
}

export const deadly = (danger: DangerMap, i: number, k: number) => danger[i].some(([a, b]) => a <= k && k <= b);
/** No known danger reaches this cell at step k or later. */
export const settled = (danger: DangerMap, i: number, k: number) => danger[i].every(([, b]) => b < k);

/**
 * Breadth-first search through (cell, step) for the first action of the shortest
 * route that never stands in flames and ends where `goal` holds. Other players are
 * treated as fixed obstacles; bombs block every cell except the one being left.
 */
export function route(
  state: MatchState,
  player: number,
  goal: (p: Pos, k: number) => boolean,
  options: { extra?: Bomb[]; danger?: DangerMap; start?: Pos; startStep?: number; horizon?: number; avoid?: Pos[] } = {},
): Action | null {
  const { rules } = state;
  const extra = options.extra ?? [];
  const danger = options.danger ?? dangerMap(state, extra);
  const start = options.start ?? state.players[player].pos;
  const k0 = options.startStep ?? 0;
  const horizon = k0 + (options.horizon ?? rules.width + rules.height + rules.fuse + rules.flameTicks);
  const bombs = [...state.bombs, ...extra];
  const blocked = (p: Pos) =>
    !inside(rules, p) ||
    state.cells[index(rules, p)] !== "floor" ||
    bombs.some((b) => samePos(b.pos, p)) ||
    state.players.some((o) => o.alive && o.id !== player && samePos(o.pos, p)) ||
    (options.avoid ?? []).some((a) => samePos(a, p));

  if (goal(start, k0)) return "stay";
  const seen = new Set<string>();
  let frontier: { pos: Pos; first: Action }[] = [{ pos: start, first: "stay" }];
  for (let k = k0 + 1; k <= horizon && frontier.length > 0; k++) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const [action, offset] of STEPS) {
        const pos = { x: node.pos.x + offset.x, y: node.pos.y + offset.y };
        if (action !== "stay" && blocked(pos)) continue;
        const i = index(rules, pos);
        const key = `${i}:${k}`;
        if (deadly(danger, i, k) || seen.has(key)) continue;
        seen.add(key);
        const first = k === k0 + 1 ? action : node.first;
        if (goal(pos, k)) return first;
        next.push({ pos, first });
      }
    }
    frontier = next;
  }
  return null;
}

/** Cells other alive players could occupy after their next move. */
export function crowd(state: MatchState, player: number): Pos[] {
  return state.players
    .filter((o) => o.alive && o.id !== player)
    .flatMap((o) => Object.values(MOVES).map((m) => ({ x: o.pos.x + m.x, y: o.pos.y + m.y })));
}

/** First action toward a cell no known blast will reach; "stay" if already there, null if trapped. */
export function escape(state: MatchState, player: number, options: Parameters<typeof route>[3] = {}): Action | null {
  const danger = options.danger ?? dangerMap(state, options.extra);
  return route(state, player, (p, k) => settled(danger, index(state.rules, p), k), { ...options, danger });
}
