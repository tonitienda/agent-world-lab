/** Grid coordinates: origin top-left, x to the right, y down. */
export type Pos = { x: number; y: number };
export type Cell = "floor" | "wall" | "crate";
export type PickupKind = "bomb" | "range";
export type Direction = "up" | "down" | "left" | "right";
export type Action = "stay" | Direction | "bomb";

export type Rules = {
  width: number;
  height: number;
  players: number;
  /** Chance that a free, non-safe-zone floor cell starts as a crate. */
  crateDensity: number;
  /** Chance that a crate hides a pickup. */
  pickupChance: number;
  fuse: number;
  startBombs: number;
  startRange: number;
  /** Ticks flames stay dangerous, including the tick of the explosion. */
  flameTicks: number;
  /** Lead (ms) a player needs over every rival to win a contested cell; otherwise all bounce. */
  moveTieWindowMs: number;
  /** First tick of the inward collapse; null disables it. */
  suddenDeathTick: number | null;
  maxTicks: number;
};

export type Player = {
  id: number;
  pos: Pos;
  alive: boolean;
  /** Bomb capacity: how many of this player's bombs may be ticking at once. */
  bombs: number;
  range: number;
};
export type Bomb = { owner: number; pos: Pos; fuse: number; range: number };
export type Flame = { pos: Pos; owner: number; ticks: number };

export type MatchState = {
  seed: number;
  rules: Rules;
  tick: number;
  /** Row-major: cells[y * width + x]. */
  cells: Cell[];
  /** Visible pickups on floor cells. */
  pickups: (PickupKind | null)[];
  /** Pickups still hidden under crates. */
  hidden: (PickupKind | null)[];
  players: Player[];
  bombs: Bomb[];
  flames: Flame[];
  /** Cells that turn to wall during sudden death, in order. */
  collapseOrder: Pos[];
  over: boolean;
  /** Winning player id; null while running or on a draw. */
  winner: number | null;
};

export type MatchEvent =
  | { type: "moved"; player: number; from: Pos; to: Pos }
  | { type: "blocked"; player: number; direction: Direction }
  | { type: "bumped"; player: number; direction: Direction }
  | { type: "bomb_placed"; player: number; pos: Pos }
  | { type: "exploded"; owner: number; pos: Pos; cells: Pos[] }
  | { type: "crate_destroyed"; pos: Pos; revealed: PickupKind | null }
  | { type: "pickup_destroyed"; pos: Pos; kind: PickupKind }
  | { type: "pickup_collected"; player: number; kind: PickupKind; pos: Pos }
  | { type: "eliminated"; player: number; by: number | "collapse"; pos: Pos }
  | { type: "collapse"; pos: Pos }
  | { type: "match_over"; winner: number | null; reason: "last_standing" | "all_down" | "time_limit" };

export type StepResult = { state: MatchState; events: MatchEvent[] };
export type StepOptions = {
  /**
   * When each player chose its action this tick (ms, any common origin), indexed by
   * player id. Only used to break contests for the same cell. Record it in the
   * action log: replays need it to stay deterministic.
   */
  timing?: (number | undefined)[];
};
