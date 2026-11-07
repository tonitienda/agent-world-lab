import assert from "node:assert/strict";
import test from "node:test";
import { Vec3 } from "vec3";
import { MinecraftAdapter } from "../src/environments/minecraft/adapter.js";

type Hearing = { hear(self: string, from: string, message: string): void };
function teammate() {
  const adapter = new MinecraftAdapter();
  // A narrow test double: listen needs a spawned bot, never a real world.
  Object.assign(adapter, { bot: { entity: { position: new Vec3(0, 0, 0) } } });
  return { adapter, hear: (adapter as unknown as Hearing).hear.bind(adapter) };
}

test("listen returns teammate chat already heard, and ignores the agent's own echo", async () => {
  const { adapter, hear } = teammate();
  hear("ada", "ada", "my own echo");
  hear("ada", "bram", "I'm on the plate at 20 96 4");
  const result = await adapter.act("listen", { timeout_seconds: 1 });
  assert.ok(result.ok);
  assert.deepEqual((result.data as { messages: { from: string; message: string }[] }).messages.map(m => [m.from, m.message]), [["bram", "I'm on the plate at 20 96 4"]]);
});

test("listen wakes as soon as a message arrives instead of waiting out the timeout", async () => {
  const { adapter, hear } = teammate();
  const started = Date.now();
  setTimeout(() => hear("bram", "ada", "go now"), 50);
  const result = await adapter.act("listen", { timeout_seconds: 10 });
  assert.ok(Date.now() - started < 2000);
  assert.equal((result.data as { messages: unknown[] }).messages.length, 1);
});

test("listen times out quietly and rejects unbounded waits", async () => {
  const { adapter } = teammate();
  const quiet = await adapter.act("listen", { timeout_seconds: 1 });
  assert.ok(quiet.ok);
  assert.deepEqual((quiet.data as { messages: unknown[] }).messages, []);
  const unbounded = await adapter.act("listen", { timeout_seconds: 600 });
  assert.equal(unbounded.ok, false);
});

test("heard chat is bounded", async () => {
  const { adapter, hear } = teammate();
  for (let i = 0; i < 50; i++) hear("ada", "bram", `msg ${i}`);
  const result = await adapter.act("listen", { timeout_seconds: 1 });
  const messages = (result.data as { messages: { message: string }[] }).messages;
  assert.equal(messages.length, 20);
  assert.equal(messages.at(-1)!.message, "msg 49");
});
