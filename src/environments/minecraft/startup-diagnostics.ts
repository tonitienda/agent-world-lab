import { spawnSync } from "node:child_process";

/** Read-only, bounded startup evidence; never retry a reset or change Docker state. */
export function startupDiagnostics(
  root: string,
  capture = (args: string[]): string => {
    const result = spawnSync("docker", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 256 * 1024,
    });
    return [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join("\n");
  },
): string {
  const sections: string[] = [];
  for (const [label, args] of [
    ["Container status", ["compose", "ps", "-a", "minecraft"]],
    ["Recent Minecraft startup logs", ["compose", "logs", "--no-color", "--tail", "100", "minecraft"]],
  ] as const) {
    try {
      const output = capture([...args]).trim();
      if (output) sections.push(`${label}:\n${output.slice(-16_000)}`);
    } catch {
      // Diagnostics must not replace the original startup error.
    }
  }
  const output = sections.join("\n\n");
  const hint = /UnknownHostException|SERVFAIL|Failed to resolve|Could not resolve host/i.test(output)
    ? "Minecraft startup encountered a DNS failure. Check Docker DNS/network access to the download host named in the logs. A runtime cache miss needs server downloads; changing the scenario prompt will not fix this."
    : "Inspect the container startup error below. A health-check failure alone does not identify the cause.";
  return `${hint}\n${output}\nNo automatic reset retry was attempted. After fixing startup, rerun the pipeline to complete installation and validation; container health alone does not mean the scenario is installed.`;
}
