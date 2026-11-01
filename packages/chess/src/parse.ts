import type { Chess, Move } from "chess.js";

export type Parsed = { ok: true; move: Move } | { ok: false; reason: string };

/**
 * Resolves an agent's free-text move against the current position without playing it.
 * How forgiving this is defines what the episode counts as an "illegal move attempt".
 */
export function parseMove(chess: Chess, input: string): Parsed {
  const legal = chess.moves({ verbose: true });
  const text = normalize(input);
  if (!text) return { ok: false, reason: "Empty move" };
  // SAN stays case-sensitive: "bxc3" (pawn) and "Bxc3" (bishop) are different moves.
  const move =
    legal.find((m) => normalize(m.san) === text) ??
    legal.find((m) => m.lan === input.trim().toLowerCase());
  return move ? { ok: true, move } : { ok: false, reason: `"${input.trim()}" is not a legal move in this position` };
}

/** Forgives notation noise only: check/mate marks, annotations, "0-0" castling and "e8=Q" vs "e8Q". */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/[+#!?]+$/, "")
    .replace(/^0-0-0$/, "O-O-O")
    .replace(/^0-0$/, "O-O")
    .replace(/([a-h][18])=?([QRBN])$/, "$1=$2");
}
