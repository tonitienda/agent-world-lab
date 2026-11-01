import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

/** Fixture folders are bind-mounted into Docker: /private/tmp is shared by Docker Desktop on macOS; Linux uses the OS temp dir. */
export const tempRoot = existsSync("/private/tmp") ? "/private/tmp" : tmpdir();

/**
 * Linux bind mounts keep real ownership, and the server image chowns /data to its own uid (1000),
 * so a runner with another uid could no longer write into its fixture folder. Run the server as the
 * host user there; Docker Desktop maps ownership itself.
 */
const linuxUid = process.platform === "linux" ? process.getuid?.() : undefined;
export const serverUid = String(linuxUid ?? 1000);
export const serverUserEnv = linuxUid === undefined ? [] : ["-e", `UID=${linuxUid}`, "-e", `GID=${process.getgid!()}`];
