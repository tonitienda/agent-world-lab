/** Invoked by the disposable survival suite, never against the experiment world. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { minecraftCapabilities } from "../src/environments/minecraft/adapter.js";

if (
  process.env.AWL_DISPOSABLE_TEST !== "1" ||
  !process.env.MC_PORT ||
  process.env.MC_PORT === "25565"
)
  throw Error("Requires a disposable fixture on a random port");
const root = resolve(import.meta.dirname, "..");
for (const outcome of ["completed", "stopped", "aborted"] as const) {
  const folder = mkdtempSync("/private/tmp/awl-mcp-session-");
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      RECORD_MP4: undefined,
      SESSION_LOG_DIR: folder,
    }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", join(root, "src/mcp/main.ts")],
    cwd: root,
    env,
    stderr: "inherit",
  });
  const client = new Client({ name: "fixture", version: "1.0" });
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of [
      ...minecraftCapabilities,
      "world_info",
      "report_intention",
      "finish_session",
    ])
      assert.ok(names.includes(name), name);
    await client.callTool({ name: "observe", arguments: {} });
    const invalid = await client
      .callTool({
        name: "craft",
        arguments: {
          item: "oak_planks",
          count: -1,
          intent: "I will check this request.",
        },
      })
      .catch((error) => ({ isError: true, message: String(error) }));
    assert.ok(
      invalid.isError,
      "MCP must reject invalid quantities before executing them",
    );
    const result = await client.callTool({
      name: "craft",
      arguments: {
        item: "diamond_pickaxe",
        count: 1,
        intent:
          "I will check whether I have the materials for a diamond pickaxe.",
      },
    });
    assert.match(JSON.stringify(result), /Missing ingredients/);
    if (outcome === "completed")
      await client.callTool({ name: "finish_session", arguments: {} });
    else
      execFileSync(
        process.execPath,
        ["--import", "tsx", join(root, "scripts/session-control.ts"), outcome],
        { cwd: root, env, encoding: "utf8" },
      );
    for (let i = 0; i < 50; i++) {
      try {
        JSON.parse(readFileSync(join(folder, "mcp-session.json"), "utf8"));
        break;
      } catch {
        await delay(100);
      }
    }
    const metadata = JSON.parse(
      readFileSync(join(folder, "mcp-session.json"), "utf8"),
    );
    assert.equal(metadata.outcome, outcome);
    const events = JSON.parse(
      readFileSync(join(folder, "events.json"), "utf8"),
    );
    assert.equal(
      events.filter((e: { action: string }) => e.action === "session_end")
        .length,
      1,
    );
    const intention = events.findIndex(
      (e: { action: string }) => e.action === "report_intention",
    );
    const attempt = events.findIndex(
      (e: { action: string }) => e.action === "craft_start",
    );
    const completion = events.findIndex(
      (e: { action: string }) => e.action === "craft",
    );
    assert.ok(intention < attempt && attempt < completion);
    assert.equal(events[completion].details.result.ok, false);
    console.log(
      `PASS: MCP registration, failed-action narration and ${outcome} finalization`,
      folder,
    );
  } finally {
    await client.close();
  }
}
