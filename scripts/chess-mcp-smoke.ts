// Drives the chess MCP server like an agent would: board, an illegal move, a legal move, finish.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "chess-smoke-"));
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp/chess.ts"],
  env: { ...process.env, SESSION_LOG_DIR: folder, CHESS_MOVETIME_MS: "200" } as Record<string, string>,
});
const client = new Client({ name: "chess-smoke", version: "0.0.0" });
await client.connect(transport);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse((result.content as { text: string }[])[0].text);
};
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
console.log("board:\n" + (await call("get_board")).board);
console.log("illegal:", await call("make_move", { move: "Ke2", intention: "Testing the rules" }));
const legal = await call("make_move", { move: "e4", intention: "Centre pawn" });
console.log("legal:", legal.ok, legal.yourMove, "reply", legal.opponentReply, "|", legal.position.moves);
console.log("finish:", await call("finish_session"));
await client.close();
