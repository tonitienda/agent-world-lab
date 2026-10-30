import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { withDeadline, waitForSpawn, closeScenarioBot } from "../src/environments/minecraft/scenario-lifecycle.js";

test("spawn errors, disconnects and deadlines fail promptly and remove pending listeners", async () => {
  for (const event of ["spawn", "error", "end", "timeout"]) {
    const bot = new EventEmitter();
    const waiting = waitForSpawn(bot as unknown as Parameters<typeof waitForSpawn>[0], 10);
    if (event === "error") bot.emit(event, Error("fixture connection refused"));
    else if (event !== "timeout") bot.emit(event);
    if (event === "spawn") await waiting;
    else await assert.rejects(waiting, event === "error" ? /connection refused/ : event === "end" ? /Disconnected before spawn/ : /Spawn timeout/);
    assert.equal(bot.listenerCount("spawn"), 0);
    assert.equal(bot.listenerCount("error"), 0);
    assert.equal(bot.listenerCount("end"), 0);
  }
});

test("stalled chunk loads have a deadline while successful waits retain results", async () => {
  assert.equal(await withDeadline(Promise.resolve("loaded"), 1000, "timeout"), "loaded");
  await assert.rejects(withDeadline(new Promise(() => {}), 10, "Chunk loading timeout"), /Chunk loading timeout/);
});

test("scenario disconnect gracefully quits or forces a stalled/failed quit closed", async () => {
  for (const mode of ["graceful", "stalled", "throwing"]) {
    class FixtureBot extends EventEmitter {
      forced = 0;
      quit() { if (mode === "graceful") this.emit("end"); else if (mode === "throwing") throw Error("quit failed"); }
      end() { this.forced++; this.emit("end"); }
    }
    const bot = new FixtureBot();
    await closeScenarioBot(bot as unknown as Parameters<typeof closeScenarioBot>[0], 10);
    assert.equal(bot.forced, mode === "graceful" ? 0 : 1);
    assert.equal(bot.listenerCount("end"), 0);
  }
});
