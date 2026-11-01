// Chess MCP server: one game between the connected agent and a Stockfish opponent.
// Env: CHESS_SIDE (white|black, agent's side), CHESS_ELO (opponent strength, "full" for no cap),
// CHESS_MOVETIME_MS, CHESS_MAX_ILLEGAL (consecutive illegal attempts before forfeit),
// AGENT_ID, AGENT_LABEL, SESSION_LOG_DIR.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";
import { renameSync, writeFileSync } from "node:fs";
import { ChessMatch, UciEngine, agentView, type Side } from "../../packages/chess/src/index.js";
import { SessionEvents } from "./session-events.js";

const side: Side = process.env.CHESS_SIDE === "black" ? "black" : "white";
const opponentSide: Side = side === "white" ? "black" : "white";
const elo = process.env.CHESS_ELO === "full" ? null : Number(process.env.CHESS_ELO ?? 1500);
const movetimeMs = Number(process.env.CHESS_MOVETIME_MS ?? 500);
const maxIllegal = Number(process.env.CHESS_MAX_ILLEGAL ?? 5);
const sessionFolder = process.env.SESSION_LOG_DIR
  ? resolve(process.env.SESSION_LOG_DIR)
  : resolve(import.meta.dirname, "../../data/chess-sessions", `${Date.now()}-${process.pid}`);

const events = new SessionEvents(sessionFolder);
const agent = { id: process.env.AGENT_ID ?? "claude", kind: "agent" as const, label: process.env.AGENT_LABEL ?? "Claude" };
const engineInfo = { id: "stockfish", kind: "engine" as const, label: `Stockfish${elo === null ? "" : " " + elo}` };
const match = new ChessMatch({
  white: side === "white" ? agent : engineInfo,
  black: side === "black" ? agent : engineInfo,
  maxIllegalStreak: maxIllegal,
  maxPlies: 300,
});
let engine: UciEngine;
let finished = false;

function response(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

function saveReplay() {
  const file = resolve(sessionFolder, "replay.json");
  writeFileSync(file + ".tmp", JSON.stringify(match.replay(), null, 2) + "\n");
  renameSync(file + ".tmp", file);
}

async function engineMove() {
  const best = await engine.bestMove(match.startFen, match.uciMoves());
  const outcome = match.play(best);
  if (!outcome.ok) throw Error(`Engine move rejected: ${best}`);
  events.add("opponent_move", { san: outcome.move.san, uci: outcome.move.uci, thinkMs: outcome.move.thinkMs });
  saveReplay();
  return outcome.move;
}

const server = new McpServer({ name: "agent-world-chess", version: "0.1.0" });

server.registerTool(
  "get_board",
  { description: `Show the current position. You play ${side}. Returns the board (uppercase = white, lowercase = black, '.' = empty), FEN, the moves so far and whose turn it is.` },
  async () => {
    events.add("get_board", {});
    return response(agentView(match, side));
  },
);

server.registerTool(
  "make_move",
  {
    description:
      "Play your move in standard algebraic notation (e.g. e4, Nf3, exd5, O-O, e8=Q) or UCI (e2e4). An illegal move is rejected, counted, and the position is unchanged; " +
      `${maxIllegal} illegal attempts in a row forfeit the game. When your move is legal the opponent replies immediately and the reply is included.`,
    inputSchema: {
      move: z.string().describe("Your move"),
      intention: z.string().max(200).describe("One short public first-person line for viewers about why you play this move"),
      rationale: z.string().max(600).optional().describe(
        "Optional: your reasoning for viewers in one to three first-person sentences, when the move has a real idea behind it " +
        "(a plan, a threat you see, a tactic, a correction). Omit it for routine moves."),
    },
  },
  async ({ move, intention, rationale }) => {
    if (finished || match.over) return response({ ok: false, message: "The game is over", result: match.result });
    if (match.turn !== side) return response({ ok: false, message: "It is not your turn" });
    const outcome = match.play(move, { intention, rationale });
    if (!outcome.ok) {
      events.add("illegal_move", { move, intention, rationale, reason: outcome.reason, streak: outcome.illegalStreak });
      saveReplay();
      return response({ ok: false, reason: outcome.reason, illegalAttemptsInARow: outcome.illegalStreak, result: outcome.result });
    }
    events.add("agent_move", { move, san: outcome.move.san, intention, rationale, thinkMs: outcome.move.thinkMs });
    saveReplay();
    const reply = match.over ? null : await engineMove();
    return response({ ok: true, yourMove: outcome.move.san, opponentReply: reply?.san ?? null, position: agentView(match, side) });
  },
);

server.registerTool(
  "resign",
  { description: "Resign the game. Only do this if the position is truly lost." },
  async () => {
    match.resign(side);
    events.add("resign", { side });
    saveReplay();
    return response({ ok: true, result: match.result });
  },
);

server.registerTool(
  "finish_session",
  { description: "End the session and save the game record. Call once the game is over (or if you cannot continue)." },
  async () => {
    finished = true;
    events.add("session_finish", { result: match.result, plies: match.moves.length, illegal: match.illegal.length });
    saveReplay();
    engine.quit();
    setTimeout(() => process.exit(0), 350).unref();
    return response({ ok: true, result: match.result, folder: sessionFolder });
  },
);

async function main() {
  engine = await UciEngine.start({ elo, movetimeMs });
  events.add("chess_configuration", { side, opponent: engine.name, elo, movetimeMs, maxIllegal });
  if (match.turn === opponentSide) await engineMove();
  saveReplay();
  await server.connect(new StdioServerTransport());
  process.stderr.write(`Chess MCP ready: agent plays ${side} vs ${engineInfo.label}; logging to ${sessionFolder}\n`);
}

main().catch((error) => {
  process.stderr.write(`Chess MCP failed: ${String(error)}\n`);
  process.exit(1);
});
