import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { ChessMatch, agentView, movetext, parseMove, replayPositions, type PlayerInfo } from "../src/index.js";

const white: PlayerInfo = { id: "claude", kind: "agent", label: "Claude" };
const black: PlayerInfo = { id: "stockfish", kind: "engine", label: "Stockfish 1500" };

test("parseMove accepts SAN, UCI and notation noise but keeps piece case", () => {
  const chess = new Chess();
  for (const input of ["e4", "e2e4", "E2E4", " e4 ", "e4!?"]) assert.equal(parseMove(chess, input).ok, true, input);
  assert.equal(parseMove(chess, "Nf3+").ok, true);
  assert.equal(parseMove(chess, "nf3").ok, false, "lowercase piece letters are not guessed");
  assert.equal(parseMove(chess, "e5").ok, false);
  assert.equal(parseMove(chess, "").ok, false);

  const castle = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  assert.equal(parseMove(castle, "0-0").ok, true);
  assert.equal(parseMove(castle, "0-0-0").ok, true);

  const promote = new Chess("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
  for (const input of ["e8=Q", "e8Q", "e7e8q", "e7e8Q", "e8=N+"])
    assert.equal(parseMove(promote, input).ok, true, input);
  const bishops = new Chess("4k3/8/8/8/8/2N5/1P6/4KB2 b - - 0 1");
  assert.equal(parseMove(bishops, "bxc3").ok, false, "no black pawn on b-file");
});

test("illegal attempts are recorded without moving and can forfeit", () => {
  const match = new ChessMatch({ white, black, maxIllegalStreak: 2 });
  const first = match.play("Ke2");
  assert.equal(first.ok, false);
  assert.equal(match.moves.length, 0);
  assert.equal(match.turn, "white");
  match.play("e4");
  match.play("Qh4");
  assert.equal(match.over, false, "a legal move resets the streak");
  match.play("Qh5");
  assert.deepEqual(match.result, { winner: "white", termination: "illegal-move-forfeit" });
  assert.equal(match.illegal.length, 3);
});

test("checkmate ends the game and the replay rebuilds every position", () => {
  const match = new ChessMatch({ white, black });
  for (const move of ["f3", "e5", "g4"]) match.play(move);
  const mate = match.play("Qh4#", { intention: "Fool's mate" });
  assert.equal(mate.ok, true);
  assert.deepEqual(match.result, { winner: "black", termination: "checkmate" });
  assert.equal(movetext(match), "1. f3 e5 2. g4 Qh4#");
  const replay = JSON.parse(JSON.stringify(match.replay()));
  assert.equal(replay.moves[3].intention, "Fool's mate");
  assert.deepEqual(replayPositions(replay).at(-1), match.chess.fen());
  const view = agentView(match, "white");
  assert.equal(view.yourTurn, false);
  assert.deepEqual(view.lastMove, { side: "black", san: "Qh4#" });
});
