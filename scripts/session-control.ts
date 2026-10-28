import { writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { activeLock, sessionLockPath } from "../src/session/lock.js";
const outcome = process.argv[2];
if (!["completed", "stopped", "aborted"].includes(outcome))
  throw Error("Usage: npm run session:control -- completed|stopped|aborted");
const owner = activeLock();
if (
  !owner ||
  !owner.kind.includes("session") ||
  !existsSync(join(sessionLockPath, "mcp-control-ready"))
)
  throw Error("No active Minecraft MCP session");
const temp = join(sessionLockPath, `control-${process.pid}.tmp`);
writeFileSync(temp, JSON.stringify({ outcome }));
renameSync(temp, join(sessionLockPath, "control.json"));
console.log(
  `Requested ${outcome}; wait for the MCP process to finalize. Reset remains blocked until its lock is released.`,
);
