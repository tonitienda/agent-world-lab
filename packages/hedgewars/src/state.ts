import type {Fact} from './engine.js';

export type Hog = {id: string; clan: number; name: string; hp: number; x: number; y: number};
export type Land = {width: number; height: number; cell: number; water: number};

/**
 * The match as far as the bridge has told us. Built purely from `@@` facts,
 * so it can be tested without running the game.
 */
export class MatchState {
  readonly hogs = new Map<string, Hog>();
  /** Everyone who ever played, so the dead can still be named. */
  readonly roster = new Map<string, {name: string; clan: number}>();
  /** Terrain grid, one string per row: '#' solid, '.' empty. */
  rows: string[] = [];
  land: Land | undefined;
  turn: {hog: string; wind: number; t: number; number: number} | undefined;
  over: {winner: number | null} | undefined;
  /** Set once the game starts draining health every turn (after a fixed number of rounds). */
  suddenDeath = false;

  apply(fact: Fact): void {
    switch (fact.kind) {
      case 'hog':
        // Every hit is reported as `damage`, so a snapshot below our own count means the game took health by itself.
        if (Number(fact.hp) < (this.hogs.get(fact.id!)?.hp ?? 0)) this.suddenDeath = true;
        this.hogs.set(fact.id!, {id: fact.id!, clan: Number(fact.clan), name: fact.name ?? '?',
          hp: Number(fact.hp), x: Number(fact.x), y: Number(fact.y)});
        this.roster.set(fact.id!, {name: fact.name ?? '?', clan: Number(fact.clan)});
        break;
      case 'damage': {
        // Health in the game only drops once things settle, so several hits can
        // report the same starting health. We keep our own running count instead.
        const hog = this.hogs.get(fact.id!);
        if (hog) hog.hp = Math.max(0, hog.hp - Number(fact.dmg));
        break;
      }
      case 'dead': this.hogs.delete(fact.id!); break;
      case 'row': this.rows[Number(fact.y)] = fact.cells ?? ''; break;
      case 'land':
        this.land = {width: Number(fact.w), height: Number(fact.h), cell: Number(fact.cell), water: Number(fact.water)};
        break;
      case 'turn':
        this.turn = {hog: fact.hog!, wind: Number(fact.wind), t: Number(fact.t), number: (this.turn?.number ?? 0) + 1};
        break;
      case 'over': {
        const winner = Number(fact.winner);
        this.over = {winner: Number.isInteger(winner) && winner >= 0 ? winner : null};
        break;
      }
    }
  }

  get currentHog(): Hog | undefined { return this.turn ? this.hogs.get(this.turn.hog) : undefined; }

  /** A team with no hedgehogs left has lost, even before the engine announces it. */
  get winner(): number | null | undefined {
    if (this.over) return this.over.winner;
    const clans = new Set([...this.hogs.values()].map(h => h.clan));
    if (this.turn && clans.size <= 1) return clans.size === 1 ? [...clans][0]! : null;
    return undefined;
  }
}

export type MapView = {
  /** Text rows, top to bottom. */
  rows: string[];
  /** Map pixel of the top-left corner of the first character. */
  originX: number; originY: number;
  /** Pixels per character. */
  cell: number;
  legend: Record<string, string>;
};

/**
 * Crops the terrain grid to the part that contains land and stamps each
 * hedgehog on it with a letter (uppercase = viewer's team).
 */
export function renderMap(state: MatchState, viewerClan: number): MapView {
  const cell = state.land?.cell ?? 32;
  const water = state.land?.water ?? Infinity;
  const solid = (row: string | undefined, c: number) => row?.[c] === '#';
  let top = Infinity, bottom = -1, left = Infinity, right = -1;
  state.rows.forEach((row, r) => {
    if (r * cell >= water) return;
    for (let c = 0; c < row.length; c++) {
      if (!solid(row, c)) continue;
      top = Math.min(top, r); bottom = Math.max(bottom, r); left = Math.min(left, c); right = Math.max(right, c);
    }
  });
  if (bottom < 0) return {rows: [], originX: 0, originY: 0, cell, legend: {}};
  top = Math.max(0, top - 2); left = Math.max(0, left - 1);
  bottom = Math.min(state.rows.length - 1, bottom + 1); right = right + 1;
  const grid: string[][] = [];
  for (let r = top; r <= bottom; r++) {
    const line: string[] = [];
    for (let c = left; c <= right; c++) line.push(r * cell >= water ? '~' : solid(state.rows[r], c) ? '#' : '.');
    grid.push(line);
  }
  const legend: Record<string, string> = {'#': 'ground', '.': 'air', '~': 'water (deadly)'};
  const used = new Set<string>();
  for (const hog of state.hogs.values()) {
    let letter = (hog.name[0] ?? 'h');
    letter = hog.clan === viewerClan ? letter.toUpperCase() : letter.toLowerCase();
    if (used.has(letter)) letter = String(used.size);
    used.add(letter);
    const r = Math.floor(hog.y / cell) - top, c = Math.floor(hog.x / cell) - left;
    if (grid[r]?.[c] !== undefined) grid[r]![c] = letter;
    legend[letter] = `${hog.name} (${hog.clan === viewerClan ? 'yours' : 'enemy'})`;
  }
  return {rows: grid.map(line => line.join('')), originX: left * cell, originY: top * cell, cell, legend};
}
