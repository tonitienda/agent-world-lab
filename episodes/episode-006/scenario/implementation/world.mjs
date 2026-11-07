// Deterministic geometry for "The Twin Shrine of Sakura Falls".
// Pure module: no I/O, no randomness. install.mjs sends worldCommands() to the
// server console; verify.mjs reuses the exported coordinates.
// Axes: +x east, +z south. A player standing on floor y=95 has position y=96.

export const BOUNDS = {minX: -40, maxX: 56, minY: 61, maxY: 255, minZ: -64, maxZ: 64};
export const RIM_Y = 95;
export const WEST_BANK = {minX: -33, maxX: 3};
export const EAST_BANK = {minX: 13, maxX: 49};
export const GORGE = {minX: 4, maxX: 12, minZ: -55, maxZ: 55, floorY: 75, waterMinY: 76, waterMaxY: 80, lakeMinZ: -50, lakeMaxZ: 55};
export const TREES = [[-12, -6], [-15, 3], [-10, 8], [-18, -2]];
export const TRUNK = {minY: 96, maxY: 100};
export const LADDER = {x: 4, wallX: 3, z: 40, minY: 76, maxY: 95};
// Gate: an open doorway whose threshold sits one block above the court, behind a
// piston-raised causeway. At rest the causeway lies in a 1-deep trench, two blocks
// below the threshold (unclimbable); while P1 or P2 is pressed, five sticky pistons
// lift it level with the court so the threshold is a single step.
export const GATE = {x: 25, z: 0, thresholdY: 96, threshold: 'chiseled_deepslate'};
export const MOAT = {minX: 20, maxX: 24, z: 0, restY: 94, upY: 95, pistonY: 93, block: 'chiseled_stone_bricks'};
export const P1 = [20, 96, 4];
export const P2 = [30, 96, -3];
export const PEDESTAL_PLATES = [[37, 97, -4], [37, 97, 4]];
// Eight ceiling lamps in an octagon around the pedestals (hall ceiling y=103).
export const LAMPS = [[35, 103, -6], [38, 103, -6], [40, 103, -3], [40, 103, 3], [38, 103, 6], [35, 103, 6], [33, 103, 3], [33, 103, -3]];
export const FALLS = {minX: 7, maxX: 9, sourceMinZ: -53, sourceMaxZ: -51, lipZ: -50, sourceY: 118};
// Open air that cameras can use: above the gorge, above each spawn, over the shrine.
export const CAMERA_AIR = [[8, 110, 0], [-4, 104, 0], [18, 104, 0], [8, 100, -30], [37, 112, 0]];
// Hidden redstone: [x, y, z, expected block name] at rest (no plate pressed).
export const WIRING = [
  // Causeway OR bus: P1 support (20,95,4) and P2 support (30,95,-3) feed one dust line
  // at (20..24,94,-1) beside the trench. Each dust weakly powers the stone it lies on
  // (x,93,-1), which drives the sticky piston beside it (dust under a piston would not).
  [20, 94, 4, 'redstone_wire'], ...range(-1, 4).map(z => [19, 94, z, 'redstone_wire']),
  ...range(20, 26).map(x => [x, 94, -1, 'redstone_wire']),
  [26, 94, -2, 'redstone_wire'], ...range(26, 30).map(x => [x, 94, -3, 'redstone_wire']),
  ...range(MOAT.minX, MOAT.maxX).flatMap(x => [[x, 93, -1, 'stone'], [x, MOAT.pistonY, MOAT.z, 'sticky_piston'], [x, MOAT.restY, MOAT.z, MOAT.block], [x, MOAT.upY, MOAT.z, 'air']]),
  // Pedestal AND: plate -> pedestal -> dust D1 -> support S1 -> wall torch (inverter).
  [37, 95, -4, 'redstone_wire'], [37, 95, 4, 'redstone_wire'], [38, 95, -4, 'air'], [38, 95, 4, 'air'],
  [38, 94, -4, 'redstone_wall_torch'], [38, 94, 4, 'redstone_wall_torch'],
  ...range(-4, 4).map(z => [39, 94, z, 'redstone_wire']),
  [40, 94, 0, 'redstone_wire'],
  // Torch tower hidden in the altar: odd torches follow AND, even ones its inverse.
  [41, 95, 0, 'redstone_torch'], [41, 97, 0, 'redstone_torch'], [41, 99, 0, 'redstone_torch'], [41, 101, 0, 'redstone_torch'], [41, 103, 0, 'redstone_torch'],
  [41, 94, 0, 'obsidian'], [41, 104, 0, 'obsidian'],
  // Attic dust over the lamps (rectangle x=33..40, z=-6..6 plus a spine at z=0).
  ...range(-6, 6).map(z => [40, 104, z, 'redstone_wire']),
  ...range(-6, 6).map(z => [33, 104, z, 'redstone_wire']),
  ...range(34, 39).flatMap(x => [[x, 104, -6, 'redstone_wire'], [x, 104, 6, 'redstone_wire'], [x, 104, 0, 'redstone_wire']]),
];
export const TORCHES_AT_REST = [
  [38, 94, -4, true], [38, 94, 4, true],
  [41, 95, 0, false], [41, 97, 0, true], [41, 99, 0, false], [41, 101, 0, true], [41, 103, 0, false],
];

export function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }

/** Integer hash in [0,1) of (x,z,seed). */
export function hash(x, z, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul((s | 0) + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x, z, scale, s) {
  const gx = Math.floor(x / scale), gz = Math.floor(z / scale), fx = x / scale - gx, fz = z / scale - gz;
  const sm = t => t * t * (3 - 2 * t), u = sm(fx), v = sm(fz);
  const a = hash(gx, gz, s), b = hash(gx + 1, gz, s), c = hash(gx, gz + 1, s), d = hash(gx + 1, gz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Split a box into the fewest pieces of at most 32768 blocks (vanilla fill limit). */
export function splitBox(x1, y1, z1, x2, y2, z2, limit = 32768) {
  const lo = [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)], hi = [Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)];
  const d = [0, 1, 2].map(i => hi[i] - lo[i] + 1);
  if (d[0] * d[1] * d[2] <= limit) return [[lo, hi]];
  let best;
  for (let ax = 1; ax <= d[0]; ax++) {
    const sx = Math.ceil(d[0] / ax);
    for (let ay = 1; ay <= d[1]; ay++) {
      const sy = Math.ceil(d[1] / ay);
      if (sx * sy > limit) continue;
      const sz = Math.min(d[2], Math.floor(limit / (sx * sy)));
      const n = Math.ceil(d[0] / sx) * Math.ceil(d[1] / sy) * Math.ceil(d[2] / sz);
      if (!best || n < best.n) best = {n, s: [sx, sy, sz]};
    }
  }
  const out = [];
  for (let x = lo[0]; x <= hi[0]; x += best.s[0])
    for (let y = lo[1]; y <= hi[1]; y += best.s[1])
      for (let z = lo[2]; z <= hi[2]; z += best.s[2])
        out.push([[x, y, z], [Math.min(x + best.s[0] - 1, hi[0]), Math.min(y + best.s[1] - 1, hi[1]), Math.min(z + best.s[2] - 1, hi[2])]]);
  return out;
}

const PLAIN_BLOCK = /^[a-z_]+(\[[a-z_]+=[a-z0-9_]+(,[a-z_]+=[a-z0-9_]+)*\])?$/;
function id(block) {
  if (!PLAIN_BLOCK.test(block)) throw Error('Invalid block state ' + block);
  return 'minecraft:' + block;
}

/** Every world-building console command, in order. */
export function worldCommands() {
  const out = [];
  const inside = (x, y, z) => x >= BOUNDS.minX && x <= BOUNDS.maxX && y >= BOUNDS.minY && y <= BOUNDS.maxY && z >= BOUNDS.minZ && z <= BOUNDS.maxZ;
  const fill = (x1, y1, z1, x2, y2, z2, block, only) => {
    if (!inside(x1, y1, z1) || !inside(x2, y2, z2)) throw Error(`fill outside construction bounds: ${x1} ${y1} ${z1} ${x2} ${y2} ${z2}`);
    for (const [a, b] of splitBox(x1, y1, z1, x2, y2, z2))
      out.push(`fill ${a.join(' ')} ${b.join(' ')} ${id(block)}${only ? ' replace ' + id(only) : ''}`);
  };
  const set = (x, y, z, block) => {
    if (!inside(x, y, z)) throw Error(`setblock outside construction bounds: ${x} ${y} ${z}`);
    out.push(`setblock ${x} ${y} ${z} ${id(block)}`);
  };
  const B = BOUNDS;

  // ---------------------------------------------------------------- 1. Clear and base rock
  fill(B.minX, B.minY, B.minZ, B.maxX, B.maxY, B.maxZ, 'air');
  fill(B.minX, B.minY, B.minZ, B.maxX, RIM_Y, B.maxZ, 'stone');
  // West bank soil: three layers of dirt under grass (the east bank stays bare rock).
  fill(WEST_BANK.minX, 92, -55, WEST_BANK.maxX, 94, 55, 'dirt');
  fill(WEST_BANK.minX, 95, -55, WEST_BANK.maxX, 95, 55, 'grass_block');

  // ---------------------------------------------------------------- 2. Gorge and lake
  fill(GORGE.minX, GORGE.floorY + 1, GORGE.minZ, GORGE.maxX, RIM_Y, GORGE.maxZ, 'air');
  fill(GORGE.minX, GORGE.floorY, GORGE.minZ, GORGE.maxX, GORGE.floorY, GORGE.maxZ, 'calcite');
  for (let z = GORGE.minZ; z <= GORGE.maxZ; z += 3)
    for (let x = GORGE.minX; x <= GORGE.maxX; x += 3)
      if (hash(x, z, 21) < 0.45) fill(x, GORGE.floorY, z, Math.min(x + 1, GORGE.maxX), GORGE.floorY, Math.min(z + 1, GORGE.maxZ), hash(x, z, 22) < 0.6 ? 'tuff' : 'moss_block');
  fill(GORGE.minX, GORGE.waterMinY, GORGE.lakeMinZ, GORGE.maxX, GORGE.waterMaxY, GORGE.lakeMaxZ, 'water');

  // ---------------------------------------------------------------- 3. Mountain ring (sheer inner faces)
  const cells = [];
  for (let z0 = B.minZ; z0 <= B.maxZ; z0 += 4) {
    const z1 = Math.min(z0 + 3, B.maxZ);
    cells.push({x0: -40, x1: -37, z0, z1, outer: true});
    cells.push({x0: -36, x1: -34 + (hash(-1, z0, 7) < 0.4 ? 1 : 0), z0, z1});
    cells.push({x0: 53, x1: 56, z0, z1, outer: true});
    cells.push({x0: 50 - (hash(1, z0, 7) < 0.4 ? 1 : 0), x1: 52, z0, z1});
  }
  for (let x0 = -33; x0 <= 49; x0 += 4) {
    const x1 = Math.min(x0 + 3, 49), nearGorge = x1 >= 1 && x0 <= 15;
    cells.push({x0, x1, z0: -64, z1: -61, outer: true});
    cells.push({x0, x1, z0: -60, z1: -56 + (!nearGorge && hash(x0, -1, 9) < 0.4 ? 1 : 0)});
    cells.push({x0, x1, z0: 61, z1: 64, outer: true});
    cells.push({x0, x1, z0: 56 - (!nearGorge && hash(x0, 1, 9) < 0.4 ? 1 : 0), z1: 60});
  }
  for (const c of cells) {
    const cx = (c.x0 + c.x1) >> 1, cz = (c.z0 + c.z1) >> 1;
    let h = 118 + Math.round(noise(cx, cz, 16, 3) * 10 + noise(cx, cz, 6, 4) * 5) + (c.outer ? 3 : 0) + (hash(cx, cz, 5) > 0.82 ? 3 : 0);
    h = Math.min(h, 133);
    fill(c.x0, B.minY, c.z0, c.x1, h, c.z1, 'stone');
    if (h >= 127) {
      fill(c.x0, h, c.z0, c.x1, h, c.z1, 'snow_block');
      if (h >= 129 && c.x1 > c.x0 && c.z1 > c.z0) fill(c.x0 + 1, h + 1, c.z0 + 1, c.x1 - 1 + (c.x1 - c.x0 > 2 ? 0 : 1), h + 2, c.z1 - 1, 'snow_block');
    } else if (h <= 121) fill(c.x0, h, c.z0, c.x1, h, c.z1, 'moss_block');
  }

  // ---------------------------------------------------------------- 4. Sakura Falls massif (north end)
  for (let x = -3; x <= 19; x++) {
    const d = Math.abs(x - 8);
    const top = d <= 4 ? 121 : 121 - Math.round((d - 4) * 0.8) - (hash(x, 0, 11) < 0.5 ? 1 : 0);
    const face = x >= 4 && x <= 12 ? -51 : -51 - Math.floor(hash(x, 1, 12) * 3);
    fill(x, B.minY, -55, x, top, face, 'stone');
    if (d > 4) fill(x, top, -55, x, top, face, hash(x, 2, 13) < 0.6 ? 'moss_block' : 'mossy_cobblestone');
  }
  fill(4, 121, -55, 12, 121, -51, 'moss_block');
  fill(FALLS.minX, FALLS.sourceY, FALLS.sourceMinZ, FALLS.maxX, 121, FALLS.sourceMaxZ, 'air');
  // Three-wide pool of source water; it spills over the lip at z=-50 and falls into the lake.
  fill(FALLS.minX, FALLS.sourceY, FALLS.sourceMinZ, FALLS.maxX, FALLS.sourceY, FALLS.sourceMaxZ, 'water');
  fill(FALLS.minX - 1, 121, -51, FALLS.minX - 1, 121, -51, 'mossy_cobblestone');
  fill(FALLS.maxX + 1, 121, -51, FALLS.maxX + 1, 121, -51, 'mossy_cobblestone');
  set(5, 122, -53, 'flowering_azalea');
  set(11, 122, -54, 'azalea');

  // ---------------------------------------------------------------- 5. Rock strata (replace stone only)
  const bands = [[78, 79, 'andesite'], [84, 84, 'tuff'], [88, 89, 'andesite'], [100, 101, 'tuff'], [106, 106, 'andesite'], [111, 112, 'tuff'], [117, 117, 'andesite'], [123, 124, 'tuff'], [130, 130, 'andesite']];
  const regions = [[B.minX, -34, 0], [-33, 49, 1], [50, B.maxX, -1]];
  for (const [y0, y1, block] of bands)
    for (const [xa, xb, dy] of regions) fill(xa, y0 + dy, B.minZ, xb, y1 + dy, B.maxZ, block, 'stone');
  // Vertical streaks on both gorge walls (flush, so they never form ledges).
  for (let z = -48; z <= 54; z += 4) {
    for (const [x, seed, top] of [[3, 31, 91], [13, 32, 93]]) {
      const r = hash(x, z, seed);
      if (r > 0.7) continue;
      const mat = r < 0.2 ? 'tuff' : r < 0.38 ? 'calcite' : r < 0.55 ? 'mossy_cobblestone' : 'andesite';
      const y0 = 77 + Math.floor(hash(x, z, seed + 1) * 6), len = 1 + Math.floor(hash(x, z, seed + 2) * 3);
      fill(x, y0, z, x, top - Math.floor(hash(x, z, seed + 3) * 5), Math.min(z + len - 1, 55), mat);
    }
  }
  // Glow lichen tufts (not climbable), away from the crossing, the ladder and the falls.
  for (let z = -44; z <= 52; z += 3) {
    if (Math.abs(z) <= 18 || (z >= 34 && z <= 46)) continue;
    for (const [x, face, seed] of [[4, 'west', 41], [12, 'east', 42]]) {
      if (hash(x, z, seed) > 0.4) continue;
      const y0 = 82 + Math.floor(hash(x, z, seed + 1) * 6);
      fill(x, y0, z, x, y0 + 1 + Math.floor(hash(x, z, seed + 2) * 3), z, `glow_lichen[${face}=true]`);
    }
  }

  // ---------------------------------------------------------------- 6. West bank: the cherry grove
  // Foothills that rise toward the mountains, kept clear of the grove, spawn and ladder.
  const mounds = [[-29, -42, 5, 8, 4], [-28, -22, 4, 6, 3], [-30, 18, 4, 7, 4], [-29, 34, 5, 6, 3], [-26, 48, 6, 5, 4], [-14, -46, 7, 4, 3], [-12, 47, 6, 4, 3], [-2, -46, 3, 3, 2]];
  for (const [cx, cz, rx, rz, h] of mounds)
    for (let k = 1; k <= h; k++) {
      const ex = rx - k + 1, ez = rz - k + 1;
      if (ex < 1 || ez < 1) break;
      fill(cx - ex, 95 + k, cz - ez + 1, cx + ex, 95 + k, cz + ez - 1, 'grass_block');
      fill(cx - ex + 1, 95 + k, cz - ez, cx + ex - 1, 95 + k, cz + ez, 'grass_block');
    }
  // Moss patches.
  for (let i = 0; i < 16; i++) {
    const x = -31 + Math.floor(hash(i, 0, 51) * 30), z = -48 + Math.floor(hash(i, 1, 51) * 96), s = 1 + Math.floor(hash(i, 2, 51) * 3);
    if (Math.abs(z) <= 3 && x >= -10) continue;
    fill(x, 95, z, Math.min(x + s, 2), 95, z + s, 'moss_block', 'grass_block');
  }
  // Mossy stone path from spawn to the rim, with a small plaza around the spawn.
  fill(-9, 95, -2, -5, 95, 2, 'mossy_stone_bricks');
  fill(-4, 95, -1, 2, 95, 1, 'mossy_stone_bricks');
  for (let x = -9; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    if (x > -5 && Math.abs(z) > 1) continue;
    const r = hash(x, z, 61);
    if (r < 0.22) set(x, 95, z, 'mossy_cobblestone');
    else if (r < 0.34) set(x, 95, z, 'stone_bricks');
  }
  // Cherry trees: broad layered canopies first, then the 5-log trunks (the only wood).
  const leaves = 'cherry_leaves[persistent=true]';
  for (const [x, z] of TREES) {
    fill(x - 3, 99, z - 2, x + 3, 99, z + 2, leaves); fill(x - 2, 99, z - 3, x + 2, 99, z + 3, leaves);
    fill(x - 4, 100, z - 2, x + 4, 100, z + 2, leaves); fill(x - 2, 100, z - 4, x + 2, 100, z + 4, leaves); fill(x - 3, 100, z - 3, x + 3, 100, z + 3, leaves);
    fill(x - 3, 101, z - 2, x + 3, 101, z + 2, leaves); fill(x - 2, 101, z - 3, x + 2, 101, z + 3, leaves);
    fill(x - 2, 102, z - 1, x + 2, 102, z + 1, leaves); fill(x - 1, 102, z - 2, x + 1, 102, z + 2, leaves);
    // A few drooping blossoms below the rim of the canopy.
    for (const [dx, dz] of [[3, 0], [-3, 1], [0, 3], [1, -3], [-2, -2], [2, 2]])
      if (hash(x + dx, z + dz, 71) < 0.6) set(x + dx, 98, z + dz, leaves);
  }
  for (const [x, z] of TREES) fill(x, TRUNK.minY, z, x, TRUNK.maxY, z, 'cherry_log[axis=y]');
  // Pink petals under the grove, on grass or moss only, never on the path or a trunk.
  const blocked = new Set(TREES.map(([x, z]) => `${x},${z}`));
  for (let x = -23; x <= -6; x++) for (let z = -12; z <= 14; z++) {
    if (blocked.has(`${x},${z}`) || (x >= -9 && Math.abs(z) <= 2)) continue;
    const r = hash(x, z, 81);
    if (r < 0.2) set(x, 96, z, `pink_petals[flower_amount=${1 + Math.floor(hash(x, z, 82) * 4)},facing=${['north', 'south', 'east', 'west'][Math.floor(hash(x, z, 83) * 4)]}]`);
    blocked.add(`${x},${z}`);
  }
  // Azalea bushes scattered across the meadow.
  for (const [x, z, b] of [[-4, -9, 'flowering_azalea'], [-2, 7, 'azalea'], [-6, 14, 'flowering_azalea'], [-21, 10, 'azalea'], [-24, -8, 'flowering_azalea'], [-20, -14, 'azalea'], [-3, -18, 'flowering_azalea'], [-16, 22, 'flowering_azalea'], [-8, -26, 'azalea'], [-26, 2, 'flowering_azalea'], [-5, 26, 'azalea'], [-14, -30, 'flowering_azalea']])
    set(x, 96, z, b);
  // Two lanterns on stone-brick wall posts at the rim, framing the crossing (z=-4..4 stays clear).
  for (const z of [-5, 5]) { fill(2, 96, z, 2, 97, z, 'stone_brick_wall'); set(2, 98, z, 'lantern'); }
  // Waymarker above the pilgrim's ladder.
  set(2, 96, 38, 'stone_brick_wall'); set(2, 97, 38, 'lantern');

  // ---------------------------------------------------------------- 7. Pilgrim's ladder (west wall only)
  for (let y = LADDER.minY; y <= LADDER.maxY; y++)
    set(LADDER.x, y, LADDER.z, y <= GORGE.waterMaxY ? 'ladder[facing=east,waterlogged=true]' : 'ladder[facing=east]');
  // Lily pads drifting near the south end of the lake.
  for (let z = 44; z <= 54; z++) for (let x = 5; x <= 11; x++)
    if (hash(x, z, 91) < 0.1) set(x, GORGE.waterMaxY + 1, z, 'lily_pad');

  // ---------------------------------------------------------------- 8. East bank: bare rock and the court
  for (let i = 0; i < 22; i++) {
    const x = 14 + Math.floor(hash(i, 0, 101) * 35), z = -52 + Math.floor(hash(i, 1, 101) * 104), s = 1 + Math.floor(hash(i, 2, 101) * 4);
    const mat = ['andesite', 'tuff', 'calcite', 'andesite'][Math.floor(hash(i, 3, 101) * 4)];
    fill(x, 95, z, Math.min(x + s, 49), 95, Math.min(z + s, 55), mat, 'stone');
  }
  // Rocky terraces behind the shrine and boulders along the far rim (away from play areas).
  for (let z0 = -52; z0 <= 48; z0 += 8) {
    if (Math.abs(z0 + 2) < 16) continue;
    const w = 2 + Math.floor(hash(0, z0, 111) * 3), h = 1 + Math.floor(hash(1, z0, 111) * 3);
    fill(49 - w, 96, z0, 49, 95 + h, z0 + 5, hash(2, z0, 111) < 0.5 ? 'andesite' : 'stone');
    if (h > 1) fill(49 - w + 1, 96 + h, z0 + 1, 49, 96 + h, z0 + 4, hash(3, z0, 111) < 0.5 ? 'tuff' : 'mossy_cobblestone');
  }
  for (const [x, z, s, h, b] of [[15, -30, 1, 1, 'mossy_cobblestone'], [17, -42, 2, 2, 'andesite'], [15, 28, 1, 2, 'tuff'], [18, 40, 2, 1, 'mossy_cobblestone'], [16, 49, 1, 1, 'andesite'], [30, -36, 2, 2, 'tuff'], [34, 30, 1, 1, 'andesite'], [27, 44, 2, 1, 'mossy_cobblestone']])
    fill(x, 96, z, x + s, 95 + h, z + s, b);
  // Court: stone bricks with moss, a calcite edge along the rim and around plate P1.
  fill(13, 95, -11, 24, 95, 11, 'stone_bricks');
  fill(24, 95, -13, 47, 95, 13, 'stone_bricks');
  for (let x = 13; x <= 47; x++) for (let z = -13; z <= 13; z++) {
    if (x <= 24 && Math.abs(z) > 11) continue;
    if (hash(x, z, 121) < 0.18) set(x, 95, z, 'mossy_stone_bricks');
  }
  fill(13, 95, -11, 13, 95, 11, 'calcite');
  fill(14, 95, -11, 23, 95, -11, 'calcite'); fill(14, 95, 11, 23, 95, 11, 'calcite');
  fill(19, 95, 3, 21, 95, 5, 'calcite');
  fill(19, 95, -1, 23, 95, 1, 'polished_deepslate');
  for (const z of [-10, 10]) { fill(14, 96, z, 14, 97, z, 'stone_brick_wall'); set(14, 98, z, 'lantern'); }

  // ---------------------------------------------------------------- 9. The Twin Shrine (x=25..42, z=-8..8)
  fill(25, 86, -8, 42, 94, 8, 'obsidian');            // obsidian foundation; wiring is cut into it
  fill(24, 95, -9, 43, 95, 9, 'polished_deepslate');  // plinth and floor
  fill(25, 96, -8, 42, 102, 8, 'deepslate_tiles');    // shell
  fill(26, 96, -7, 30, 102, -5, 'obsidian'); fill(26, 96, 5, 30, 102, 7, 'obsidian'); // cores of the side masses
  fill(25, 96, -8, 42, 99, -8, 'obsidian'); fill(25, 96, 8, 42, 99, 8, 'obsidian');
  fill(42, 96, -8, 42, 99, 8, 'obsidian'); fill(25, 96, -8, 25, 99, 8, 'obsidian');
  for (const [a, b] of [[[25, -8], [42, -8]], [[25, 8], [42, 8]], [[42, -8], [42, 8]], [[25, -8], [25, 8]]]) {
    fill(a[0], 100, a[1], b[0], 100, b[1], 'calcite');
    fill(a[0], 102, a[1], b[0], 102, b[1], 'oxidized_copper');
  }
  for (const [x, z] of [[25, -8], [25, 8], [42, -8], [42, 8]]) fill(x, 96, z, x, 102, z, 'calcite');
  // Doorway: raised threshold, two blocks of headroom, lintel above.
  set(GATE.x, GATE.thresholdY, GATE.z, GATE.threshold);
  fill(GATE.x, GATE.thresholdY + 1, GATE.z, GATE.x, GATE.thresholdY + 2, GATE.z, 'air');
  fill(25, 99, -1, 25, 99, 1, 'calcite');             // gate lintel
  // Moat: trench along z=0 in front of the doorway, flanked by low walls so the
  // causeway is the only approach. Lanterns cap the walls' west ends.
  fill(MOAT.minX, MOAT.restY + 1, MOAT.z, MOAT.maxX, MOAT.upY, MOAT.z, 'air');
  for (const z of [-1, 1]) {
    fill(MOAT.minX + 1, 96, z, MOAT.maxX, 97, z, 'deepslate_bricks');
    set(MOAT.minX + 1, 98, z, 'lantern');
  }
  // Antechamber x=26..31, z=-3..3 (4 high) and hall x=32..41, z=-7..7 (7 high).
  fill(26, 96, -3, 31, 99, 3, 'air');
  fill(32, 96, -7, 41, 102, 7, 'air');
  fill(26, 95, -3, 31, 95, 3, 'deepslate_tiles');
  fill(26, 100, -3, 31, 100, 3, 'polished_deepslate');
  fill(31, 100, -3, 31, 100, 3, 'calcite');           // archway lintel
  set(31, 99, -3, 'calcite'); set(31, 99, 3, 'calcite');
  fill(31, 96, -4, 31, 99, -4, 'calcite'); fill(31, 96, 4, 31, 99, 4, 'calcite');
  set(30, 95, -3, 'calcite');                          // P2 marker / support
  for (const [x, z] of [[27, -2], [27, 2], [30, 2]]) set(x, 99, z, 'lantern[hanging=true]');
  // Hall floor rings and an aisle toward the altar.
  fill(33, 95, -6, 40, 95, 6, 'deepslate_tiles');
  fill(34, 95, -5, 39, 95, 5, 'polished_deepslate');
  fill(32, 95, 0, 39, 95, 0, 'calcite');
  // Twin pedestals (calcite, floor y=96) with a step in front and a lantern stele behind.
  for (const [, , z] of PEDESTAL_PLATES) {
    set(37, 96, z, 'calcite');
    set(38, 96, z, 'calcite'); set(38, 97, z, 'lantern');
    set(36, 96, z, 'polished_deepslate_slab[type=bottom]');
  }
  // Altar against the east wall; it hides the torch tower at x=41, z=0.
  fill(40, 96, -1, 41, 102, 1, 'calcite');
  fill(40, 96, -1, 40, 96, 1, 'polished_deepslate');
  set(40, 98, 0, 'sea_lantern');
  fill(40, 102, -1, 40, 102, 1, 'copper_block');
  for (const [x, z] of [[33, -6], [33, 6], [40, -6], [40, 6]]) set(x, 102, z, 'lantern[hanging=true]');
  // Ceiling, attic and stepped roof.
  fill(24, 103, -9, 43, 103, 9, 'polished_deepslate');
  fill(24, 104, -9, 43, 104, 9, 'calcite');
  fill(25, 104, -8, 42, 104, 8, 'deepslate_tiles');
  fill(26, 104, -7, 41, 104, 7, 'obsidian');
  fill(26, 105, -7, 41, 105, 7, 'deepslate_tiles');
  fill(28, 106, -5, 39, 106, 5, 'polished_deepslate');
  fill(30, 107, -3, 37, 107, 3, 'deepslate_tiles');
  fill(32, 108, -1, 35, 108, 1, 'oxidized_copper');
  fill(33, 109, 0, 34, 109, 0, 'copper_block');
  for (const [x, z] of [[26, -7], [26, 7], [41, -7], [41, 7]]) set(x, 106, z, 'copper_block');
  for (const [x, z] of [[24, -2], [24, 2]]) { set(x, 96, z, 'stone_brick_wall'); set(x, 97, z, 'lantern'); }

  // ---------------------------------------------------------------- 10. Redstone (placed last, rest state)
  // Causeway: pistons face up from y=93 and carry the trench floor at y=94.
  for (let x = MOAT.minX; x <= MOAT.maxX; x++) {
    set(x, MOAT.pistonY, MOAT.z, 'sticky_piston[facing=up,extended=false]');
    set(x, MOAT.restY, MOAT.z, MOAT.block);
  }
  // OR bus: P1 down the west side of the trench, P2 out under the west wall.
  set(20, 94, 4, 'redstone_wire');
  fill(19, 94, -1, 19, 94, 4, 'redstone_wire');
  fill(20, 94, -1, 26, 94, -1, 'redstone_wire');      // x=25 runs through the obsidian foundation
  set(26, 94, -2, 'redstone_wire');
  fill(26, 94, -3, 30, 94, -3, 'redstone_wire');
  // Pedestal AND.
  for (const z of [-4, 4]) {
    set(38, 95, z, 'air');                             // pocket under the stele
    set(37, 95, z, 'redstone_wire');                   // under the pedestal, powered by it
    set(38, 94, z, 'redstone_wall_torch[facing=east,lit=true]'); // on S1 (37,94,z)
  }
  fill(39, 94, -4, 39, 94, 4, 'redstone_wire');        // NAND line fed by both input torches
  set(40, 94, 0, 'redstone_wire');                     // points east into F (41,94,0)
  set(41, 95, 0, 'redstone_torch[lit=false]');         // FT: lit only when both pedestals are pressed
  set(41, 97, 0, 'redstone_torch[lit=true]');
  set(41, 99, 0, 'redstone_torch[lit=false]');
  set(41, 101, 0, 'redstone_torch[lit=true]');
  set(41, 103, 0, 'redstone_torch[lit=false]');        // powers B5 (41,104,0)
  for (const [x, y, z] of LAMPS) set(x, y, z, 'redstone_lamp[lit=false]');
  fill(40, 104, -6, 40, 104, 6, 'redstone_wire');
  fill(33, 104, -6, 33, 104, 6, 'redstone_wire');
  fill(34, 104, -6, 39, 104, -6, 'redstone_wire');
  fill(34, 104, 6, 39, 104, 6, 'redstone_wire');
  fill(34, 104, 0, 39, 104, 0, 'redstone_wire');
  // Plates last.
  for (const [x, y, z] of [P1, P2, ...PEDESTAL_PLATES]) set(x, y, z, 'stone_pressure_plate[powered=false]');
  return out;
}
