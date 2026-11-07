import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type Server } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Serves one authenticated MCP client session over streamable HTTP, for players
 * that run in a container (Codex). Only POST/GET/DELETE /mcp with the exact
 * bearer token reach the transport; the transport itself refuses a second
 * initialize, so the first player to connect owns the session.
 */
export async function serveHttp(server: McpServer, env: NodeJS.ProcessEnv): Promise<Server> {
  const port = Number(env.EMERGENCE_MCP_HTTP_PORT);
  const host = env.EMERGENCE_MCP_HTTP_HOST ?? "127.0.0.1";
  const token = env.EMERGENCE_MCP_HTTP_TOKEN ?? "";
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid EMERGENCE_MCP_HTTP_PORT");
  if (token.length < 32) throw Error("EMERGENCE_MCP_HTTP_TOKEN must be at least 32 characters");
  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = (header: string | undefined) => {
    const given = Buffer.from(header ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await server.connect(transport);
  const http = createServer((request, reply) => {
    if (!authorized(request.headers.authorization)) {
      reply.writeHead(401).end();
      return;
    }
    if (!request.url || new URL(request.url, "http://mcp").pathname !== "/mcp") {
      reply.writeHead(404).end();
      return;
    }
    transport.handleRequest(request, reply).catch((error) => {
      process.stderr.write(`MCP HTTP request failed: ${String(error)}\n`);
      if (!reply.headersSent) reply.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => resolve());
  });
  return http;
}
