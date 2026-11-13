// Stdio adapter for one seat. The match runner owns the board and the other seat.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const mailbox = process.argv[2];
const server = new McpServer({ name: "detonarium-duel", version: "1.0.0" });
let busy = false;
async function exchange(input: unknown) {
  if (busy) throw new Error("Wait for your previous arena call to finish");
  busy = true;
  try {
    const id = randomUUID();
    const request = join(mailbox, "request.json");
    await writeFile(request + ".tmp", JSON.stringify({ id, input }));
    await rename(request + ".tmp", request);
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      const raw = await readFile(join(mailbox, "response.json"), "utf8").catch(() => null);
      if (raw) {
        const response = JSON.parse(raw);
        if (response.id === id) return { content: [{ type: "text" as const, text: JSON.stringify(response.value) }] };
      }
      await setTimeout(100);
    }
    throw new Error("The arena did not settle this call within four minutes");
  } finally {
    busy = false;
  }
}
server.registerTool("observe", { description: "See the current arena and your own stats without advancing the tick." }, () => exchange(null));
server.registerTool("step", {
  description: "Commit one action. Waits for the other player, then returns the settled board and events. Call sequentially, never in parallel.",
  inputSchema: {
    action: z.enum(["up", "down", "left", "right", "stay", "bomb"]),
    narration: z.string().min(3).max(160).optional(),
    timing: z.enum(["decision", "outcome"]).optional().describe("Decision for a plan before your action, outcome for a comment about something already observed."),
  },
}, (input) => exchange(input));
process.stdin.once("end", () => process.exit(0));
await server.connect(new StdioServerTransport());
