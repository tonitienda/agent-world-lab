// Record a four-player Ada and Bram free-for-all. A provider exit while alive
// preserves the attempt and aborts the game without awarding a win.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout } from "node:timers/promises";
import { createBot, createMatch, newReplay, step, type Action, type MatchEvent } from "../packages/detonarium/src/index.js";
import { characterBrief, characterLabel, lookupCharacter } from "../src/characters.js";
import { observeArena } from "../src/detonarium/session.js";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(process.argv[2] ?? "data/detonarium-sessions/episode-008/game-1");
const seed = Number(process.argv[3] ?? 8);
if (!Number.isSafeInteger(seed)) throw new Error("Seed must be an integer");
mkdirSync(dir, { recursive: false });
const session = join(dir, "session");
mkdirSync(session);
const cast = ["ada", "bram"].map((id) => lookupCharacter(id));
const names = [...cast.map(characterLabel), "Hunter 1", "Hunter 2"];
const bots = [2, 3].map(id => createBot("hunter", id, seed * 10 + id));
let state = createMatch({ seed, rules: { players: 4, width: 15, height: 15, crateDensity: 0.38, suddenDeathTick: 96, maxTicks: 240 } });
const replay = newReplay(state, names.map((name, i) => ({ name, kind: cast[i]?.family ?? "hunter" })));
type Input = { action: Action; narration?: string; timing?: "decision" | "outcome" };
type Request = { id: string; input: Input | null };
const calls: { tick: number; speaker: string; input: Input; events: MatchEvent[] }[] = [];
const save = (name: string, value: unknown, folder = session) => {
  const file = join(folder, name);
  writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n");
  renameSync(file + ".tmp", file);
};
const work = mkdtempSync(join(tmpdir(), "detonarium-duel-"));
const deadline = Date.now() + 50 * 60_000;
const models = [process.env.DETONARIUM_CLAUDE_MODEL ?? "sonnet", process.env.DETONARIUM_CODEX_MODEL];
const prompt = readFileSync(join(root, "episodes/episode-008/goal.md"), "utf8");
writeFileSync(join(session, "goal.md"), prompt);
const seats = cast.map((character, i) => {
  const cwd = join(work, character.id);
  mkdirSync(cwd);
  const command = character.family;
  const args = ["--import", join(root, "node_modules/tsx/dist/loader.mjs"), join(root, "src/mcp/detonarium-duel.ts"), cwd];
  const config = join(cwd, "mcp.json");
  save("mcp.json", { mcpServers: { arena: { command: process.execPath, args } } }, cwd);
  const flags = i === 0
    ? ["--restricted", "--setting-sources", "", "--settings", '{"disableAllHooks":true,"autoMemoryEnabled":false,"claudeMdExcludes":["**"]}', "--disable-slash-commands", "--no-chrome", "--strict-mcp-config", "--print", "--no-session-persistence", "--permission-mode", "dontAsk", "--tools", "", "--mcp-config", config, "--allowedTools", "mcp__arena__*", "--output-format", "stream-json", "--verbose", "--model", models[0]!]
    : ["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--json", "-c", "approval_policy=never", "-c", "web_search=disabled", "-c", "model_reasoning_effort=low", "-c", `mcp_servers.arena.command=${JSON.stringify(process.execPath)}`, "-c", `mcp_servers.arena.args=${JSON.stringify(args)}`, "-c", "mcp_servers.arena.tool_timeout_sec=240", "-c", 'mcp_servers.arena.default_tools_approval_mode="approve"', ...(models[1] ? ["--model", models[1]] : []), "-"];
  const child = spawn(command, flags, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const seat = { character, cwd, child, exit: null as string | null, last: "", pending: null as Request | null };
  child.on("error", (error) => { seat.exit = error.message; });
  child.on("exit", (code, signal) => { seat.exit = String(code ?? signal); });
  child.stdin.on("error", () => {});
  child.stdin.end(`You are ${names[i]}.\n\n${prompt}\n${characterBrief(character)}`);
  child.stdout.pipe(createWriteStream(join(dir, character.id + ".jsonl")));
  child.stderr.pipe(createWriteStream(join(dir, character.id + ".stderr.log")));
  return seat;
});
save("configuration.json", { seed, rules: state.rules, cast, models, policy: "Simultaneous actions. Both LLM seats get redacted views. Hunters use engine state. No wall-clock tie break." });
const result = () => !state.over ? null : state.winner === null ? "draw" : `${names[state.winner]} wins`;
function respond(i: number, request: Request, events: MatchEvent[] = []) {
  save("response.json", { id: request.id, value: { view: observeArena(state, names, i, result()), events } }, seats[i].cwd);
}
try {
  save("replay.json", replay);
  save("calls.json", calls);
  while (!state.over) {
    if (Date.now() >= deadline) throw new Error("Match exceeded its 50-minute time budget");
    for (const [i, seat] of seats.entries()) {
      if (seat.exit !== null && state.players[i].alive) throw new Error(`${seat.character.name} exited (${seat.exit}) at tick ${state.tick}`);
      if (seat.pending) continue;
      const file = join(seat.cwd, "request.json");
      let request: Request;
      try { request = JSON.parse(readFileSync(file, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (request.id === seat.last) continue;
      seat.last = request.id;
      if (request.input === null) respond(i, request);
      else seat.pending = request;
    }
    const [ada, bram] = seats.map((seat) => seat.pending);
    const requests = [ada, bram];
    if (requests.every((request, i) => !state.players[i].alive || request?.input)) {
      const actions: Action[] = [
        ...requests.map((request, i): Action => state.players[i].alive ? request!.input!.action : "stay"),
        ...bots.map(bot => bot(state)),
      ];
      const tick = state.tick;
      const settled = step(state, actions);
      state = settled.state;
      replay.ticks.push({ actions });
      for (const [i, request] of requests.entries()) {
        if (!request?.input) continue;
        calls.push({ tick, speaker: seats[i].character.id, input: request.input, events: settled.events });
        respond(i, request, settled.events);
      }
      save("replay.json", replay);
      save("calls.json", calls);
      for (const seat of seats) seat.pending = null;
      console.log(`Tick ${state.tick}: ${actions.join(" / ")}${state.over ? ` · ${result()}` : ""}`);
    }
    await setTimeout(100);
  }
  save("result.json", { result: result(), winner: state.winner, ticks: state.tick });
  await setTimeout(2000);
} finally {
  for (const seat of seats) seat.child.kill();
  rmSync(work, { recursive: true, force: true });
}
