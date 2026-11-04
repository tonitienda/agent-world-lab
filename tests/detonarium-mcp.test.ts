import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentView } from "../src/detonarium/session.js";

test("the MCP observation, action and game-over routes all enforce hidden rival stats", async () => {
  const folder = mkdtempSync(join(tmpdir(), "detonarium-api-test-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/mcp/detonarium.ts"],
    cwd: resolve(import.meta.dirname, ".."),
    env: { ...process.env, SESSION_LOG_DIR: folder, DETONARIUM_BOTS: "passive,passive,passive", AGENT_LABEL: "Claude" } as Record<string, string>,
  });
  const client = new Client({ name: "detonarium-api-test", version: "0.0.0" });
  const check = (view: AgentView) => {
    assert.ok(view.you.range > 0);
    for (const rival of view.rivals) assert.deepEqual(Object.keys(rival).sort(), ["alive", "name", "pos", "symbol"]);
    for (const bomb of view.bombs) if (bomb.owner !== "Claude") assert.equal(Object.hasOwn(bomb, "range"), false);
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError);
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  const speech = { intention: "test", narration: "Let's have a look." };
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ["finish_session", "move_to", "observe", "place_bomb", "step", "wait"]);
    check(await call("observe"));
    check((await call("place_bomb", speech)).view);
    const refused = await call("place_bomb", speech);
    assert.equal(refused.ok, false);
    check(refused.view);
    check((await call("step", { ...speech, action: "right" })).view);
    check((await call("move_to", { ...speech, x: 0, y: 0 })).view);
    check((await call("wait", { ...speech, ticks: 1 })).view);
    await call("finish_session");
    const over = await call("step", { ...speech, action: "stay" });
    assert.equal(over.ok, false);
    check(over.view);
  } finally {
    await client.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
