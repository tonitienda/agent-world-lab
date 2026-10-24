import { createWorld } from "../src/environments/index.js";

const world = createWorld();
try {
  await world.connect();
  const observation = await world.observe();
  console.log(JSON.stringify({ adapter: world.id, capabilities: world.capabilities, observation }, null, 2));
} catch (error) {
  console.error("Smoke test failed:", error);
  process.exitCode = 1;
} finally {
  await world.close();
}
