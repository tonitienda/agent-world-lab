import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {OpenTTDRuntime} from '../packages/openttd/src/runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const spec = JSON.parse(await readFile(join(root, 'episodes/episode-009/scenario.json'), 'utf8'));
const argument = process.argv.indexOf('--out');
const folder = resolve(argument >= 0 ? process.argv[argument + 1]! : join(root, 'data/openttd-preparations',
  `forest-to-market-${new Date().toISOString().replaceAll(':', '-')}`));
await mkdir(join(root, 'data/openttd-preparations'), {recursive: true});
await mkdir(folder, {recursive: false});
await writeFile(join(folder, 'scenario.json'), JSON.stringify(spec, null, 2));
const world = new OpenTTDRuntime(root, folder, {mapSize: spec.environment.mapSize, seed: spec.environment.seed,
  initialCash: spec.initialCash, river: true, title: spec.displayTitle, goalFile: 'episodes/episode-009/goal.md'});
try {
  await world.start();
  const setup = await world.request('setup_supply_chain');
  assert.equal(setup.ok, true, JSON.stringify(setup.data));
  const fixture = setup.data;
  assert.equal(fixture.industry_count, 2, 'Exactly the intended forest and sawmill are required');
  assert.ok(fixture.goods_acceptance_sites > 0, 'The town needs reachable vacant goods-accepting sites');
  assert.equal(fixture.initial_goods_production, 0, 'Finished goods must not exist before wood is supplied');
  assert.equal(fixture.prebuilt_crossing_heads, 0, 'A generated town must not accidentally provide the river crossing');
  assert.ok(fixture.forest_produces_wood && fixture.sawmill_accepts_wood && fixture.sawmill_produces_goods,
    'Verify actual cargo compatibility, not just industry names');
  const wood = await world.request('cargo_engines', {cargo: fixture.wood_cargo});
  const goods = await world.request('cargo_engines', {cargo: fixture.goods_cargo});
  const bridges = await world.request('bridge_options', {length: fixture.river_max - fixture.river_min + 5});
  assert.ok(wood.ok && wood.data.length > 0, 'Buyable wood trucks required');
  assert.ok(goods.ok && goods.data.length > 0, 'Buyable goods trucks required');
  assert.ok(bridges.ok && bridges.data.length > 0, 'A buildable bridge type must span the river');
  const state = await world.observe();
  assert.equal(state.balance, spec.initialCash, 'Scenario construction must not consume the player budget');
  assert.equal(state.loan, spec.initialLoan);
  assert.equal(state.vehicles.length, 0);
  const coordinate = fixture.river_axis;
  assert.ok(fixture.forest.position[coordinate] < fixture.river_min);
  assert.ok(fixture.sawmill.position[coordinate] > fixture.river_max);
  assert.ok(fixture.destination.position[coordinate] > fixture.river_max);
  await world.capture('overview', spec.displayTitle);
  await world.save('freight-initial');
  const result = {status: 'environment-verified', readyForClaude: false, fixture, startingCompany: {cash: state.balance, loan: state.loan, vehicles: 0},
    availableWoodTrucks: wood.data, availableGoodsTrucks: goods.data, crossingOptions: bridges.data,
    savedWorld: join(folder, 'freight-initial.sav'), screenshot: join(folder, 'world/screenshot/source-00001.png'),
    calibration: 'Delivery targets are provisional until a freight baseline verifies the full chain and capital budget. No Claude take or narration was run.',
    remainingPlayerIntegration: ['cargo station placement and surveys', 'freight truck build/refit and cargo orders',
      'road bridge building', 'per-industry and per-destination cargo accounting', 'six-vehicle freight observations',
      'budgeted freight session and measured bottleneck checks']};
  await writeFile(join(folder, 'preparation.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(join(folder, 'preparation-error.json'), JSON.stringify({error: String(error)}, null, 2));
  throw error;
} finally { await world.close(); }
