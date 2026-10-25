import {mkdirSync, renameSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";

/** Small, durable JSON array compatible with the episode planner. */
export class SessionEvents {
  readonly folder: string;
  private readonly entries: Record<string, unknown>[] = [];
  constructor(folder: string) {
    this.folder = resolve(folder);
    mkdirSync(this.folder, {recursive: true});
    this.add("session_start", {agent: process.env.AGENT_ID ?? "explorer-1", source: "mcp"});
  }
  add(action: string, details: unknown) {
    this.entries.push({at: new Date().toISOString(), action, details});
    const file = join(this.folder, "events.json");
    const temporary = join(this.folder, "events.json.tmp");
    writeFileSync(temporary, JSON.stringify(this.entries, null, 2) + "\n");
    renameSync(temporary, file);
  }
}
