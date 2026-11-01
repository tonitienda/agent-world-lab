import { Chess, DEFAULT_POSITION } from "chess.js";
import { parseMove } from "./parse.js";

export type Side = "white" | "black";
export type PlayerInfo = { id: string; kind: "agent" | "engine"; label: string };

export type MoveRecord = {
  ply: number;
  side: Side;
  san: string;
  uci: string;
  /** Position after the move. */
  fen: string;
  at: string;
  /** Wall-clock time since the previous move (agent thinking or engine search). */
  thinkMs: number;
  intention?: string;
  /** Longer public reasoning, when the agent offers it (make_move's rationale, or text it wrote before the move). */
  rationale?: string;
};

export type IllegalAttempt = { ply: number; side: Side; input: string; reason: string; at: string };

export type Termination =
  | "checkmate"
  | "stalemate"
  | "threefold-repetition"
  | "insufficient-material"
  | "fifty-move-rule"
  | "resignation"
  | "illegal-move-forfeit"
  | "move-limit";

export type Result = { winner: Side | null; termination: Termination };

export type MatchOptions = {
  white: PlayerInfo;
  black: PlayerInfo;
  startFen?: string;
  /** Consecutive illegal attempts on one turn before that side forfeits; null never forfeits. */
  maxIllegalStreak?: number | null;
  /** Total plies before the game is adjudicated a draw; null disables. */
  maxPlies?: number | null;
};

export type ChessReplay = {
  version: 1;
  startFen: string;
  players: Record<Side, PlayerInfo>;
  moves: MoveRecord[];
  illegal: IllegalAttempt[];
  result: Result | null;
};

export type PlayOutcome =
  | { ok: true; move: MoveRecord; result: Result | null }
  | { ok: false; reason: string; illegalStreak: number; result: Result | null };

const other = (side: Side): Side => (side === "white" ? "black" : "white");

export class ChessMatch {
  readonly chess: Chess;
  readonly startFen: string;
  readonly players: Record<Side, PlayerInfo>;
  readonly moves: MoveRecord[] = [];
  readonly illegal: IllegalAttempt[] = [];
  result: Result | null = null;
  private illegalStreak = 0;
  private lastMoveAt = Date.now();

  constructor(private readonly options: MatchOptions) {
    this.startFen = options.startFen ?? DEFAULT_POSITION;
    this.chess = new Chess(this.startFen);
    this.players = { white: options.white, black: options.black };
  }

  get turn(): Side {
    return this.chess.turn() === "w" ? "white" : "black";
  }

  get over(): boolean {
    return this.result !== null;
  }

  /** Plays `input` for the side to move. Illegal input leaves the position untouched. */
  play(input: string, extra: { intention?: string; rationale?: string } = {}): PlayOutcome {
    if (this.result) return { ok: false, reason: "The game is over", illegalStreak: 0, result: this.result };
    const side = this.turn;
    const parsed = parseMove(this.chess, input);
    if (!parsed.ok) {
      this.illegalStreak++;
      this.illegal.push({ ply: this.moves.length + 1, side, input, reason: parsed.reason, at: new Date().toISOString() });
      const limit = this.options.maxIllegalStreak ?? null;
      if (limit !== null && this.illegalStreak >= limit)
        this.result = { winner: other(side), termination: "illegal-move-forfeit" };
      return { ok: false, reason: parsed.reason, illegalStreak: this.illegalStreak, result: this.result };
    }
    const played = this.chess.move(parsed.move);
    const now = Date.now();
    const record: MoveRecord = {
      ply: this.moves.length + 1,
      side,
      san: played.san,
      uci: played.lan,
      fen: this.chess.fen(),
      at: new Date(now).toISOString(),
      thinkMs: now - this.lastMoveAt,
      ...(extra.intention ? { intention: extra.intention } : {}),
      ...(extra.rationale?.trim() ? { rationale: extra.rationale.trim() } : {}),
    };
    this.lastMoveAt = now;
    this.illegalStreak = 0;
    this.moves.push(record);
    this.result = this.adjudicate();
    return { ok: true, move: record, result: this.result };
  }

  resign(side: Side) {
    if (!this.result) this.result = { winner: other(side), termination: "resignation" };
  }

  /** UCI move list from the start position, as engines expect it. */
  uciMoves(): string[] {
    return this.moves.map((m) => m.uci);
  }

  replay(): ChessReplay {
    return {
      version: 1,
      startFen: this.startFen,
      players: this.players,
      moves: [...this.moves],
      illegal: [...this.illegal],
      result: this.result,
    };
  }

  private adjudicate(): Result | null {
    const c = this.chess;
    if (c.isCheckmate()) return { winner: other(this.turn), termination: "checkmate" };
    if (c.isStalemate()) return { winner: null, termination: "stalemate" };
    if (c.isThreefoldRepetition()) return { winner: null, termination: "threefold-repetition" };
    if (c.isInsufficientMaterial()) return { winner: null, termination: "insufficient-material" };
    if (c.isDrawByFiftyMoves()) return { winner: null, termination: "fifty-move-rule" };
    const max = this.options.maxPlies ?? null;
    if (max !== null && this.moves.length >= max) return { winner: null, termination: "move-limit" };
    return null;
  }
}

/** Rebuilds the position after every ply (index 0 is the start) for renderers and checks. */
export function replayPositions(replay: ChessReplay): string[] {
  const chess = new Chess(replay.startFen);
  return [replay.startFen, ...replay.moves.map((m) => (chess.move(m.uci), chess.fen()))];
}
