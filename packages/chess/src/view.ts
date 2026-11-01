import type { ChessMatch, Side } from "./match.js";

/** Numbered SAN movetext, e.g. "1. e4 e5 2. Nf3". */
export function movetext(match: ChessMatch): string {
  const blackFirst = match.startFen.split(" ")[1] === "b";
  const firstNumber = Number(match.startFen.split(" ")[5] ?? 1);
  const parts: string[] = [];
  match.moves.forEach((m, i) => {
    const index = i + (blackFirst ? 1 : 0);
    const number = firstNumber + Math.floor(index / 2);
    if (m.side === "white") parts.push(`${number}. ${m.san}`);
    else parts.push(i === 0 ? `${number}... ${m.san}` : m.san);
  });
  return parts.join(" ");
}

/**
 * Everything an agent may see of the position: no legal-move list and no evaluation,
 * only what a player at the board would know.
 */
export function agentView(match: ChessMatch, you: Side) {
  const last = match.moves.at(-1);
  return {
    you,
    toMove: match.turn,
    yourTurn: !match.over && match.turn === you,
    inCheck: match.chess.inCheck(),
    fen: match.chess.fen(),
    board: match.chess.ascii(),
    moves: movetext(match),
    lastMove: last ? { side: last.side, san: last.san } : null,
    result: match.result,
  };
}
