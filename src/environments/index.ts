import type { WorldAdapter } from "../core/types.js";
import { MinecraftAdapter } from "./minecraft/adapter.js";

/** Register another environment here; do not import it into core or MCP. */
export function createWorld(id = process.env.WORLD_ADAPTER ?? "minecraft"): WorldAdapter {
  switch (id) {
    case "minecraft": return new MinecraftAdapter();
    default: throw new Error(`Unknown world adapter: ${id}`);
  }
}
