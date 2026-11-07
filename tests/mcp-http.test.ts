import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { serveHttp } from "../src/mcp/http.js";

const token = "t".repeat(64);
async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return port;
}
async function start() {
  const port = await freePort();
  const mcp = new McpServer({ name: "test", version: "0" });
  mcp.registerTool("ping", { description: "ping" }, async () => ({ content: [{ type: "text", text: "pong" }] }));
  const http = await serveHttp(mcp, { EMERGENCE_MCP_HTTP_PORT: String(port), EMERGENCE_MCP_HTTP_TOKEN: token });
  return { url: new URL(`http://127.0.0.1:${port}/mcp`), http, mcp };
}
const client = (url: URL, bearer: string) => {
  const c = new Client({ name: "player", version: "0" });
  return { c, connect: () => c.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${bearer}` } } })) };
};

test("the player with the token reaches the game tools", async () => {
  const { url, http, mcp } = await start();
  try {
    const p = client(url, token);
    await p.connect();
    assert.deepEqual((await p.c.listTools()).tools.map((t) => t.name), ["ping"]);
    const result = await p.c.callTool({ name: "ping" });
    assert.equal((result.content as { text: string }[])[0].text, "pong");
    // A second player cannot take over the session.
    await assert.rejects(client(url, token).connect());
    await p.c.close();
  } finally {
    http.close();
    await mcp.close();
  }
});

test("requests without the exact token are refused before MCP", async () => {
  const { url, http, mcp } = await start();
  try {
    for (const authorization of [undefined, "Bearer wrong", `Bearer ${token}x`, token]) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: "{}" });
      assert.equal(response.status, 401);
    }
    const other = await fetch(new URL("/other", url), { headers: { authorization: `Bearer ${token}` } });
    assert.equal(other.status, 404);
  } finally {
    http.close();
    await mcp.close();
  }
});

test("weak tokens and invalid ports are rejected", async () => {
  const mcp = new McpServer({ name: "test", version: "0" });
  await assert.rejects(serveHttp(mcp, { EMERGENCE_MCP_HTTP_PORT: "40000", EMERGENCE_MCP_HTTP_TOKEN: "short" }));
  await assert.rejects(serveHttp(mcp, { EMERGENCE_MCP_HTTP_PORT: "80", EMERGENCE_MCP_HTTP_TOKEN: token }));
});
