import mineflayer, { type Bot } from "mineflayer";
import pathfinderModule from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import type { ActionResult, WorldAdapter } from "../../core/types.js";

const { pathfinder, Movements, goals } = pathfinderModule;
const { GoalNear } = goals;
const MAX_COORD = 30_000_000;
function intAt(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || Math.abs(v) > MAX_COORD)
    throw new Error(`Invalid ${label}: expected bounded integer`);
  return v;
}
function xyz(args: Record<string, unknown>): Vec3 {
  return new Vec3(intAt(args.x, "x"), intAt(args.y, "y"), intAt(args.z, "z"));
}
function withTimeout<T>(task: Promise<T>, ms = 30000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Action timed out")), ms);
    task.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

export class MinecraftAdapter implements WorldAdapter {
  readonly id = "minecraft";
  readonly capabilities = ["observe", "inventory", "move_to", "mine", "place", "say"] as const;
  private bot?: Bot;

  async connect(): Promise<void> {
    if (this.bot) return;
    const bot = mineflayer.createBot({
      host: process.env.MC_HOST ?? "127.0.0.1",
      port: Number(process.env.MC_PORT ?? "25565"),
      username: process.env.AGENT_ID ?? "explorer-1",
      auth: "offline",
      // Allow negotiation rather than assuming the configured server protocol.
    });
    this.bot = bot;
    bot.loadPlugin(pathfinder);
    try {
      await withTimeout(new Promise<void>((resolve, reject) => {
        bot.once("spawn", () => resolve());
        bot.once("error", reject);
        bot.once("end", () => reject(new Error("Disconnected before spawn")));
      }), 60000);
      bot.pathfinder.setMovements(new Movements(bot));
    } catch (e) {
      bot.end();
      this.bot = undefined;
      throw e;
    }
  }

  private get ready(): Bot {
    if (!this.bot?.entity) throw new Error("Agent not connected / spawned");
    return this.bot;
  }

  async observe(): Promise<unknown> {
    const bot = this.ready;
    const p = bot.entity.position;
    // Limited, local observation. Do not expose global server state.
    const nearbyBlocks: Array<{ name: string; x: number; y: number; z: number }> = [];
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++)
        for (let dy = -1; dy <= 2; dy++) {
          const position = p.floored().offset(dx, dy, dz);
          const block = bot.blockAt(position);
          if (block && block.name !== "air" && block.name !== "cave_air")
            nearbyBlocks.push({ name: block.name, x: position.x, y: position.y, z: position.z });
        }
    return {
      world: this.id,
      position: { x: p.x, y: p.y, z: p.z },
      health: bot.health,
      food: bot.food,
      timeOfDay: bot.time.timeOfDay,
      nearbyBlocks,
      nearbyEntities: Object.values(bot.entities)
        .filter(e => e.id !== bot.entity.id && e.position.distanceTo(p) < 12)
        .slice(0, 32)
        .map(e => ({ type: e.name ?? e.type, position: { x: e.position.x, y: e.position.y, z: e.position.z } })),
    };
  }

  async act(action: string, args: Record<string, unknown>): Promise<ActionResult> {
    const bot = this.ready;
    try {
      switch (action) {
        case "inventory":
          return { ok: true, message: "Inventory", data: bot.inventory.items().map(i => ({ name: i.name, count: i.count })) };
        case "move_to": {
          const p = xyz(args);
          // Limit each navigation request; exploration should proceed in bounded steps.
          if (bot.entity.position.distanceTo(p) > 24) throw new Error("Destination beyond 24-block action limit");
          await withTimeout(bot.pathfinder.goto(new GoalNear(p.x, p.y, p.z, 1)));
          return { ok: true, message: "Arrived near destination" };
        }
        case "mine": {
          const p = xyz(args);
          if (bot.entity.position.distanceTo(p) > 5) throw new Error("Block out of reach");
          const block = bot.blockAt(p);
          if (!block || !bot.canDigBlock(block)) throw new Error("Block is unavailable or cannot be dug");
          await withTimeout(bot.dig(block), 15000);
          return { ok: true, message: `Mined ${block.name}` };
        }
        case "place": {
          const p = xyz(args);
          if (bot.entity.position.distanceTo(p) > 5) throw new Error("Target out of reach");
          const itemName = String(args.item ?? "");
          const item = bot.inventory.items().find(i => i.name === itemName);
          if (!item) throw new Error("Requested item not in inventory");
          const target = bot.blockAt(p);
          if (!target || target.boundingBox !== "empty") throw new Error("Target is not empty");
          const neighbors = [new Vec3(0,-1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,1,0)];
          const face = neighbors.find(offset => {
            const support = bot.blockAt(p.plus(offset));
            return support && support.boundingBox === "block";
          });
          if (!face) throw new Error("No adjacent solid support block");
          await bot.equip(item, "hand");
          await withTimeout(bot.placeBlock(bot.blockAt(p.plus(face))!, face.scaled(-1)), 15000);
          return { ok: true, message: `Placed ${itemName}` };
        }
        case "say": {
          const message = String(args.message ?? "").slice(0, 200);
          if (!message) throw new Error("Message must be nonempty");
          bot.chat(message);
          return { ok: true, message: "Sent chat message" };
        }
        default: throw new Error(`Unsupported Minecraft action: ${action}`);
      }
    } catch (e) {
      // Failure is data so agents can adapt without losing the tool session.
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async close(): Promise<void> {
    this.bot?.pathfinder.setGoal(null);
    this.bot?.end();
    this.bot = undefined;
  }
}
