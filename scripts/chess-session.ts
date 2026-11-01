// Play one game: Claude (MCP-only, same isolation as the episode harness) vs Stockfish, then record it.
// Usage: tsx scripts/chess-session.ts [--side white|black] [--elo 1500|full] [--model id] [--movetime ms] [--out dir] [--no-record]
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { withRationales } from "./chess-rationale.js";

const { values } = parseArgs({
  options: {
    side: { type: "string", default: "white" },
    elo: { type: "string", default: "1500" },
    model: { type: "string", default: "claude-opus-5-5" },
    movetime: { type: "string", default: "500" },
    out: { type: "string" },
    "no-record": { type: "boolean", default: false },
  },
});
const root = resolve(import.meta.dirname, "..");
const out = resolve(values.out ?? `data/chess-sessions/${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });

const label = values.model.replace(/^claude-/, "Claude ").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/\b(opus|sonnet|haiku|fable)\b/, (m) => m[0].toUpperCase() + m.slice(1));
const mcpConfig = {
  mcpServers: {
    "agent-world": {
      command: process.execPath,
      args: ["--import", "tsx", resolve(root, "src/mcp/chess.ts")],
      cwd: root,
      env: {
        SESSION_LOG_DIR: resolve(out, "session"),
        CHESS_SIDE: values.side,
        CHESS_ELO: values.elo,
        CHESS_MOVETIME_MS: values.movetime,
        AGENT_ID: "claude",
        AGENT_LABEL: label,
      },
    },
  },
};
const configPath = resolve(out, "mcp-config.json");
writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2));
const prompt = readFileSync(resolve(root, "episodes/episode-003/goal.md"), "utf8").replaceAll("{{SIDE}}", values.side);

// Mirrors internal/harness ClaudeIsolationArgs + player flags.
const args = [
  "--restricted", "--setting-sources", "", "--settings", `{"disableAllHooks":true,"autoMemoryEnabled":false,"claudeMdExcludes":["**"]}`,
  "--disable-slash-commands", "--no-chrome", "--strict-mcp-config",
  "--print", "--no-session-persistence", "--permission-mode", "dontAsk", "--tools", "",
  "--mcp-config", configPath, "--allowedTools", "mcp__agent-world__*",
  "--output-format", "stream-json", "--verbose",
  "--model", values.model,
];
console.log(`${label} (${values.side}) vs Stockfish ${values.elo} → ${out}`);
const child = spawn("claude", args, { cwd: out, stdio: ["pipe", "pipe", "pipe"] });
child.stdin.end(prompt);
child.stdout.pipe(createWriteStream(resolve(out, "transcript.jsonl")));
child.stderr.pipe(createWriteStream(resolve(out, "claude.stderr.log")));
const code: number = await new Promise((done) => child.on("close", done));
console.log(`claude exited with ${code}`);

// The recorder gets an enriched copy: the agent's free text attached to its moves as rationale.
const replay = withRationales(JSON.parse(readFileSync(resolve(out, "session/replay.json"), "utf8")), readFileSync(resolve(out, "transcript.jsonl"), "utf8"));
const replayPath = resolve(out, "replay.json");
writeFileSync(replayPath, JSON.stringify(replay, null, 2));
console.log(`${replay.moves.length} plies, ${replay.illegal.length} illegal attempts, result ${JSON.stringify(replay.result)}`);
if (!values["no-record"])
  execFileSync(process.execPath, ["--import", "tsx", resolve(root, "packages/chess/examples/record.ts"), out, replayPath], { stdio: "inherit", cwd: root });
