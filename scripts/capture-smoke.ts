import assert from "node:assert/strict";
import { mkdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createWorld } from "../src/environments/index.js";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const folder = join(process.env.CAPTURE_OUTPUT_DIR ?? join("data", "captures"), timestamp);
mkdirSync(folder, { recursive: true });
const output = join(folder, "agent-pov.mp4");
process.env.RECORD_MP4 = output;
process.env.RECORD_FRAMES = process.env.RECORD_FRAMES ?? "240";
process.env.RECORD_WIDTH = process.env.RECORD_WIDTH ?? "854";
process.env.RECORD_HEIGHT = process.env.RECORD_HEIGHT ?? "480";

const world = createWorld("minecraft");
const events: Array<{ at: string; action: string; details: unknown }> = [];
function event(action: string, details: unknown) {
  events.push({ at: new Date().toISOString(), action, details });
}
try {
  event("started", { output, environment: world.id });
  await world.connect();
  const observation = await world.observe() as { position: { x: number; y: number; z: number } };
  event("spawn", observation);
  const start = observation.position;
  if (process.env.GENERATOR_SETTINGS) {
    assert.ok(start.y > 0, `Expected positive-Y capture test terrain, spawned at Y=${start.y}; verify generator-settings forwarding`);
  }
  const target = { x: Math.floor(start.x) + 3, y: Math.floor(start.y), z: Math.floor(start.z) };
  const moved = await world.act("move_to", target);
  event("move_to", { target, result: moved });
  assert.equal(moved.ok, true, moved.message);
  await delay(10000); // Capture a short clip after movement.
  event("finished", await world.observe());
} catch (error) {
  event("error", String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  await world.close();
  writeFileSync(join(folder, "events.json"), JSON.stringify(events, null, 2) + "\n");
  for (const name of ["agent-pov", "observer"]) {
    const file = join(folder, `${name}.mp4`);
    if (!existsSync(file) || statSync(file).size === 0) {
      console.error("Missing or empty camera recording:", file);
      process.exitCode = 1;
    } else console.log("Video artifact:", file, statSync(file).size, "bytes");
  }
  console.log("Session folder:", folder);
  // The embedded Prismarine Viewer HTTP/WebSocket server retains event-loop
  // handles after recording finishes. This script is a one-shot CI smoke test,
  // so terminate it explicitly only after capture, events, and errors are saved.
  process.exit(process.exitCode ?? 0);
}
