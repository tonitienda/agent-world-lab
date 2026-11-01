import { replayPositions, type ChessReplay, type Side } from "./match.js";
import { UciEngine, type Score } from "./uci.js";

export type MoveGrade = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

export type Analysis = {
  version: 1;
  engine: string;
  depth: number;
  /** One entry per position (index 0 = start): score and win chance, both from white's point of view. */
  positions: { score: Score; white: number }[];
  /** One entry per ply: win chance the mover gave away (0-100) and the resulting grade. */
  moves: { loss: number; grade: MoveGrade; best: string }[];
};

/** Lichess's centipawn -> win-chance curve (0..100); mates count as certain. */
export function winChance(score: Score): number {
  if ("mate" in score) return score.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score.cp)) - 1);
}

/** Same thresholds Lichess uses for ?!, ? and ??. */
export function grade(loss: number): MoveGrade {
  if (loss >= 30) return "blunder";
  if (loss >= 20) return "mistake";
  if (loss >= 10) return "inaccuracy";
  return loss <= 2 ? "best" : "good";
}

const flip = (score: Score): Score => ("mate" in score ? { mate: -score.mate } : { cp: -score.cp });

/** Rates every position with full-strength Stockfish. Never shown to the players; it drives the video only. */
export async function analyseReplay(replay: ChessReplay, options: { depth?: number; command?: string } = {}): Promise<Analysis> {
  const depth = options.depth ?? 18;
  const engine = await UciEngine.start({ elo: null, movetimeMs: 0, command: options.command });
  try {
    const fens = replayPositions(replay);
    const positions: Analysis["positions"] = [];
    const bests: string[] = [];
    for (const fen of fens) {
      const toMove: Side = fen.split(" ")[1] === "w" ? "white" : "black";
      let { best, score } = await engine.analyse(fen, depth);
      // A finished game reports "mate 0" (side to move is mated) or a stalemate score of 0.
      if ("mate" in score && score.mate === 0) score = { mate: -1 };
      const white = toMove === "white" ? score : flip(score);
      positions.push({ score: white, white: winChance(white) });
      bests.push(best);
    }
    const moves = replay.moves.map((m, i) => {
      const before = positions[i].white, after = positions[i + 1].white;
      const loss = Math.max(0, m.side === "white" ? before - after : after - before);
      return { loss: Math.round(loss * 10) / 10, grade: grade(loss), best: bests[i] };
    });
    // A legal mate can't be worse than "best", whatever the curve says about the position before.
    replay.moves.forEach((m, i) => { if (m.san.endsWith("#")) moves[i] = { ...moves[i], loss: 0, grade: "best" }; });
    return { version: 1, engine: engine.name, depth, positions, moves };
  } finally {
    engine.quit();
  }
}
