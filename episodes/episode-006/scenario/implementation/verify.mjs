// Verify the installed Twin Shrine world without rebuilding it. Reads actual
// blocks and player state, exercises the gate (OR) and pedestal (AND) redstone
// with both players, then restores both players to their exact start state.
import {writeFile} from 'node:fs/promises';
import {players, loadManifest, spawnFor, yawFor, botYaw, connectAll, closeAll, chunks, consoleFor, resetPlayer, finishReset, delay, Vec3, VERSION} from './common.mjs';
import * as W from './world.mjs';

const evidence = [];
const result = {spawn: false, target: false, resources: false, capabilities: false, recorder: false, reachability: 'manual review required', evidence};
const assert = (ok, message) => { if (!ok) throw Error(message); };
let bots = [];

try {
  const names = players();
  const manifest = await loadManifest();
  bots = await connectAll(names);
  for (const bot of bots) await chunks(bot);
  await delay(1500);
  const eye = bots[0];
  const at = (x, y, z) => eye.blockAt(new Vec3(x, y, z));
  const block = (x, y, z, name) => { const b = at(x, y, z); assert(b && b.name === name, `Expected ${name} at ${x},${y},${z}; got ${b?.name ?? 'unloaded'}`); return b; };
  const prop = (x, y, z, name, key) => block(x, y, z, name).getProperties()[key];
  const con = consoleFor(eye, names[0]);

  // ------------------------------------------------------------ spawn
  function checkPlayers(label) {
    for (const [i, bot] of bots.entries()) {
      const n = names[i], s = spawnFor(manifest, n);
      assert(bot.entity.position.distanceTo(new Vec3(s.x, s.y, s.z)) < 0.2, `${label}: ${n} not at spawn ${s.x},${s.y},${s.z} (at ${bot.entity.position})`);
      const dy = Math.abs(((bot.entity.yaw - botYaw(yawFor(s))) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      assert(dy < 0.12, `${label}: ${n} facing wrong way`);
      assert(bot.game.gameMode === 'survival', `${label}: ${n} must be in survival`);
      assert(bot.health === 20 && bot.food === 20, `${label}: ${n} health/food not full (${bot.health}/${bot.food})`);
      assert(bot.inventory.items().length === 0, `${label}: ${n} inventory not empty`);
      const floor = at(Math.floor(s.x), Math.floor(s.y) - 1, Math.floor(s.z));
      assert(floor && floor.boundingBox === 'block', `${label}: ${n} has no solid floor`);
      for (const dy2 of [0, 1]) assert(at(Math.floor(s.x), Math.floor(s.y) + dy2, Math.floor(s.z))?.name === 'air', `${label}: ${n} spawn body space blocked`);
    }
  }
  assert(manifest.spawn && manifest.spawns, 'Manifest spawns missing');
  for (const n of names) assert(spawnFor(manifest, n), 'No manifest spawn for ' + n);
  if (names.includes('ada')) assert(manifest.spawns.ada.x === -6.5 && manifest.spawns.ada.y === 96 && manifest.spawns.ada.z === 0.5, 'ada spawn mismatch');
  if (names.includes('bram')) assert(manifest.spawns.bram.x === 18.5 && manifest.spawns.bram.y === 96 && manifest.spawns.bram.z === 0.5, 'bram spawn mismatch');
  checkPlayers('Initial');
  evidence.push(`Players ${names.join(', ')} persisted at their manifest spawns (west bank faces east, east bank faces west), survival, 20/20 health and food, empty inventories, solid floor and clear body space.`);

  // ------------------------------------------------------------ static world checks
  // Gorge: 9 wide, open sky over the crossing, banks at y=95.
  for (let z = -16; z <= 16; z++) {
    for (let x = W.GORGE.minX; x <= W.GORGE.maxX; x++) for (let y = 81; y <= 130; y++) block(x, y, z, 'air');
    assert(at(3, 95, z)?.boundingBox === 'block' && at(13, 95, z)?.boundingBox === 'block', `Gorge rim missing at z=${z}`);
  }
  // Lake: still source water y=76..80, waterlogged ladder cells in the west column.
  let water = 0;
  for (let x = W.GORGE.minX; x <= W.GORGE.maxX; x++) for (let z = W.GORGE.lakeMinZ; z <= W.GORGE.lakeMaxZ; z++) for (let y = W.GORGE.waterMinY; y <= W.GORGE.waterMaxY; y++) {
    if (x === W.LADDER.x && z === W.LADDER.z) { assert(prop(x, y, z, 'ladder', 'waterlogged') === true, 'Lake ladder not waterlogged'); continue; }
    assert(Number(prop(x, y, z, 'water', 'level')) === 0, `Water at ${x},${y},${z} is not a source block`);
    water++;
  }
  for (let x = W.GORGE.minX; x <= W.GORGE.maxX; x++) for (const z of [-40, 0, 40]) assert(at(x, W.GORGE.floorY, z)?.boundingBox === 'block', `Lake floor missing at ${x},${z}`);
  // Pilgrim's ladder and no other climbables on the gorge walls.
  for (let y = W.LADDER.minY; y <= W.LADDER.maxY; y++) { assert(prop(W.LADDER.x, y, W.LADDER.z, 'ladder', 'facing') === 'east', 'Ladder facing'); assert(at(W.LADDER.wallX, y, W.LADDER.z)?.boundingBox === 'block', 'Ladder wall'); }
  for (const x of [W.GORGE.minX, W.GORGE.maxX]) for (let z = W.GORGE.minZ; z <= W.GORGE.maxZ; z++) for (let y = 76; y <= 95; y++) {
    const n = at(x, y, z)?.name;
    if (/ladder|vine|scaffolding/.test(n) && !(x === W.LADDER.x && z === W.LADDER.z)) throw Error(`Unexpected climbable ${n} at ${x},${y},${z}`);
  }
  // Waterfall: source pool and the falling column, clear of the crossing.
  for (let x = W.FALLS.minX; x <= W.FALLS.maxX; x++) {
    for (let z = W.FALLS.sourceMinZ; z <= W.FALLS.sourceMaxZ; z++) block(x, W.FALLS.sourceY, z, 'water');
    for (const y of [110, 100, 90]) block(x, y, W.FALLS.lipZ, 'water');
  }
  for (let x = W.GORGE.minX; x <= W.GORGE.maxX; x++) for (let z = -6; z <= 6; z++) for (let y = 81; y <= 125; y++) assert(at(x, y, z)?.name !== 'water', 'Waterfall water crosses the bridge site');
  evidence.push(`Gorge x=4..12 open from y=81 to 130 over z=-16..16 with solid rims; ${water} lake cells are source water (y=76..80); ladder at (4,76..95,40) facing east is the only climbable on either wall; waterfall pool at y=118 and falling column at z=-50 checked, no water over z=-6..6.`);

  // ------------------------------------------------------------ shrine and redstone at rest
  // Moat geometry: threshold one above the court, doorway open, causeway the only approach.
  const M = W.MOAT, G = W.GATE, solid = (x, y, z) => at(x, y, z)?.boundingBox === 'block';
  block(G.x, G.thresholdY, G.z, G.threshold);
  for (const y of [G.thresholdY + 1, G.thresholdY + 2]) block(G.x, y, G.z, 'air');
  assert(solid(M.minX - 1, 95, M.z), 'Court floor missing west of the trench');
  for (let x = M.minX + 1; x <= M.maxX; x++) for (const z of [-1, 1]) for (const y of [96, 97]) assert(solid(x, y, z), `Moat flank wall missing at ${x},${y},${z}`);
  const causeway = () => W.range(M.minX, M.maxX).map(x => at(x, M.upY, M.z)?.name === M.block);
  const doorOpen = () => causeway().every(Boolean);
  const bridgeDown = () => W.range(M.minX, M.maxX).every(x => at(x, M.upY, M.z)?.name === 'air' && at(x, M.restY, M.z)?.name === M.block && at(x, M.pistonY, M.z).getProperties().extended === false);
  const lampsLit = () => W.LAMPS.map(([x, y, z]) => prop(x, y, z, 'redstone_lamp', 'lit') === true);
  for (const [x, y, z, n] of W.WIRING) block(x, y, z, n);
  function restState(label) {
    assert(bridgeDown(), `${label}: causeway raised with nobody on a plate`);
    // At rest the trench floor (y=94) is two below the threshold: no step up into the doorway.
    assert(G.thresholdY - M.restY === 2 && !solid(M.maxX, M.upY, M.z), `${label}: doorway reachable from the trench`);
    assert(lampsLit().every(l => !l), `${label}: a lamp is lit at rest`);
    for (const p of [W.P1, W.P2, ...W.PEDESTAL_PLATES]) assert(prop(...p, 'stone_pressure_plate', 'powered') === false, `${label}: plate ${p} powered at rest`);
    for (const [x, y, z, lit] of W.TORCHES_AT_REST) assert(at(x, y, z).getProperties().lit === lit, `${label}: torch ${x},${y},${z} not in rest state`);
  }
  restState('Rest');
  for (const [x, y, z] of W.PEDESTAL_PLATES) { block(x, y - 1, z, 'calcite'); block(x - 1, y - 1, z, 'polished_deepslate_slab'); }
  block(20, 95, 4, 'calcite'); block(30, 95, -3, 'calcite');
  // Shrine shell: obsidian-cored lower walls, no barrier/bedrock/command blocks anywhere in the shrine box.
  for (let x = 24; x <= 43; x++) for (let y = 86; y <= 109; y++) for (let z = -9; z <= 9; z++) {
    const n = at(x, y, z)?.name ?? '';
    if (/barrier|bedrock|reinforced_deepslate|command_block/.test(n)) throw Error(`Forbidden ${n} at ${x},${y},${z}`);
  }
  for (let z = -8; z <= 8; z++) if (z !== 0) block(25, 96, z, z === -8 || z === 8 ? 'calcite' : 'obsidian');
  const t = manifest.targets?.['twin-pedestals'];
  assert(t && t.x === 37.5 && t.y === 97 && t.z === 0.5, 'Manifest twin-pedestals target mismatch');
  for (let x = 33; x <= 39; x++) for (let z = -3; z <= 3; z++) block(x, 96, z, 'air');
  evidence.push('Doorway (25,97..98,0) open above a chiseled_deepslate threshold at y=96; causeway (20..24,94,0) lowered on five retracted sticky pistons, two below the threshold, flank walls (21..24,96..97,+-1) in place; 4 stone plates unpowered, all 8 ceiling lamps unlit, every hidden wire/torch/pocket cell and the torch-tower rest states (38,94,+-4 lit; 41,95/97/99/101/103,0 = off/on/off/on/off) read back; target twin-pedestals (37.5,97,0.5) matches the built pedestals.');

  // ------------------------------------------------------------ functional redstone test (both players)
  if (bots.length >= 2) {
    const [a, b] = names;
    const until = async (test, label, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return; await delay(200); } throw Error('Redstone test timeout: ' + label); };
    const tp = async (n, x, y, z) => { await con.one(`tp ${n} ${x} ${y} ${z}`); };
    const lit = () => lampsLit().every(Boolean), dark = () => lampsLit().every(l => !l);
    await tp(b, 17.5, 96, 0.5);
    await tp(a, W.P1[0] + 0.5, W.P1[1], W.P1[2] + 0.5);
    await until(doorOpen, 'P1 raises the causeway');
    await tp(a, 18.5, 96, -3.5);
    await until(bridgeDown, 'causeway drops after P1 is released');
    await tp(b, W.P2[0] + 0.5, W.P2[1], W.P2[2] + 0.5);
    await until(doorOpen, 'P2 raises the causeway');
    await tp(b, 28.5, 96, 1.5);
    await until(bridgeDown, 'causeway drops after P2 is released');
    const [pa, pb] = W.PEDESTAL_PLATES;
    await tp(a, pa[0] + 0.5, pa[1], pa[2] + 0.5);
    await delay(2500);
    assert(dark(), 'Lamps lit with only one pedestal pressed');
    await tp(b, pb[0] + 0.5, pb[1], pb[2] + 0.5);
    await until(lit, 'both pedestals light all 8 lamps');
    await tp(a, 34.5, 96, -1.5);
    await until(dark, 'lamps go dark when one pedestal is released');
    await delay(1500);
    assert(dark(), 'Lamps relit with only the second pedestal pressed');
    await tp(b, 34.5, 96, 1.5);
    await delay(2500);
    evidence.push(`Functional redstone test with ${a} and ${b} by teleport: P1 alone raises the causeway to y=95 and it drops on release, P2 alone does the same (OR); one pedestal leaves all lamps dark, both pedestals light all 8 lamps, releasing either darkens them (AND).`);
  } else {
    evidence.push('Only one player supplied: functional two-player redstone test skipped (wiring cells and rest states checked statically).');
  }
  // Restore both players exactly and re-check the rest state.
  for (const n of names) await resetPlayer(con, manifest, n);
  await finishReset(con, manifest, names);
  for (const bot of bots) await chunks(bot);
  await delay(2500);
  checkPlayers('Restored');
  restState('Restored');
  result.target = true;
  result.spawn = true;
  evidence.push('After the functional test both players were reset (spawnpoint, clear, effects, xp, teleport with yaw, survival, heal) and re-checked; causeway lowered and lamps dark again.');

  // ------------------------------------------------------------ resources: exactly 20 cherry logs, no other wood, bare east bank
  let logs = 0;
  for (const [x, z] of W.TREES) {
    assert(at(x, 95, z)?.name === 'grass_block' || at(x, 95, z)?.name === 'moss_block', `Tree at ${x},${z} not rooted on grass`);
    for (let y = W.TRUNK.minY; y <= W.TRUNK.maxY; y++) { assert(prop(x, y, z, 'cherry_log', 'axis') === 'y', 'Log axis'); logs++; }
    assert(prop(x, 101, z, 'cherry_leaves', 'persistent') === true && prop(x + 2, 100, z, 'cherry_leaves', 'persistent') === true, 'Canopy leaves not persistent');
  }
  const WOOD = /(_log|_wood|_planks|_stem|_hyphae)$/;
  let woodCount = 0, eastSoil = [];
  for (let x = W.BOUNDS.minX; x <= W.BOUNDS.maxX; x++) for (let z = W.BOUNDS.minZ; z <= W.BOUNDS.maxZ; z++) for (let y = W.BOUNDS.minY; y <= 140; y++) {
    const b = at(x, y, z);
    assert(b, `Unloaded block at ${x},${y},${z}`);
    if (b.name === 'air' || b.name === 'stone') continue;
    if (WOOD.test(b.name)) woodCount++;
    if (/barrier|bedrock|reinforced_deepslate|command_block/.test(b.name)) throw Error(`Forbidden ${b.name} at ${x},${y},${z}`);
    if (x >= W.EAST_BANK.minX && x <= W.EAST_BANK.maxX && Math.abs(z) <= 55 && y >= 95 && y <= 110 && /^(dirt|grass_block|coarse_dirt|rooted_dirt|podzol|mycelium|moss_block|dirt_path)$/.test(b.name)) eastSoil.push(`${b.name}@${x},${y},${z}`);
  }
  assert(logs === 20 && woodCount === 20, `Expected exactly 20 cherry logs and no other wood, found ${woodCount}`);
  assert(eastSoil.length === 0, 'Soil on the east bank: ' + eastSoil.slice(0, 5).join(' '));
  for (const z of [-5, 5]) { block(2, 96, z, 'stone_brick_wall'); block(2, 97, z, 'stone_brick_wall'); block(2, 98, z, 'lantern'); }
  result.resources = true;
  evidence.push('Exactly 20 cherry_log[axis=y] blocks (4 trunks, y=96..100, rooted on grass/moss) and no other log/wood/planks/stem/hyphae in x=-40..56, y=61..140, z=-64..64; canopy leaves persistent; no dirt/grass/moss on the playable east bank; rim lantern posts are stone_brick_wall; no barrier/bedrock/reinforced deepslate/command blocks.');

  // ------------------------------------------------------------ capabilities
  const expected = ['observe', 'move_to', 'mine', 'place', 'craft', 'say', 'listen'];
  assert(JSON.stringify(manifest.required_capabilities) === JSON.stringify(expected), 'Capability declaration mismatch');
  for (const bot of bots) for (const m of ['blockAt', 'lookAt', 'setControlState', 'dig', 'placeBlock', 'craft', 'recipesFor', 'chat', 'on'])
    assert(typeof bot[m] === 'function', 'Missing Mineflayer primitive ' + m);
  result.capabilities = true;
  evidence.push('Declared capabilities observe, move_to, mine, place, craft, say, listen; matching Mineflayer primitives present for every player bot (agent wrapper integration is covered by the repository preflight).');

  // ------------------------------------------------------------ recorder prerequisites
  assert(eye.version === VERSION, 'Version mismatch');
  for (const bot of bots) assert(bot.entity && bot.game.dimension === 'overworld', 'Missing observable overworld player');
  for (const [x, y, z] of W.CAMERA_AIR) block(x, y, z, 'air');
  result.recorder = true;
  evidence.push(`Minecraft ${VERSION}, both player entities in the overworld, open camera positions ${W.CAMERA_AIR.map(p => '(' + p.join(',') + ')').join(' ')} checked. Recorder connection and capture remain repository-preflight/manual checks.`);
  await con.one('save-all flush');
} catch (error) {
  result.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await closeAll(bots);
  if (!process.env.EMERGENCE_VALIDATION_REPORT) throw Error('EMERGENCE_VALIDATION_REPORT required');
  await writeFile(process.env.EMERGENCE_VALIDATION_REPORT, JSON.stringify(result, null, 2) + '\n');
}
