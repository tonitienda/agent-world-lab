import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const { createFinalizer } = createRequire(import.meta.url)(
  "../packages/minecraft-recorder/finalize.cjs",
) as {
  createFinalizer(
    tasks: (() => Promise<void>)[],
    cleanup: () => Promise<void>,
  ): () => Promise<void>;
};
test("camera failure still saves the other camera and cleans up exactly once", async () => {
  const calls: string[] = [];
  const finish = createFinalizer(
    [
      async () => {
        calls.push("pov");
        throw Error("encoder failed");
      },
      async () => {
        calls.push("observer");
      },
      async () => {
        calls.push("follow");
      },
    ],
    async () => {
      calls.push("close");
    },
  );
  const first = finish();
  assert.equal(finish(), first);
  await assert.rejects(first, /intermediates/);
  await assert.rejects(finish(), /intermediates/);
  assert.deepEqual(calls, ["pov", "observer", "follow", "close"]);
});
