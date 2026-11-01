import { Chess, type PieceSymbol } from "chess.js";
import type { Analysis } from "./analysis.js";
import type { ChessReplay, Side } from "./match.js";

export type CalloutTone = "highlight" | "alert" | "info";
export type Callout = { text: string; tone: CalloutTone };

/** One stretch of the video. Board segments animate the move at `ply` when `animate` is set. */
export type Segment =
  | { kind: "intro" | "outro"; duration: number }
  | {
      kind: "board";
      duration: number;
      /** Plies applied at the end of this segment. */
      ply: number;
      /** Slide the move at `ply` across this segment (otherwise the position is static). */
      animate: boolean;
      caption?: string;
      callout?: Callout;
      /** Square marked with a red cross for a rejected move. */
      illegal?: { input: string; square: string | null; index: number; from: string[] };
      /** Side shown as "thinking" in its player card. */
      thinking?: Side;
    };

/** A narration line to voice, placed on the video timeline. */
export type NarrationCue = {
  ply: number;
  text: string;
  start: number;
  duration: number;
  /** "rationale": the agent's longer reasoning; "intention": its one-line note for the move. */
  kind: "rationale" | "intention";
};

export type Pacing = {
  intro: number;
  outro: number;
  quietSlide: number;
  quietHold: number;
  keySlide: number;
  keyHold: number;
  illegal: number;
  /** Narration reading speed, words per second, plus a fixed pause. */
  wordsPerSecond: number;
  narrationPad: number;
  narrationMin: number;
};

export const DEFAULT_PACING: Pacing = {
  intro: 7,
  outro: 8,
  quietSlide: 0.35,
  quietHold: 0.25,
  keySlide: 0.6,
  keyHold: 1.6,
  illegal: 1.8,
  wordsPerSecond: 2.6,
  narrationPad: 0.6,
  narrationMin: 2,
};

const NAMES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

/** The single most viewer-relevant thing about a move, in plain language, or null for a quiet move. */
function calloutFor(replay: ChessReplay, analysis: Analysis | null, ply: number, move: ReturnType<Chess["move"]>): Callout | null {
  const record = replay.moves[ply - 1];
  const mover = replay.players[record.side].label;
  if (record.san.endsWith("#")) return { text: `Checkmate! ${mover} wins`, tone: "highlight" };
  if (move.promotion) return { text: `Pawn becomes a ${NAMES[move.promotion]}!`, tone: "highlight" };
  const graded = analysis?.moves[ply - 1]?.grade;
  if (graded === "blunder") return { text: `Blunder by ${mover}!`, tone: "alert" };
  if (graded === "mistake") return { text: `Mistake by ${mover}`, tone: "alert" };
  if (move.captured && move.captured !== "p") return { text: `${mover} takes the ${NAMES[move.captured]}`, tone: "info" };
  if (move.isKingsideCastle() || move.isQueensideCastle()) return { text: `${mover} castles: king tucked away`, tone: "info" };
  return null;
}

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Last square named in a move, e.g. "Rxe6+" -> "e6", "e2e4" -> "e4". */
export function targetSquare(input: string): string | null {
  return input.match(/[a-h][1-8]/g)?.at(-1) ?? null;
}

/** Could a piece on `from` reach `to` on an empty board? Blockers, pins and checks are what make moves illegal. */
function reaches(type: PieceSymbol, color: "w" | "b", from: string, to: string): boolean {
  const df = to.charCodeAt(0) - from.charCodeAt(0), dr = Number(to[1]) - Number(from[1]);
  const [af, ar] = [Math.abs(df), Math.abs(dr)];
  if (af + ar === 0) return false;
  switch (type) {
    case "r": return df === 0 || dr === 0;
    case "b": return af === ar;
    case "q": return df === 0 || dr === 0 || af === ar;
    case "n": return af * ar === 2;
    case "k": return Math.max(af, ar) === 1 || (ar === 0 && af === 2);
    case "p": {
      const fwd = color === "w" ? dr : -dr;
      const home = from[1] === (color === "w" ? "2" : "7");
      return (af === 0 && (fwd === 1 || (fwd === 2 && home))) || (af === 1 && fwd === 1);
    }
  }
}

/**
 * Squares of the piece(s) a rejected move most likely meant: the named origin for UCI, else the
 * mover's pieces of the SAN type (honouring any disambiguation) that could reach the target on an
 * empty board. Several squares means the move was ambiguous or the intent is unclear.
 */
export function illegalOrigins(fen: string, input: string): string[] {
  const chess = new Chess(fen);
  const color = chess.turn();
  const own = (sq: string) => { const p = chess.get(sq as never); return p && p.color === color ? p : null; };
  const raw = input.trim();
  const uci = /^([a-h][1-8])[a-h][1-8][qrbn]?$/i.exec(raw);
  if (uci) return own(uci[1].toLowerCase()) ? [uci[1].toLowerCase()] : [];
  const san = raw.replace(/[+#!?]+$/, "");
  if (/^[0O]-[0O](-[0O])?$/.test(san)) return chess.findPiece({ type: "k", color }) as string[];
  const m = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(=?[QRBN])?$/.exec(san);
  if (!m) return [];
  const type = (m[1]?.toLowerCase() ?? "p") as PieceSymbol;
  const to = m[4];
  const candidates = (chess.findPiece({ type, color }) as string[])
    .filter((sq) => (!m[2] || sq[0] === m[2]) && (!m[3] || sq[1] === m[3]));
  const able = candidates.filter((sq) => reaches(type, color, sq, to));
  return able.length ? able : candidates;
}

/**
 * Turns a game into an edit: narration (the agent's intention, while it "thinks") before key agent
 * moves, slow motion with a callout at turning points, rejected moves shown, quiet moves played fast.
 */
export function buildStory(replay: ChessReplay, analysis: Analysis | null, pacing: Pacing = DEFAULT_PACING) {
  const segments: Segment[] = [{ kind: "intro", duration: pacing.intro }];
  const cues: NarrationCue[] = [];
  let clock = pacing.intro;
  const push = (segment: Segment) => {
    segments.push(segment);
    clock += segment.duration;
  };
  const chess = new Chess(replay.startFen);
  push({ kind: "board", duration: 1, ply: 0, animate: false });

  replay.moves.forEach((record, i) => {
    const ply = i + 1;
    const before = chess.fen();
    const move = chess.move(record.uci);
    const callout = calloutFor(replay, analysis, ply, move);
    const agent = replay.players[record.side].kind === "agent";
    const rejected = replay.illegal.map((a, index) => ({ ...a, index })).filter((a) => a.ply === ply);
    const key = callout !== null || rejected.length > 0;

    for (const attempt of rejected) {
      const from = illegalOrigins(before, attempt.input);
      // Two pieces of the named type that both reach the square: the notation didn't say which.
      const which = from.length > 1 && !/^[a-h]/.test(attempt.input) ? ` (which ${NAMES[new Chess(before).get(from[0] as never)!.type]}?)` : "";
      push({
        kind: "board", duration: pacing.illegal, ply: ply - 1, animate: false, thinking: record.side,
        illegal: { input: attempt.input, square: targetSquare(attempt.input), index: attempt.index, from },
        callout: { text: `Illegal move: ${attempt.input}${which || ", rejected"}`, tone: "alert" },
      });
    }

    // The agent's own words before its move: the longer rationale when it offered one (always worth
    // voicing), else the short intention at turning points.
    const said = agent ? record.rationale ?? (key ? record.intention : undefined) : undefined;
    if (said) {
      const duration = Math.max(pacing.narrationMin, wordsIn(said) / pacing.wordsPerSecond + pacing.narrationPad);
      cues.push({ ply, text: said, start: clock, duration, kind: record.rationale ? "rationale" : "intention" });
      push({ kind: "board", duration, ply: ply - 1, animate: false, caption: said, thinking: record.side });
    }

    const caption = agent && (key || record.rationale) ? record.intention : undefined;
    push({ kind: "board", duration: key ? pacing.keySlide : pacing.quietSlide, ply, animate: true, caption });
    push({ kind: "board", duration: key ? pacing.keyHold : pacing.quietHold, ply, animate: false, caption, callout: callout ?? undefined });
  });

  push({ kind: "board", duration: 2, ply: replay.moves.length, animate: false });
  push({ kind: "outro", duration: pacing.outro });
  return { segments, cues, duration: clock };
}
