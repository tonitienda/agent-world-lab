import { ChessMatch, type ChessReplay, type Side } from "./match.js";
import { UciEngine, type EngineOptions } from "./uci.js";

export type EngineSeat = Partial<EngineOptions> & { label?: string };

/** Plays two UCI engines against each other to completion (or `maxPlies`). */
export async function playEngines(seats: Record<Side, EngineSeat>, options: { maxPlies?: number; startFen?: string } = {}): Promise<ChessReplay> {
  const engines = {} as Record<Side, UciEngine>;
  try {
    for (const side of ["white", "black"] as const)
      engines[side] = await UciEngine.start({ elo: seats[side].elo ?? null, movetimeMs: seats[side].movetimeMs ?? 300, command: seats[side].command });
    const info = (side: Side) => ({
      id: `${side}-engine`,
      kind: "engine" as const,
      label: seats[side].label ?? `Stockfish${seats[side].elo ? " " + seats[side].elo : ""}`,
    });
    const match = new ChessMatch({ white: info("white"), black: info("black"), startFen: options.startFen, maxPlies: options.maxPlies ?? 300 });
    while (!match.over) {
      const best = await engines[match.turn].bestMove(match.startFen, match.uciMoves());
      const outcome = match.play(best);
      if (!outcome.ok) throw Error(`Engine played an unparseable move: ${best} (${outcome.reason})`);
    }
    return match.replay();
  } finally {
    for (const engine of Object.values(engines)) engine.quit();
  }
}
