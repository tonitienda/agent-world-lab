import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OpenTTDRuntime} from '../packages/openttd/src/runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = resolve(process.argv[2] ?? join(root, 'data/openttd-previews', new Date().toISOString().replaceAll(':', '-')));
await mkdir(folder, {recursive: false});
const world = new OpenTTDRuntime(root, folder, {mapSize: 128, seed: 11, initialCash: 40000, river: true,
  title: 'Forest to Market', goalFile: 'episodes/episode-009/goal.md'});
const call = async (op: string, args: Record<string, unknown> = {}) => {
  const reply = await world.request(op, args);
  assert.ok(reply.ok, `${op} ${JSON.stringify(args)}: ${JSON.stringify(reply.data)}`);
  return reply;
};
const road = (x: number, y: number, end_x: number, end_y: number) => call('build_road', {x, y, end_x, end_y});
const stop = (x: number, y: number, front_x: number, front_y: number) => call('build_freight_stop', {x, y, front_x, front_y});
try {
  await world.start();
  const fixture = (await call('setup_supply_chain')).data;
  const spec = JSON.parse(await readFile(join(root, 'episodes/episode-009/scenario.json'), 'utf8'));
  const start = (await call('freight_status')).data;
  const staged = process.argv.includes('--staged');
  const bridges = (await call('bridge_options', {length: 8})).data;
  await call('build_bridge', {x: 60, y: 62, end_x: 67, end_y: 62, bridge: bridges[0].id});
  await road(42, 62, 59, 62);
  await road(68, 62, 81, 62);
  await road(81, 62, 81, 61);
  await road(81, 61, 95, 61);
  await road(95, 61, 95, 85);
  await road(95, 85, 101, 85);
  await road(101, 85, 101, 86);
  const townSites = (await call('freight_sites', {x: 102, y: 92, cargo: fixture.goods_cargo})).items;
  assert.ok(townSites.some((site: any) => site.x === 100 && site.y === 86 && site.accepts >= 8),
    'Eastmere stop must accept goods at the actual truck-stop coverage radius');
  await stop(42, 63, 42, 62);
  await stop(82, 62, 81, 62);
  await stop(84, 62, 84, 61);
  await stop(100, 86, 101, 86);
  await call('build_depot', {x: 45, y: 61, front_x: 45, front_y: 62});
  await road(42, 63, 42, 62);
  await road(82, 62, 81, 62);
  await road(84, 62, 84, 61);
  await road(45, 61, 45, 62);
  const wood = (await call('cargo_engines', {cargo: fixture.wood_cargo})).data[0];
  const goods = (await call('cargo_engines', {cargo: fixture.goods_cargo})).data[0];
  const buy = async (engine: number, from: [number, number], to: [number, number]) => {
    const {vehicle} = (await call('build_vehicle', {x: 45, y: 61, engine})).data;
    await call('append_order', {vehicle, x: from[0], y: from[1], full_load: staged});
    await call('append_order', {vehicle, x: to[0], y: to[1]});
    await call('start_vehicle', {vehicle});
  };
  const woodOnly = process.argv.includes('--wood-only');
  const buildOnly = process.argv.includes('--build-only');
  await buy(wood.id, [42, 63], [82, 62]);
  await buy(wood.id, [42, 63], [82, 62]);
  if (!woodOnly && !staged) {
    await buy(goods.id, [84, 62], [100, 86]);
    await buy(goods.id, [84, 62], [100, 86]);
  }
  const samples = [];
  const target = spec.proposedGoal;
  let status = (await call('freight_status')).data;
  let goodsStarted = false;
  while (true) {
    const day = status.date - start.date;
    if (staged && !woodOnly && !goodsStarted && status.wood > 0) {
      await buy(goods.id, [84, 62], [100, 86]);
      goodsStarted = true;
      status = (await call('freight_status')).data;
    }
    assert.equal(status.goods, status.mill_goods_delivered, 'The only goods flow must be from the mill to Eastmere');
    assert.equal(status.loan, spec.maximumLoan);
    assert.ok(status.trucks.length <= spec.maximumTrucks);
    const stations = (await call('freight_stations')).items;
    samples.push({...status, day, stations});
    const passed = status.wood >= target.woodDeliveredToSawmill && status.goods >= target.goodsFromSawmillDeliveredToTown &&
      status.balance >= target.minimumEndingCash && status.fleet_profit > 0;
    console.log(JSON.stringify({day, ...status, passed}));
    await world.save(`day-${String(day).padStart(3, '0')}`);
    await writeFile(join(folder, 'calibration.json'), JSON.stringify({woodOnly, staged, buildOnly, target, passed, samples}, null, 2));
    if (buildOnly || passed || day >= target.maximumDays) break;
    await call('advance', {days: Math.min(12, target.maximumDays - day)});
    status = (await call('freight_status')).data;
  }
} finally {
  await world.close();
}
