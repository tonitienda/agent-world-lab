// Play Detonarium games: Claude (MCP-only, same isolation as the episode harness) vs CPU bots.
// Each game is its own Claude process and session folder; games do not share notes (yet).
// Usage: tsx scripts/detonarium-session.ts [--episode episodes/episode-004/episode.yaml]
//        [--games 3] [--seed 1] [--bots hunter,hunter,hunter] [--model id] [--alert-radius 4]
//        [--max-macro-ticks 20] [--out dir] [--stand-in hunter]
// Settings come from the episode file; any flag given overrides it. The settings actually used
// are saved as run.json in the output folder, next to a copy of the prompt.
// --stand-in plays the agent slot with a CPU bot instead of Claude, in-process, and writes the
// same session files: for testing the recorder and editing without spending a real game.
// Seeds are seed, seed+1, ... per game. Recording to video is a separate step.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createBot, type BotKind } from "../packages/detonarium/src/index.js";
import { loadEpisode } from "../src/detonarium/episode.js";
import { DetonariumSession } from "../src/detonarium/session.js";
import { SessionEvents } from "../src/mcp/session-events.js";

const root = resolve(import.meta.dirname, "..");
const { values: flags } = parseArgs({
  options: {
    episode: { type: "string", default: resolve(root, "episodes/episode-004/episode.yaml") },
    games: { type: "string" },
    seed: { type: "string" },
    bots: { type: "string" },
    model: { type: "string" },
    "alert-radius": { type: "string" },
    "max-macro-ticks": { type: "string" },
    out: { type: "string" },
    "stand-in": { type: "string" },
  },
});
const episode = loadEpisode(flags.episode);
const settings = {
  episode: episode.episode,
  episodeFile: relative(root, resolve(flags.episode)),
  games: Number(flags.games ?? episode.games),
  seed: Number(flags.seed ?? episode.environment.seed),
  bots: flags.bots ? (flags.bots.split(",").map((b) => b.trim()) as BotKind[]) : episode.environment.bots,
  model: flags.model ?? episode.player.model,
  alertRadius: Number(flags["alert-radius"] ?? episode.environment.alert_radius),
  maxMacroTicks: Number(flags["max-macro-ticks"] ?? episode.environment.max_macro_ticks),
  standIn: flags["stand-in"] ?? null,
  overrides: Object.keys(flags).filter((k) => !["episode", "out"].includes(k)),
};
const values = { ...flags, bots: settings.bots.join(","), model: settings.model, "alert-radius": String(settings.alertRadius) };
const out = resolve(flags.out ?? `data/detonarium-sessions/${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });
const games = settings.games;
const firstSeed = settings.seed;
const label = values.model.replace(/^claude-/, "Claude ").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/\b(opus|sonnet|haiku|fable)\b/, (m) => m[0].toUpperCase() + m.slice(1));
const botCount = settings.bots.length;
const prompt = readFileSync(episode.promptPath, "utf8").replaceAll("{{RIVALS}}", String(botCount));
writeFileSync(resolve(out, "run.json"), JSON.stringify(settings, null, 2) + "\n");
writeFileSync(resolve(out, "goal.md"), prompt);

const summary: { game: number; seed: number; exit: number; result: string | null; ticks: number | null }[] = [];
for (let game = 1; game <= games; game++) {
  const seed = firstSeed + game - 1;
  const dir = resolve(out, `game-${game}`);
  if (existsSync(resolve(dir, "session"))) throw new Error(`${dir} already has a session; choose a new --out`);
  mkdirSync(dir, { recursive: true });
  if (values["stand-in"]) {
    const kind = values["stand-in"] as BotKind;
    const session = new DetonariumSession({ seed, bots: values.bots.split(",") as BotKind[], agentName: `Stand-in (${kind})`, alertRadius: settings.alertRadius, maxMacroTicks: settings.maxMacroTicks });
    const events = new SessionEvents(resolve(dir, "session"));
    events.add("detonarium_configuration", { seed, bots: values.bots.split(","), rules: session.state.rules, standIn: kind });
    const player = createBot(kind, 0, seed * 10);
    while (session.agentAlive && !session.state.over) {
      const action = player(session.state);
      const result = session.stepOnce(action, `[stand-in] ${action}`);
      events.add("step", { action, ticks: result.ticks, stoppedBecause: result.stoppedBecause, happened: result.happened, tick: result.view.tick, pos: result.view.you.pos });
    }
    session.finishWithoutAgent();
    events.add("session_finish", { result: session.result(), ticks: session.state.tick, calls: session.calls.length });
    for (const [name, data] of [["replay.json", session.replay], ["calls.json", session.calls], ["outcome.json", session.outcome()]] as const) {
      const file = resolve(dir, "session", name);
      writeFileSync(file + ".tmp", JSON.stringify(data, null, 2) + "\n");
      renameSync(file + ".tmp", file);
    }
    summary.push({ game, seed, exit: 0, result: session.result(), ticks: session.state.tick });
    console.log(`game ${game}/${games}: stand-in ${kind} vs ${values.bots} (seed ${seed}) → ${dir}: ${session.state.tick} ticks; ${session.result()}`);
    continue;
  }
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
          DETONARIUM_ALERT_RADIUS: String(settings.alertRadius),
          DETONARIUM_MAX_MACRO_TICKS: String(settings.maxMacroTicks),
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
