// Attach the agent's own words to its moves: free text it wrote before a make_move call becomes that
// move's rationale (unless the call already carried one). The MCP replay is left untouched; an
// enriched copy is written for the recorder.
// Usage: tsx scripts/chess-rationale.ts <session folder>   (reads transcript.jsonl + session/replay.json, writes replay.json)
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChessReplay } from "../packages/chess/src/index.js";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: { type: string; text?: string }[] | string };

/** Text written since the previous make_move, for each accepted make_move, in order. */
export function rationalesFromTranscript(transcript: string): (string | undefined)[] {
  let pending: string[] = [];
  const calls = new Map<string, string[]>();
  const accepted: (string | undefined)[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as { type: string; message?: { content: Block[] | string } };
    if ((event.type !== "assistant" && event.type !== "user") || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      if (block.type === "text" && event.type === "assistant" && block.text.trim()) pending.push(block.text.trim());
      else if (block.type === "tool_use" && block.name.endsWith("make_move")) {
        calls.set(block.id, pending);
        pending = [];
      } else if (block.type === "tool_result" && calls.has(block.tool_use_id)) {
        const said = calls.get(block.tool_use_id)!;
        const body = typeof block.content === "string" ? block.content : block.content.map((c) => c.text ?? "").join("");
        let ok = false;
        try { ok = JSON.parse(body).ok === true; } catch { /* error text: rejected */ }
        // Words before a rejected attempt still explain the move eventually played.
        if (ok) accepted.push(said.length ? said.join(" ") : undefined);
        else pending = [...said, ...pending];
      }
    }
  }
  return accepted;
}

export function withRationales(replay: ChessReplay, transcript: string): ChessReplay {
  const said = rationalesFromTranscript(transcript);
  const agent = (["white", "black"] as const).find((s) => replay.players[s].kind === "agent");
  let k = 0;
  const moves = replay.moves.map((m) => {
    if (m.side !== agent) return m;
    const text = said[k++];
    return m.rationale || !text ? m : { ...m, rationale: text };
  });
  return { ...replay, moves };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = resolve(process.argv[2] ?? ".");
  const replay = JSON.parse(readFileSync(resolve(dir, "session/replay.json"), "utf8")) as ChessReplay;
  const enriched = withRationales(replay, readFileSync(resolve(dir, "transcript.jsonl"), "utf8"));
  writeFileSync(resolve(dir, "replay.json"), JSON.stringify(enriched, null, 2));
  console.log(`${enriched.moves.filter((m) => m.rationale).length} moves with rationale → ${resolve(dir, "replay.json")}`);
}
