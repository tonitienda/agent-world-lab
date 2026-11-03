// One Detonarium match between an agent (player 0) and CPU bots, driven by macro actions.
// Dependency-free so it can be tested without the MCP server. The world only advances inside
// a macro: while the agent thinks between tool calls, the arena is frozen.
import {
  createBot,
  createMatch,
  newReplay,
  step,
  type Action,
  type Bot,
  type BotKind,
  type Direction,
  type MatchEvent,
  type MatchState,
  type Pos,
  type Replay,
  type Rules,
} from "../../packages/detonarium/src/index.js";

export const AGENT = 0;
const OFFSETS: Record<Direction, Pos> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
const distance = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export type SessionOptions = {
  seed: number;
  rules?: Partial<Rules>;
  /** One CPU bot per remaining slot; the agent is always player 0 (top-left corner). */
  bots: BotKind[];
  agentName?: string;
  /** A macro stops early when a rival places a bomb this close (Manhattan) to the agent. */
  alertRadius?: number;
  /** Upper bound for move_to and wait, so one call cannot run the clock out. */
  maxMacroTicks?: number;
};

export type StopReason = "done" | "arrived" | "alert" | "blocked" | "unreachable" | "eliminated" | "match_over" | "max_ticks";

export type MacroResult = {
  ok: boolean;
  ticks: number;
  stoppedBecause: StopReason;
  /** What happened during the macro, one line per notable event. */
  happened: string[];
  view: AgentView;
};

export type AgentView = {
  tick: number;
  /** Rows top to bottom; see `legend`. Row/column numbers are the x/y coordinates. */
  board: string[];
  legend: string;
  you: { name: string; pos: Pos; alive: boolean; bombCapacity: number; bombsTicking: number; range: number };
  rivals: { name: string; symbol: string; pos: Pos; alive: boolean; bombCapacity: number; range: number }[];
  bombs: { owner: string; pos: Pos; ticksToExplode: number; range: number }[];
  flames: { pos: Pos; ticksLeft: number }[];
  suddenDeath: { startsAtTick: number; nextCollapses: Pos[] } | null;
  rules: { fuseTicks: number; flameTicks: number; maxTicks: number };
  matchOver: boolean;
  result: string | null;
};

export type CallRecord = {
  tool: string;
  args: Record<string, unknown>;
  intention: string;
  rationale?: string;
  tickStart: number;
  tickEnd: number;
  stoppedBecause: StopReason;
};

const LEGEND =
  "# wall, + crate, . floor, A you, 1-3 rivals, o bomb, * flame, b +bomb pickup, r +range pickup. " +
  "Coordinates are (x, y): x is the column, y the row, origin top-left.";

export class DetonariumSession {
  state: MatchState;
  readonly replay: Replay;
  readonly names: string[];
  readonly calls: CallRecord[] = [];
  private readonly bots: Bot[];
  private readonly alertRadius: number;
  private readonly maxMacroTicks: number;

  constructor(options: SessionOptions) {
    const players = options.bots.length + 1;
    this.state = createMatch({ seed: options.seed, rules: { ...options.rules, players } });
    this.names = [options.agentName ?? "Agent", ...options.bots.map((kind, i) => `${kind[0].toUpperCase()}${kind.slice(1)} ${i + 1}`)];
    this.replay = newReplay(this.state, this.names.map((name, i) => (i === AGENT ? { name, kind: "agent" } : { name, kind: options.bots[i - 1] })));
    this.bots = options.bots.map((kind, i) => createBot(kind, i + 1, options.seed * 10 + i + 1));
    this.alertRadius = options.alertRadius ?? 4;
    this.maxMacroTicks = options.maxMacroTicks ?? 20;
  }

  get agentAlive() {
    return this.state.players[AGENT].alive;
  }

  observe(): AgentView {
    const s = this.state;
    const { width, height } = s.rules;
    const symbol = (id: number) => (id === AGENT ? "A" : String(id));
    const rows: string[][] = [];
    for (let y = 0; y < height; y++) {
      const row: string[] = [];
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const cell = s.cells[i];
        row.push(cell === "wall" ? "#" : cell === "crate" ? "+" : s.pickups[i] === "bomb" ? "b" : s.pickups[i] === "range" ? "r" : ".");
      }
      rows.push(row);
    }
    for (const f of s.flames) rows[f.pos.y][f.pos.x] = "*";
    for (const b of s.bombs) rows[b.pos.y][b.pos.x] = "o";
    // Players drawn last: a player standing on a bomb shows as the player; the bomb list has it.
    for (const p of s.players) if (p.alive) rows[p.pos.y][p.pos.x] = symbol(p.id);
    const header = "   " + Array.from({ length: width }, (_, x) => String(x % 10)).join("");
    const board = [header, ...rows.map((r, y) => String(y).padStart(2) + " " + r.join(""))];

    const me = s.players[AGENT];
    const sd = s.rules.suddenDeathTick;
    const collapsed = sd === null ? 0 : Math.max(0, s.tick - sd);
    return {
      tick: s.tick,
      board,
      legend: LEGEND,
      you: {
        name: this.names[AGENT],
        pos: me.pos,
        alive: me.alive,
        bombCapacity: me.bombs,
        bombsTicking: s.bombs.filter((b) => b.owner === AGENT).length,
        range: me.range,
      },
      rivals: s.players
        .filter((p) => p.id !== AGENT)
        .map((p) => ({ name: this.names[p.id], symbol: symbol(p.id), pos: p.pos, alive: p.alive, bombCapacity: p.bombs, range: p.range })),
      bombs: s.bombs.map((b) => ({ owner: this.names[b.owner], pos: b.pos, ticksToExplode: b.fuse, range: b.range })),
      flames: s.flames.map((f) => ({ pos: f.pos, ticksLeft: f.ticks })),
      suddenDeath: sd === null ? null : { startsAtTick: sd, nextCollapses: s.collapseOrder.slice(collapsed, collapsed + 6) },
      rules: { fuseTicks: s.rules.fuse, flameTicks: s.rules.flameTicks, maxTicks: s.rules.maxTicks },
      matchOver: s.over,
      result: this.result(),
    };
  }

  result(): string | null {
    const s = this.state;
    if (!s.over) return s.players[AGENT].alive ? null : `${this.names[AGENT]} was eliminated; the match continues without you`;
    return s.winner === null ? "draw" : `${this.names[s.winner]} wins`;
  }

  /** Walk toward (x, y), re-planning every tick around walls, crates, bombs, flames and players. */
  moveTo(target: Pos, intention: string, maxTicks = this.maxMacroTicks, rationale?: string): MacroResult {
    return this.macro("move_to", { x: target.x, y: target.y, maxTicks }, { intention, rationale }, maxTicks, () => {
      const me = this.state.players[AGENT];
      if (samePos(me.pos, target)) return { stop: "arrived" };
      const next = this.firstStep(target);
      return next ? { action: next } : { stop: this.reachable(target) ? "blocked" : "unreachable" };
    }, () => (samePos(this.state.players[AGENT].pos, target) ? "arrived" : null));
  }

  placeBomb(intention: string, rationale?: string): MacroResult {
    const s = this.state;
    const me = s.players[AGENT];
    const ticking = s.bombs.filter((b) => b.owner === AGENT).length;
    if (me.alive && !s.over && (ticking >= me.bombs || s.bombs.some((b) => samePos(b.pos, me.pos)))) {
      return { ok: false, ticks: 0, stoppedBecause: "blocked", happened: ["No bomb placed: all your bombs are ticking or a bomb is already here"], view: this.observe() };
    }
    return this.macro("place_bomb", {}, { intention, rationale }, 1, () => ({ action: "bomb" }));
  }

  wait(ticks: number, intention: string, rationale?: string): MacroResult {
    const n = Math.max(1, Math.min(Math.floor(ticks), this.maxMacroTicks));
    return this.macro("wait", { ticks: n }, { intention, rationale }, n, () => ({ action: "stay" }));
  }

  /** One tick with a single raw action. */
  stepOnce(action: Action, intention: string, rationale?: string): MacroResult {
    return this.macro("step", { action }, { intention, rationale }, 1, () => ({ action }));
  }

  /** After the agent is out, let the bots finish so the replay and result are complete. */
  finishWithoutAgent(): void {
    while (!this.state.over) this.advance("stay");
  }

  private macro(
    tool: string,
    args: Record<string, unknown>,
    note: { intention: string; rationale?: string },
    maxTicks: number,
    choose: () => { action?: Action; stop?: StopReason },
    reached: () => StopReason | null = () => null,
  ): MacroResult {
    const tickStart = this.state.tick;
    const happened: string[] = [];
    let stoppedBecause: StopReason = "done";
    let ticks = 0;
    if (this.state.over) stoppedBecause = "match_over";
    else if (!this.agentAlive) stoppedBecause = "eliminated";
    else {
      for (;;) {
        if (ticks >= maxTicks) {
          stoppedBecause = tool === "move_to" ? "max_ticks" : "done";
          break;
        }
        const choice = choose();
        if (choice.stop) {
          stoppedBecause = choice.stop;
          break;
        }
        const events = this.advance(choice.action!);
        ticks++;
        happened.push(...events.map((e) => this.describe(e)).filter((line): line is string => line !== null));
        if (this.state.over) { stoppedBecause = "match_over"; break; }
        if (!this.agentAlive) { stoppedBecause = "eliminated"; break; }
        const done = reached();
        if (done) { stoppedBecause = done; break; }
        if (this.alerted(events)) { stoppedBecause = "alert"; break; }
      }
    }
    const ok = !["blocked", "unreachable"].includes(stoppedBecause) || ticks > 0;
    this.calls.push({ tool, args, intention: note.intention, ...(note.rationale ? { rationale: note.rationale } : {}), tickStart, tickEnd: this.state.tick, stoppedBecause });
    return { ok, ticks, stoppedBecause, happened, view: this.observe() };
  }

  private advance(agentAction: Action): MatchEvent[] {
    const actions: Action[] = [agentAction, ...this.bots.map((bot) => bot(this.state))];
    if (!this.agentAlive) actions[AGENT] = "stay";
    this.replay.ticks.push({ actions });
    const result = step(this.state, actions);
    this.state = result.state;
    return result.events;
  }

  /** A rival bomb placed near the agent interrupts the macro so the agent can react. */
  private alerted(events: MatchEvent[]): boolean {
    const me = this.state.players[AGENT].pos;
    return events.some((e) => e.type === "bomb_placed" && e.player !== AGENT && distance(e.pos, me) <= this.alertRadius);
  }

  private blocked(p: Pos): boolean {
    const s = this.state;
    const { width, height } = s.rules;
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return true;
    if (s.cells[p.y * width + p.x] !== "floor") return true;
    if (s.bombs.some((b) => samePos(b.pos, p))) return true;
    return false;
  }

  /** Shortest path by breadth-first search; returns the first direction, or null if none exists now. */
  private firstStep(target: Pos, ignoreTransient = false): Direction | null {
    const s = this.state;
    const start = s.players[AGENT].pos;
    const transient = (p: Pos) =>
      !ignoreTransient &&
      (s.flames.some((f) => samePos(f.pos, p)) || s.players.some((o) => o.alive && o.id !== AGENT && samePos(o.pos, p)));
    const seen = new Set([`${start.x},${start.y}`]);
    let frontier: { pos: Pos; first: Direction | null }[] = [{ pos: start, first: null }];
    while (frontier.length > 0) {
      const next: typeof frontier = [];
      for (const node of frontier) {
        for (const [dir, o] of Object.entries(OFFSETS) as [Direction, Pos][]) {
          const pos = { x: node.pos.x + o.x, y: node.pos.y + o.y };
          const key = `${pos.x},${pos.y}`;
          if (seen.has(key) || this.blocked(pos) || transient(pos)) continue;
          seen.add(key);
          const first = node.first ?? dir;
          if (samePos(pos, target)) return first;
          next.push({ pos, first });
        }
      }
      frontier = next;
    }
    return null;
  }

  /** Reachable once flames die down and players move: "blocked" rather than "unreachable". */
  private reachable(target: Pos): boolean {
    return this.firstStep(target, true) !== null;
  }

  private describe(e: MatchEvent): string | null {
    const n = (id: number) => (id === AGENT ? "you" : this.names[id]);
    const at = (p: Pos) => `(${p.x}, ${p.y})`;
    switch (e.type) {
      case "bomb_placed": return `${n(e.player)} placed a bomb at ${at(e.pos)}`;
      case "exploded": return `${e.owner === AGENT ? "your" : this.names[e.owner] + "'s"} bomb at ${at(e.pos)} exploded`;
      case "crate_destroyed": return `crate at ${at(e.pos)} destroyed${e.revealed ? `, revealing a +${e.revealed} pickup` : ""}`;
      case "pickup_collected": return `${n(e.player)} collected +${e.kind}`;
      case "pickup_destroyed": return `a +${e.kind} pickup at ${at(e.pos)} burned`;
      case "eliminated": {
        const who = e.player === AGENT ? "you were" : `${this.names[e.player]} was`;
        const bomb = (k: number) => (k === e.player ? (e.player === AGENT ? "your own bomb" : "their own bomb") : k === AGENT ? "your bomb" : `${this.names[k]}'s bomb`);
        const cause = e.by === "collapse" ? "the collapsing arena" : e.by.map(bomb).join(" and ");
        return `${who} eliminated by ${cause}`;
      }
      case "collapse": return `the arena collapsed at ${at(e.pos)}`;
      case "match_over": return e.winner === null ? `match over: draw (${e.reason.replace("_", " ")})` : `match over: ${n(e.winner)} won`;
      case "blocked":
      case "bumped": return e.player === AGENT ? `your move ${e.direction} was blocked` : null;
      case "moved": return null;
    }
  }
}
