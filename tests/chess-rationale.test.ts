import { test } from "node:test";
import assert from "node:assert/strict";
import { ChessMatch } from "../packages/chess/src/index.js";
import { rationalesFromTranscript, withRationales } from "../scripts/chess-rationale.js";

const say = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const move = (id: string, san: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "mcp__chess__make_move", input: { move: san } }] } });
const result = (id: string, ok: boolean) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: JSON.stringify({ ok }) }] }] } });
const transcript = (...events: object[]) => events.map((e) => JSON.stringify(e)).join("\n");

test("text before a make_move becomes its rationale, and survives a rejected attempt", () => {
  const log = transcript(
    move("a", "e5"), result("a", true),
    say("The knight on f3 hangs if I go after it."), move("b", "Nxf3"), result("b", false),
    say("Right, it's my bishop that sees f3."), move("c", "Bxf3"), result("c", true),
  );
  assert.deepEqual(rationalesFromTranscript(log), [undefined, "The knight on f3 hangs if I go after it. Right, it's my bishop that sees f3."]);
});

test("withRationales fills agent moves in order and keeps a rationale the move already had", () => {
  const match = new ChessMatch({ white: { id: "sf", kind: "engine", label: "Stockfish" }, black: { id: "c", kind: "agent", label: "Claude" } });
  match.play("e4");
  match.play("e5", { rationale: "Given in the tool call." });
  match.play("Nf3");
  match.play("Nc6");
  const log = transcript(say("Ignored: the call had its own."), move("a", "e5"), result("a", true), say("Defend e5."), move("b", "Nc6"), result("b", true));
  const moves = withRationales(match.replay(), log).moves;
  assert.deepEqual(moves.map((m) => m.rationale), [undefined, "Given in the tool call.", undefined, "Defend e5."]);
});
