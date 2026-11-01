import { test } from "node:test";
import assert from "node:assert/strict";
import { ChessMatch, FRAME, renderFrame, type PlayerInfo } from "../src/index.js";

const white: PlayerInfo = { id: "claude", kind: "agent", label: "Claude" };
const black: PlayerInfo = { id: "sf", kind: "engine", label: "Stockfish 1500" };

/** Pieces on the board only (the player cards also show captured pieces). */
const pieceCount = (svg: string) => (/dominant-baseline="central">(.*?)<\/g>/.exec(svg)![1].match(/[♚♛♜♝♞♟]/g) ?? []).length;

test("frames show 32 pieces at the start and fade captures mid-move", () => {
  const match = new ChessMatch({ white, black });
  for (const m of ["e4", "d5", "exd5"]) match.play(m, { intention: "Take the pawn & see <what> happens" });
  const replay = match.replay();
  const start = renderFrame(replay, { ply: 0, t: 1 });
  assert.match(start, new RegExp(`^<svg [^>]*width="${FRAME.width}" height="${FRAME.height}"`));
  assert.equal(pieceCount(start), 32);
  const mid = renderFrame(replay, { ply: 3, t: 0.5, caption: replay.moves[2].intention });
  assert.equal(pieceCount(mid), 32, "captured pawn still fading");
  assert.match(mid, /&amp; see &lt;what&gt;/, "captions are escaped");
  assert.equal(pieceCount(renderFrame(replay, { ply: 3, t: 1 })), 31);
});

test("castling moves the rook too and the final frame names the winner", () => {
  const match = new ChessMatch({ white, black });
  for (const m of ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "O-O"]) match.play(m);
  const replay = match.replay();
  const landed = renderFrame(replay, { ply: 7, t: 1 });
  assert.equal(pieceCount(landed), 32);
  const mate = new ChessMatch({ white, black });
  for (const m of ["f3", "e5", "g4", "Qh4#"]) mate.play(m);
  assert.match(renderFrame(mate.replay(), { ply: 4, t: 1 }), /Stockfish 1500 wins by checkmate/);
});
