// Play Detonarium games: Claude (MCP-only, same isolation as the episode harness) vs CPU bots.
// Each game is its own Claude process and session folder; games do not share notes (yet).
// Usage: tsx scripts/detonarium-session.ts [--games 3] [--seed 1] [--bots hunter,hunter,hunter]
//        [--model id] [--alert-radius 4] [--out dir]
// Seeds are seed, seed+1, ... per game. Recording to video is a separate step.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    games: { type: "string", default: "1" },
    seed: { type: "string", default: "1" },
    bots: { type: "string", default: "hunter,hunter,hunter" },
    model: { type: "string", default: "claude-opus-5-5" },
    "alert-radius": { type: "string", default: "4" },
    out: { type: "string" },
  },
});
const root = resolve(import.meta.dirname, "..");
const out = resolve(values.out ?? `data/detonarium-sessions/${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });
const games = Number(values.games);
const firstSeed = Number(values.seed);
const label = values.model.replace(/^claude-/, "Claude ").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/\b(opus|sonnet|haiku|fable)\b/, (m) => m[0].toUpperCase() + m.slice(1));
const botCount = values.bots.split(",").length;
const prompt = readFileSync(resolve(root, "episodes/episode-004/goal.md"), "utf8").replaceAll("{{RIVALS}}", String(botCount));

const summary: { game: number; seed: number; exit: number; result: string | null; ticks: number | null }[] = [];
for (let game = 1; game <= games; game++) {
  const seed = firstSeed + game - 1;
  const dir = resolve(out, `game-${game}`);
  if (existsSync(resolve(dir, "session"))) throw new Error(`${dir} already has a session; choose a new --out`);
  mkdirSync(dir, { recursive: true });
  const configPath = resolve(dir, "mcp-config.json");
  writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      "agent-world": {
        command: process.execPath,
        args: ["--import", "tsx", resolve(root, "src/mcp/detonarium.ts")],
        cwd: root,
        env: {
          SESSION_LOG_DIR: resolve(dir, "session"),
          DETONARIUM_SEED: String(seed),
          DETONARIUM_BOTS: values.bots,
          DETONARIUM_ALERT_RADIUS: values["alert-radius"],
          AGENT_ID: "claude",
          AGENT_LABEL: label,
        },
      },
    },
  }, null, 2));

  // Mirrors internal/harness ClaudeIsolationArgs + player flags (see scripts/chess-session.ts).
  const args = [
    "--restricted", "--setting-sources", "", "--settings", `{"disableAllHooks":true,"autoMemoryEnabled":false,"claudeMdExcludes":["**"]}`,
    "--disable-slash-commands", "--no-chrome", "--strict-mcp-config",
    "--print", "--no-session-persistence", "--permission-mode", "dontAsk", "--tools", "",
    "--mcp-config", configPath, "--allowedTools", "mcp__agent-world__*",
    "--output-format", "stream-json", "--verbose",
    "--model", values.model,
  ];
  console.log(`game ${game}/${games}: ${label} vs ${values.bots} (seed ${seed}) → ${dir}`);
  const started = Date.now();
  const child = spawn("claude", args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(prompt);
  child.stdout.pipe(createWriteStream(resolve(dir, "transcript.jsonl")));
  child.stderr.pipe(createWriteStream(resolve(dir, "claude.stderr.log")));
  const exit: number = await new Promise((done) => child.on("close", done));

  const eventsFile = resolve(dir, "session/events.json");
  const events: { action: string; details: Record<string, unknown> }[] = existsSync(eventsFile) ? JSON.parse(readFileSync(eventsFile, "utf8")) : [];
  const finish = [...events].reverse().find((e) => e.action === "session_finish" || e.action === "match_finished_without_agent");
  const replayFile = resolve(dir, "session/replay.json");
  const ticks = existsSync(replayFile) ? JSON.parse(readFileSync(replayFile, "utf8")).ticks.length : null;
  const result = (finish?.details.result as string | undefined) ?? null;
  summary.push({ game, seed, exit, result, ticks });
  console.log(`  claude exited ${exit} after ${((Date.now() - started) / 60000).toFixed(1)} min; ${ticks ?? "?"} ticks; ${result ?? "no result recorded"}`);
}
writeFileSync(resolve(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`summary → ${resolve(out, "summary.json")}`);
