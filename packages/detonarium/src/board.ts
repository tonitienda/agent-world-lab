import { seededRandom } from "./rng.js";
import type { Cell, MatchState, PickupKind, Player, Pos, Rules } from "./types.js";

export const DEFAULT_RULES: Rules = {
  width: 11,
  height: 11,
  players: 4,
  crateDensity: 0.7,
  pickupChance: 0.3,
  fuse: 8,
  startBombs: 1,
  startRange: 2,
  flameTicks: 2,
  moveTieWindowMs: 200,
  suddenDeathTick: 200,
  maxTicks: 400,
};

export const index = (rules: Rules, p: Pos) => p.y * rules.width + p.x;
export const inside = (rules: Rules, p: Pos) => p.x >= 0 && p.y >= 0 && p.x < rules.width && p.y < rules.height;
export const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;

/** Corner spawns in player order: top-left, bottom-right, top-right, bottom-left. */
export function spawnPoints(rules: Rules): Pos[] {
  const r = rules.width - 2, b = rules.height - 2;
  return [{ x: 1, y: 1 }, { x: r, y: b }, { x: r, y: 1 }, { x: 1, y: b }].slice(0, rules.players);
}

function isPillar(rules: Rules, x: number, y: number): boolean {
  const border = x === 0 || y === 0 || x === rules.width - 1 || y === rules.height - 1;
  return border || (x % 2 === 0 && y % 2 === 0);
}

/** Interior non-pillar cells from the outside ring inward, clockwise from the top-left. */
function spiral(rules: Rules): Pos[] {
  const order: Pos[] = [];
  let left = 1, top = 1, right = rules.width - 2, bottom = rules.height - 2;
  while (left <= right && top <= bottom) {
    for (let x = left; x <= right; x++) order.push({ x, y: top });
    for (let y = top + 1; y <= bottom; y++) order.push({ x: right, y });
    if (top < bottom) for (let x = right - 1; x >= left; x--) order.push({ x, y: bottom });
    if (left < right) for (let y = bottom - 1; y > top; y--) order.push({ x: left, y });
    left++; top++; right--; bottom--;
  }
  return order.filter((p) => !isPillar(rules, p.x, p.y));
}

export function createMatch(options: { seed: number; rules?: Partial<Rules> }): MatchState {
  const rules = { ...DEFAULT_RULES, ...options.rules };
  if (rules.width < 5 || rules.height < 5 || rules.width % 2 === 0 || rules.height % 2 === 0) {
    throw new Error("width and height must be odd and at least 5");
  }
  if (rules.players < 2 || rules.players > 4) throw new Error("players must be 2..4");
  const random = seededRandom(options.seed);
  const spawns = spawnPoints(rules);
  // Each spawn and its two neighbours along the border stay clear so nobody starts trapped.
  const safe = spawns.flatMap((s) => [s, { x: s.x === 1 ? 2 : s.x - 1, y: s.y }, { x: s.x, y: s.y === 1 ? 2 : s.y - 1 }]);
  const size = rules.width * rules.height;
  const cells: Cell[] = new Array(size);
  const hidden: (PickupKind | null)[] = new Array(size).fill(null);
  for (let y = 0; y < rules.height; y++) {
    for (let x = 0; x < rules.width; x++) {
      const i = y * rules.width + x;
      if (isPillar(rules, x, y)) cells[i] = "wall";
      else if (safe.some((p) => p.x === x && p.y === y) || random() >= rules.crateDensity) cells[i] = "floor";
      else {
        cells[i] = "crate";
        if (random() < rules.pickupChance) hidden[i] = random() < 0.5 ? "bomb" : "range";
      }
    }
  }
  const players: Player[] = spawns.map((pos, id) => ({ id, pos, alive: true, bombs: rules.startBombs, range: rules.startRange }));
  return {
    seed: options.seed,
    rules,
    tick: 0,
    cells,
    pickups: new Array(size).fill(null),
    hidden,
    players,
    bombs: [],
    flames: [],
    collapseOrder: spiral(rules),
    over: false,
    winner: null,
  };
}
