import { writeFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { activeLock, sessionLockPath } from "../src/session/lock.js";
const outcome = process.argv[2];
if (!["completed", "stopped", "aborted"].includes(outcome))
  throw Error("Usage: npm run session:control -- completed|stopped|aborted");
const owner = activeLock();
// A solo session has one mcp-control-ready marker; a team take has one per member.
const ready = owner && owner.kind.includes("session")
  ? readdirSync(sessionLockPath).filter((name) => /^mcp-control-ready(-[A-Za-z0-9_-]+)?$/.test(name))
  : [];
if (!ready.length) throw Error("No active Minecraft MCP session");
for (const marker of ready) {
  const id = marker.slice("mcp-control-ready".length);
  const temp = join(sessionLockPath, `control-${process.pid}${id}.tmp`);
  writeFileSync(temp, JSON.stringify({ outcome }));
  renameSync(temp, join(sessionLockPath, id ? `control${id}.json` : "control.json"));
}
console.log(
  `Requested ${outcome} for ${ready.length} session(s); wait for the MCP process(es) to finalize. Reset remains blocked until the lock is released.`,
);
