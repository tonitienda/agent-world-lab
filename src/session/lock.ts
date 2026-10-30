import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";

export const sessionLockPath = resolve(
  import.meta.dirname,
  "../../data/active-session.lock",
);
export function activeLock(
  path = sessionLockPath,
): { pid: number; kind: string } | undefined {
  if (!existsSync(path)) return;
  // A malformed or just-created lock is conservatively active. Never guess that it is stale.
  const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
  if (!Number.isInteger(owner.pid) || owner.pid <= 0)
    throw Error("Invalid session lock; inspect manually");
  try {
    process.kill(owner.pid, 0);
    return owner;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
  }
  // A killed Go supervisor must not make its still-running MCP child look stale.
  const delegates = join(path, "delegates");
  if (existsSync(delegates)) for (const name of readdirSync(delegates)) {
    const child = JSON.parse(readFileSync(join(delegates, name), "utf8"));
    if (!Number.isInteger(child.pid) || child.pid <= 0) throw Error("Invalid delegated session lock; inspect manually");
    try { process.kill(child.pid, 0); return child; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; }
  }
}
export function acquireLock(kind: string, path = sessionLockPath) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  // A Go supervisor holds one reservation across reset, setup, capture and
  // finalization. Only its explicitly delegated subprocesses may nest inside it.
  if (process.env.EMERGENCE_LEASE && existsSync(join(path, "owner.json"))) {
    const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
    if (owner.token === process.env.EMERGENCE_LEASE &&
        String(owner.pid) === process.env.EMERGENCE_OWNER_PID && activeLock(path)) {
      const delegates = join(path, "delegates");
      mkdirSync(delegates, {recursive:true});
      const delegate = join(delegates, String(process.pid));
      writeFileSync(delegate, JSON.stringify({pid:process.pid,kind}));
      return () => { rmSync(delegate, {force:true}); }; // Parent owns the reservation.
    }
  }
  if (existsSync(path)) {
    const owner = activeLock(path);
    if (owner)
      throw Error(
        `Active ${owner.kind} (PID ${owner.pid}); finalize it before resetting or connecting`,
      );
    // Serialize stale-owner recovery inside the old lock. A competing recovery
    // must recheck the owner after obtaining this guard, including after replacement.
    const reclaim = join(path, "reclaim");
    mkdirSync(reclaim);
    try {
      if (activeLock(path))
        throw Error("Session became active during stale lock recovery");
      rmSync(path, { recursive: true });
      mkdirSync(path);
      writeFileSync(
        join(path, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          kind,
          startedAt: new Date().toISOString(),
        }),
      );
    } catch (e) {
      rmSync(reclaim, { recursive: true, force: true });
      throw e;
    }
    let released = false;
    return () => {
      if (!released) {
        rmSync(path, { recursive: true });
        released = true;
      }
    };
  }
  mkdirSync(path); // Atomic exclusion between reset and session startup.
  writeFileSync(
    join(path, "owner.json"),
    JSON.stringify({
      pid: process.pid,
      kind,
      startedAt: new Date().toISOString(),
    }),
  );
  let released = false;
  return () => {
    if (!released) {
      rmSync(path, { recursive: true });
      released = true;
    }
  };
}
