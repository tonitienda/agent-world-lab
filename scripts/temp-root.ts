import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

/** Fixture folders are bind-mounted into Docker: /private/tmp is shared by Docker Desktop on macOS; Linux uses the OS temp dir. */
export const tempRoot = existsSync("/private/tmp") ? "/private/tmp" : tmpdir();
