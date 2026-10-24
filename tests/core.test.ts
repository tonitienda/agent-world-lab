import assert from "node:assert/strict";
import test from "node:test";
import { requireCapability, type WorldAdapter } from "../src/core/types.js";
import { createWorld } from "../src/environments/index.js";

test("minecraft adapter is discoverable without a running server", () => {
  const world = createWorld("minecraft");
  assert.equal(world.id, "minecraft");
  assert.ok(world.capabilities.includes("observe"));
});
test("unsupported environments fail explicitly", () => {
  assert.throws(() => createWorld("unknown-world"), /Unknown world adapter/);
});
test("capabilities are adapter-scoped", () => {
  const world = { id: "mock", capabilities: ["observe"] } as unknown as WorldAdapter;
  assert.doesNotThrow(() => requireCapability(world, "observe"));
  assert.throws(() => requireCapability(world, "mine"), /does not support/);
});
