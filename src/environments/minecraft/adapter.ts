import mineflayer, { type Bot, type EquipmentDestination } from "mineflayer";
import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pathfinderModule from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import type { Item } from "prismarine-item";
import { readRavineManifest, verifyBotRavine } from "./ravine.js";
import { readWorldConfig } from "./world-config.js";
import { acquireLock } from "../../session/lock.js";
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
    task.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export const minecraftCapabilities = [
  "observe",
  "inventory",
  "equipment",
  "recipes",
  "craft",
  "equip",
  "drop",
  "interact_block",
  "interact_entity",
  "open_container",
  "container",
  "transfer_item",
  "close_container",
  "eat",
  "attack",
  "use_item",
  "move_to",
  "mine",
  "place",
  "say",
] as const;
const slots: EquipmentDestination[] = [
  "hand",
  "head",
  "torso",
  "legs",
  "feet",
  "off-hand",
];
function itemData(i: Item | null) {
  return i
    ? {
        name: i.name,
        count: i.count,
        slot: i.slot,
        type: i.type,
        metadata: i.metadata,
        displayName: i.displayName,
        durabilityUsed: i.durabilityUsed,
        enchants: i.enchants,
      }
    : null;
}
function countAt(value: unknown) {
  const count = value === undefined ? 1 : value;
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 2304
  )
    throw Error("count must be an integer between 1 and 2304");
  return count;
}
const require = createRequire(import.meta.url);

/** Experimental local recorder: fixed trailing/bird-eye camera provided by prismarine-viewer.
 * When disabled there is no rendering overhead or extra native rendering dependency.
 * Recording may need additional headless graphics libraries depending on host OS.
 */
async function enableCapture(
  bot: Bot,
): Promise<(() => Promise<void>) | undefined> {
  const file = process.env.RECORD_MP4;
  if (!file) return;
  const output = resolve(file);
  if (
    [
      "metadata.json",
      "agent-pov.mp4",
      "observer.mp4",
      "follow.mp4",
      "agent-pov.webm",
      "observer.webm",
      "follow.webm",
    ].some((file) => existsSync(resolve(dirname(output), file)))
  )
    throw Error(
      "Recording artifacts already exist; choose a new output folder",
    );
  mkdirSync(dirname(output), { recursive: true });
  const width = Number(process.env.RECORD_WIDTH ?? "1280");
  const height = Number(process.env.RECORD_HEIGHT ?? "720");
  if (![width, height].every((n) => Number.isInteger(n) && n > 0))
    throw new Error("Invalid recording dimensions");
  const recorder =
    require("../../../packages/minecraft-recorder/index.cjs") as {
      start(
        bot: Bot,
        options: { output: string; width: number; height: number },
      ): Promise<() => Promise<void>>;
    };
  return await recorder.start(bot, { output, width, height });
}

export class MinecraftAdapter implements WorldAdapter {
  readonly id = "minecraft";
  readonly capabilities = minecraftCapabilities;
  private releaseLock?: () => void;
  private closing?: Promise<void>;
  private busy = false;
  private timedOut = false;
  private observedEntities = new Set<number>();
  private container?: {
    window:
      | Awaited<ReturnType<Bot["openContainer"]>>
      | Awaited<ReturnType<Bot["openFurnace"]>>;
    position: Vec3;
    furnace: boolean;
  };
  private bot?: Bot;
  private stopCapture?: () => Promise<void>;

  constructor(private readonly options: { lockPath?: string } = {}) {}

  async connect(): Promise<void> {
    if (this.bot) return;
    this.releaseLock = acquireLock(
      "Minecraft session / recording",
      this.options.lockPath,
    );
    this.closing = undefined;
    try {
      const bot = mineflayer.createBot({
        host: process.env.MC_HOST ?? "127.0.0.1",
        port: Number(process.env.MC_PORT ?? "25565"),
        username: process.env.AGENT_ID ?? "explorer-1",
        auth: "offline",
        // Allow negotiation rather than assuming the configured server protocol.
      });
      this.bot = bot;
      this.timedOut = false;
      bot.loadPlugin(pathfinder);
      bot.on("error", (error) => {
        process.stderr.write(`Minecraft connection error: ${String(error)}\n`);
      });
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          bot.once("spawn", () => resolve());
          bot.once("error", reject);
          bot.once("end", () => reject(new Error("Disconnected before spawn")));
        }),
        60000,
      );
      // Spawn can fire before terrain packets finish arriving. Both navigation
      // and the viewer require loaded chunks around the player.
      await withTimeout(bot.waitForChunksToLoad(), 30000);
      const movements = new Movements(bot);
      // Navigation must not silently dig resources or spend the agent's building blocks.
      movements.canDig = false;
      movements.allow1by1towers = false;
      movements.allowFreeMotion = false;
      movements.scafoldingBlocks = [];
      bot.pathfinder.setMovements(movements);
      if (process.env.SCENARIO_FILE) {
        readRavineManifest(resolve(process.env.SCENARIO_FILE), readWorldConfig(resolve(import.meta.dirname, "../../../data/minecraft/world-config.json")) as {seed?: string; verifiedAt?: string}, bot.username);
        verifyBotRavine(bot);
      }
      this.stopCapture = await enableCapture(bot);
    } catch (e) {
      this.bot?.end();
      this.bot = undefined;
      this.releaseLock?.();
      this.releaseLock = undefined;
      throw e;
    }
  }

  private get ready(): Bot {
    if (!this.bot?.entity) throw new Error("Agent not connected / spawned");
    return this.bot;
  }

  private equipment() {
    const bot = this.ready;
    return Object.fromEntries(
      slots.map((slot) => {
        const index = bot.getEquipmentDestSlot(slot);
        const window = bot.currentWindow;
        const carried =
          window &&
          index >= bot.inventory.inventoryStart &&
          index < bot.inventory.inventoryEnd;
        const item = carried
          ? window.slots[
              index + window.inventoryStart - bot.inventory.inventoryStart
            ]
          : bot.inventory.slots[index];
        return [slot, itemData(item)];
      }),
    );
  }

  private blockAt(position: Vec3) {
    const bot = this.ready;
    if (bot.entity.position.distanceTo(position) > 5)
      throw Error("Block out of reach (5 blocks)");
    const block = bot.blockAt(position);
    if (
      !block ||
      (block.boundingBox === "empty" &&
        /^(air|cave_air|void_air)$/.test(block.name))
    )
      throw Error("Block unavailable");
    if (!bot.canSeeBlock(block)) throw Error("Block is not visible");
    return block;
  }

  private carriedItems() {
    const window = this.ready.currentWindow;
    return window
      ? window.slots
          .slice(window.inventoryStart, window.inventoryEnd)
          .filter((i): i is Item => i !== null)
      : this.ready.inventory.items();
  }

  private async synchronizeWindow() {
    const bot = this.ready;
    await bot.waitForTicks(2);
    const sync = (
      bot as Bot & { _syncWindow?: (window: Bot["inventory"]) => Promise<void> }
    )._syncWindow;
    if (sync) await sync(bot.currentWindow ?? bot.inventory);
  }

  private inventoryItem(name: unknown) {
    if (typeof name !== "string") throw Error("Expected item name");
    const item = this.carriedItems().find((i) => i.name === name);
    if (!item) throw Error(`Requested item not in inventory: ${name}`);
    return item;
  }

  private containerState() {
    const c = this.container;
    if (!c || this.ready.currentWindow !== c.window)
      throw Error("No open container");
    this.blockAt(c.position);
    if (c.furnace) {
      const f = c.window as Awaited<ReturnType<Bot["openFurnace"]>>;
      return {
        kind: "furnace",
        input: itemData(f.inputItem()),
        fuelItem: itemData(f.fuelItem()),
        output: itemData(f.outputItem()),
        fuel: f.fuel,
        progress: f.progress,
        note: "Progress/fuel may be unknown until server updates. Check input recipe, fuel and output space if stalled.",
      };
    }
    return {
      kind: "container",
      items: c.window.slots
        .slice(0, c.window.inventoryStart)
        .filter((i) => i)
        .map(itemData),
    };
  }

  async observe(): Promise<unknown> {
    const bot = this.ready;
    const p = bot.entity.position;
    // Limited, local observation. Do not expose global server state.
    const nearbyBlocks: Array<{
      name: string;
      x: number;
      y: number;
      z: number;
    }> = [];
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++)
        for (let dy = -1; dy <= 2; dy++) {
          const position = p.floored().offset(dx, dy, dz);
          const block = bot.blockAt(position);
          if (block && block.name !== "air" && block.name !== "cave_air")
            nearbyBlocks.push({
              name: block.name,
              x: position.x,
              y: position.y,
              z: position.z,
            });
        }
    const entities = Object.values(bot.entities)
      .filter((e) => e.id !== bot.entity.id && e.position.distanceTo(p) < 12)
      .filter((e) => {
        const eye = p.offset(0, bot.entity.height, 0);
        const delta = e.position.offset(0, (e.height || 1) / 2, 0).minus(eye);
        return !bot.world.raycast(eye, delta.normalize(), delta.norm());
      })
      .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))
      .slice(0, 32);
    this.observedEntities = new Set(entities.map((e) => e.id));
    return {
      world: this.id,
      position: { x: p.x, y: p.y, z: p.z },
      health: bot.health,
      food: bot.food,
      timeOfDay: bot.time.timeOfDay,
      equipment: this.equipment(),
      weather: { raining: bot.isRaining, thunder: bot.thunderState },
      environment: {
        version: bot.version,
        dimension: bot.game.dimension,
        difficulty: bot.game.difficulty,
        gameMode: bot.game.gameMode,
      },
      nearbyBlocks: nearbyBlocks
        .filter((b) => bot.canSeeBlock(bot.blockAt(new Vec3(b.x, b.y, b.z))!))
        .slice(0, 128),
      nearbyEntities: entities.map((e) => ({
        id: e.id,
        type: e.name ?? e.type,
        position: { x: e.position.x, y: e.position.y, z: e.position.z },
      })),
    };
  }

  async act(
    action: string,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    if (this.busy || this.timedOut)
      return {
        ok: false,
        message:
          "Adapter busy or previous action timed out; finalize if recovery is needed",
      };
    this.busy = true;
    try {
      return await withTimeout(this.perform(action, args), 35000);
    } catch (e) {
      if (String(e).includes("timed out")) {
        this.timedOut = action !== "move_to";
        this.bot?.clearControlStates();
        this.bot?.pathfinder.setGoal(null);
        this.bot?.stopDigging();
        this.bot?.deactivateItem();
      }
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    } finally {
      this.busy = false;
    }
  }

  private async perform(
    action: string,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const bot = this.ready;
    if (
      bot.currentWindow &&
      ![
        "inventory",
        "equipment",
        "recipes",
        "container",
        "transfer_item",
        "close_container",
        "say",
      ].includes(action)
    )
      throw Error("Close the current window before this action");
    switch (action) {
      case "inventory":
        return {
          ok: true,
          message: "Inventory",
          data: this.carriedItems().map(itemData),
        };
      case "equipment":
        return { ok: true, message: "Equipment", data: this.equipment() };
      case "recipes": {
        const types =
          args.item === undefined
            ? Object.values(bot.registry.itemsByName)
            : [bot.registry.itemsByName[String(args.item)]];
        if (types.some((t) => !t)) throw Error("Unknown item");
        const recipes = types.flatMap((t) =>
          bot.recipesAll(t.id, null, true).map((r) => ({
            item: t.name,
            count: r.result.count,
            requiresTable: r.requiresTable,
            ingredients: r.delta
              .filter((d) => d.count < 0)
              .map((d) => ({
                name: bot.registry.items[d.id]?.name,
                count: -d.count,
              })),
            craftableWithTable: bot
              .recipesFor(t.id, null, 1, true)
              .some(
                (available) => JSON.stringify(available) === JSON.stringify(r),
              ),
          })),
        );
        // Recipe objects are reconstructed by Mineflayer: compare structural recipe data.
        return {
          ok: true,
          message:
            "Recipes (bounded to 128; specify item for full alternatives)",
          data: recipes.slice(0, 128),
        };
      }
      case "craft": {
        if (this.container) throw Error("Close the container before crafting");
        const type = bot.registry.itemsByName[String(args.item)];
        if (!type) throw Error("Unknown item");
        const count = countAt(args.count);
        const table =
          args.crafting_table_position === undefined
            ? null
            : this.blockAt(
                xyz(args.crafting_table_position as Record<string, unknown>),
              );
        if (table && table.name !== "crafting_table")
          throw Error("Expected crafting table at position");
        const recipe = bot
          .recipesFor(type.id, null, count, table)
          .find((r) => count % r.result.count === 0);
        if (!recipe)
          throw Error(
            "Missing ingredients, crafting table, or count is not an exact recipe output multiple; inspect recipes",
          );
        // Reconcile each batch with server inventory. Modern protocol clicks can
        // otherwise race the authoritative crafting update across repeated batches.
        const sync = (
          bot as Bot & {
            _syncWindow?: (window: Bot["inventory"]) => Promise<void>;
          }
        )._syncWindow;
        const before = bot.inventory.count(type.id, null);
        for (let i = 0; i < count / recipe.result.count; i++) {
          await bot.craft(recipe, 1, table ?? undefined);
          await bot.waitForTicks(2);
          if (sync) await sync(bot.inventory);
          const actual = bot.inventory.count(type.id, null) - before;
          if (actual !== (i + 1) * recipe.result.count)
            throw Error(
              `Craft output not confirmed by server (received ${actual}/${count}); inspect inventory before retrying`,
            );
        }
        return { ok: true, message: `Crafted ${count} ${type.name}` };
      }
      case "equip": {
        if (!slots.includes(args.slot as EquipmentDestination))
          throw Error("Unsupported equipment slot");
        await bot.equip(
          this.inventoryItem(args.item),
          args.slot as EquipmentDestination,
        );
        return { ok: true, message: "Equipped item", data: this.equipment() };
      }
      case "drop": {
        const item = this.inventoryItem(args.item),
          count = countAt(args.count);
        if (
          bot.inventory
            .items()
            .filter((i) => i.type === item.type && i.metadata === item.metadata)
            .reduce((n, i) => n + i.count, 0) < count
        )
          throw Error("Insufficient items");
        await bot.toss(item.type, item.metadata, count);
        return { ok: true, message: `Dropped ${count} ${item.name}` };
      }
      case "interact_block": {
        const block = this.blockAt(xyz(args));
        if (
          /chest|barrel|shulker_box|furnace|smoker|hopper|dispenser|dropper/.test(
            block.name,
          )
        )
          throw Error("Use open_container for container blocks");
        if (block.name === "crafting_table")
          return {
            ok: true,
            message: "Crafting table reachable; pass this position to craft",
          };
        if (!/door|trapdoor|gate|button|lever|bell/.test(block.name))
          throw Error("Unsupported interactive block");
        const before = block.getProperties();
        await bot.activateBlock(block);
        await bot.waitForTicks(2);
        const after = bot.blockAt(block.position)?.getProperties();
        const property =
          "open" in before
            ? "open"
            : "powered" in before
              ? "powered"
              : undefined;
        if (property && before[property] === after?.[property])
          throw Error(
            `Interaction did not change ${block.name}; iron mechanisms may require redstone power`,
          );
        return {
          ok: true,
          message: property
            ? `Activated ${block.name}`
            : `Interaction sent to ${block.name}; observe its effect`,
        };
      }
      case "open_container": {
        if (this.container) throw Error("Close the current container first");
        const block = this.blockAt(xyz(args));
        const furnace = ["furnace", "blast_furnace", "smoker"].includes(
          block.name,
        );
        if (
          !furnace &&
          !/^(chest|trapped_chest|ender_chest|barrel|hopper|dispenser|dropper|(?:\w+_)?shulker_box)$/.test(
            block.name,
          )
        )
          throw Error("Unsupported container block");
        const window = furnace
          ? await bot.openFurnace(block)
          : await bot.openContainer(block);
        this.container = { window, position: block.position.clone(), furnace };
        (window as import("node:events").EventEmitter).once("close", () => {
          this.container = undefined;
        });
        return {
          ok: true,
          message: "Opened container",
          data: this.containerState(),
        };
      }
      case "container":
        return {
          ok: true,
          message: "Container state",
          data: this.containerState(),
        };
      case "close_container": {
        if (bot.currentWindow) await bot.closeWindow(bot.currentWindow);
        this.container = undefined;
        return { ok: true, message: "Container closed" };
      }
      case "transfer_item": {
        this.containerState();
        const c = this.container!;
        const count = countAt(args.count);
        if (args.direction !== "deposit" && args.direction !== "withdraw")
          throw Error("direction must be deposit or withdraw");
        const type = bot.registry.itemsByName[String(args.item)];
        if (!type) throw Error("Unknown item");
        const storedCount = () =>
          c.window.slots
            .slice(c.window.inventoryStart, c.window.inventoryEnd)
            .filter((i) => i?.type === type.id)
            .reduce((n, i) => n + i!.count, 0);
        const before = storedCount();
        if (c.furnace) {
          const slot = { input: 0, fuel: 1, output: 2 }[String(args.slot)];
          if (slot === undefined)
            throw Error("Furnace slot must be input, fuel or output");
          if (args.direction === "deposit" && slot === 2)
            throw Error("Cannot deposit into furnace output");
          await bot.transfer({
            window: c.window,
            itemType: type.id,
            metadata: null,
            count,
            sourceStart:
              args.direction === "deposit" ? c.window.inventoryStart : slot,
            sourceEnd:
              args.direction === "deposit" ? c.window.inventoryEnd : slot + 1,
            destStart:
              args.direction === "deposit" ? slot : c.window.inventoryStart,
            destEnd:
              args.direction === "deposit" ? slot + 1 : c.window.inventoryEnd,
          });
        } else {
          if (args.slot !== undefined)
            throw Error("slot applies only to furnaces");
          await (c.window as Awaited<ReturnType<Bot["openContainer"]>>)[
            args.direction
          ](type.id, null, count);
        }
        await this.synchronizeWindow();
        const expected = args.direction === "deposit" ? -count : count;
        if (storedCount() - before !== expected)
          throw Error(
            "Transfer not confirmed by server; inspect container and inventory before retrying",
          );
        return {
          ok: true,
          message: "Transferred items",
          data: this.containerState(),
        };
      }
      case "eat": {
        const item =
          args.item === undefined
            ? bot.inventory
                .items()
                .find((i) => bot.registry.foodsByName[i.name])
            : this.inventoryItem(args.item);
        if (!item || !bot.registry.foodsByName[item.name])
          throw Error("No edible item available");
        await bot.equip(item, "hand");
        await bot.consume();
        return {
          ok: true,
          message: `Consumed ${item.name}`,
          data: { food: bot.food, health: bot.health },
        };
      }
      case "use_item": {
        if (args.item !== undefined)
          await bot.equip(this.inventoryItem(args.item), "hand");
        if (!bot.heldItem) throw Error("No held item");
        bot.activateItem();
        await new Promise((resolve) => setTimeout(resolve, 500));
        bot.deactivateItem();
        return {
          ok: true,
          message: "Used held item for 500ms; observe to check its effect",
        };
      }
      case "attack":
      case "interact_entity": {
        const id = intAt(args.entity_id, "entity_id");
        const entity = bot.entities[id];
        if (!this.observedEntities.has(id) || !entity)
          throw Error("Target must be discovered by observe");
        if (entity.position.distanceTo(bot.entity.position) > 3)
          throw Error("Entity out of reach (3 blocks)");
        const eye = bot.entity.position.offset(0, bot.entity.height, 0);
        const delta = entity.position
          .offset(0, (entity.height || 1) / 2, 0)
          .minus(eye);
        if (bot.world.raycast(eye, delta.normalize(), delta.norm()))
          throw Error("Entity is not visible");
        await bot.lookAt(
          entity.position.offset(0, (entity.height || 1) / 2, 0),
        );
        if (action === "attack") bot.attack(entity);
        else await bot.activateEntity(entity);
        return {
          ok: true,
          message:
            action === "attack"
              ? "Attack attempted; observe target to check damage"
              : "Entity interaction sent",
        };
      }
      case "move_to": {
        const p = xyz(args);
        // Limit each navigation request; exploration should proceed in bounded steps.
        if (bot.entity.position.distanceTo(p) > 24)
          throw new Error("Destination beyond 24-block action limit");
        const radius = args.radius === 0 ? 0 : 1;
        try {
          await withTimeout(
            bot.pathfinder.goto(new GoalNear(p.x, p.y, p.z, radius)),
          );
        } finally {
          bot.pathfinder.setGoal(null);
        }
        return { ok: true, message: "Arrived near destination" };
      }
      case "mine": {
        const p = xyz(args);
        if (bot.entity.position.distanceTo(p) > 5)
          throw new Error("Block out of reach");
        const block = bot.blockAt(p);
        if (!block || !bot.canDigBlock(block))
          throw new Error("Block is unavailable or cannot be dug");
        await withTimeout(bot.dig(block), 15000);
        return { ok: true, message: `Mined ${block.name}` };
      }
      case "place": {
        const p = xyz(args);
        if (bot.entity.position.distanceTo(p) > 5)
          throw new Error("Target out of reach");
        const itemName = String(args.item ?? "");
        const item = bot.inventory.items().find((i) => i.name === itemName);
        if (!item) throw new Error("Requested item not in inventory");
        const target = bot.blockAt(p);
        if (!target || target.boundingBox !== "empty")
          throw new Error("Target is not empty");
        const neighbors = [
          new Vec3(0, -1, 0),
          new Vec3(1, 0, 0),
          new Vec3(-1, 0, 0),
          new Vec3(0, 0, 1),
          new Vec3(0, 0, -1),
          new Vec3(0, 1, 0),
        ];
        const face = neighbors.find((offset) => {
          const support = bot.blockAt(p.plus(offset));
          return support && support.boundingBox === "block";
        });
        if (!face) throw new Error("No adjacent solid support block");
        await bot.equip(item, "hand");
        await withTimeout(
          bot.placeBlock(bot.blockAt(p.plus(face))!, face.scaled(-1)),
          15000,
        );
        return { ok: true, message: `Placed ${itemName}` };
      }
      case "say": {
        const message = String(args.message ?? "").slice(0, 200);
        if (!message) throw new Error("Message must be nonempty");
        bot.chat(message);
        return { ok: true, message: "Sent chat message" };
      }
      default:
        throw new Error(`Unsupported Minecraft action: ${action}`);
    }
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      try {
        this.container?.window.close();
        this.container = undefined;
        if (this.stopCapture) await this.stopCapture();
      } finally {
        this.stopCapture = undefined;
        this.bot?.pathfinder.setGoal(null);
        this.bot?.end();
        this.bot = undefined;
        this.releaseLock?.();
        this.releaseLock = undefined;
      }
    })();
    return this.closing;
  }
}
