import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const separator = process.argv.indexOf("--");
const args = separator === -1 ? process.argv.slice(2) : process.argv.slice(separator + 1);
if (args.length === 0) {
  console.error("Usage: npm run record -- <command> [arguments...] (e.g. npm run record -- npm run smoke)");
  process.exit(2);
}
const [command, ...commandArgs] = args;
const id = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
const folder = join("data", "recordings", id);
mkdirSync(folder, { recursive: true });
const events = createWriteStream(join(folder, "events.jsonl"), { flags: "wx" });
const createdAt = new Date().toISOString();
const meta = {
  id, createdAt, command: args, adapter: process.env.WORLD_ADAPTER ?? "minecraft",
  agentId: process.env.AGENT_ID ?? "explorer-1",
  note: "Capture your Minecraft client separately via Replay Mod/Flashback or OBS. This script records process output only."
};
writeFileSync(join(folder, "session.json"), JSON.stringify(meta, null, 2) + "\n");
function log(type: string, data: Record<string, unknown> = {}) {
  events.write(JSON.stringify({ at: new Date().toISOString(), type, ...data }) + "\n");
}
log("session_start", { command: args });
console.error("Recording session:", folder);
console.error("VIDEO SYNC MARKER:", id, createdAt);
const child = spawn(command, commandArgs, { stdio: ["inherit", "pipe", "pipe"], env: process.env, shell: false });
function forward(stream: NodeJS.ReadableStream | null, type: "stdout" | "stderr") {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    (type === "stdout" ? process.stdout : process.stderr).write(chunk);
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) log("process_output", { stream: type, line });
  });
  stream.on("end", () => {
    if (buffer) log("process_output", { stream: type, line: buffer });
  });
}
forward(child.stdout, "stdout");
forward(child.stderr, "stderr");
let finished = false;
function finish(code: number | null, signal: NodeJS.Signals | null, error?: string) {
  if (finished) return;
  finished = true;
  log("session_end", { code, signal, error });
  events.end();
  process.exitCode = code ?? 1;
}
child.on("error", error => { console.error(error); finish(null, null, error.message); });
child.on("close", (code, signal) => finish(code, signal));
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { if (!finished) child.kill(sig); });
}
