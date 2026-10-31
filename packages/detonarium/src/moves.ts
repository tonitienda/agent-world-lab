import type { Pos } from "./types.js";

const key = (p: Pos) => `${p.x},${p.y}`;

/**
 * Decide where each alive player ends up when everyone moves at the same time.
 * Players are solid.
 *
 * from[i] is player i's current cell. to[i] is the cell they try to enter, or null
 * when they stay, place a bomb, or bumped into a wall, crate or bomb. Terrain is
 * already filtered out; only player-vs-player conflicts are left to resolve.
 *
 * - Several players entering the same cell: the earliest wins if it acted at least
 *   `window` ms before every rival (timing[i]); otherwise all bounce and the cell
 *   stays empty. Without timing for every contender, all bounce.
 * - Head-on swaps are blocked: solid players cannot pass through each other.
 * - Entering a cell its occupant is leaving is allowed, unless that occupant is
 *   itself blocked; blocking propagates until nothing changes.
 *
 * Returns the final cell for each player, in the same order.
 */
export function resolveMoves(from: Pos[], to: (Pos | null)[], timing: (number | undefined)[] = [], window = 200): Pos[] {
  const moving = to.map((t) => t !== null);

  const contests = new Map<string, number[]>();
  to.forEach((t, i) => t && contests.set(key(t), [...(contests.get(key(t)) ?? []), i]));
  for (const contenders of contests.values()) {
    if (contenders.length < 2) continue;
    const times = contenders.map((i) => timing[i]);
    const timed = times.every((t): t is number => t !== undefined && Number.isFinite(t));
    const order = timed ? [...contenders].sort((a, b) => timing[a]! - timing[b]!) : [];
    const winner = timed && timing[order[1]]! - timing[order[0]]! >= window ? order[0] : -1;
    for (const i of contenders) if (i !== winner) moving[i] = false;
  }

  const occupant = new Map(from.map((p, i) => [key(p), i]));
  to.forEach((t, i) => {
    const j = t ? occupant.get(key(t)) : undefined;
    if (t && j !== undefined && to[j] && key(to[j]!) === key(from[i])) moving[i] = moving[j] = false;
  });

  for (let changed = true; changed; ) {
    changed = false;
    moving.forEach((isMoving, i) => {
      const j = isMoving ? occupant.get(key(to[i]!)) : undefined;
      if (j !== undefined && !moving[j]) {
        moving[i] = false;
        changed = true;
      }
    });
  }
  return from.map((p, i) => (moving[i] ? to[i]! : p));
}
