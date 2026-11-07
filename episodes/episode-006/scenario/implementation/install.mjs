// Install "The Twin Shrine of Sakura Falls" into a freshly reset world and
// prepare both players (ada, bram). Runs once, before verify.mjs.
import {players, loadManifest, spawnFor, connectAll, closeAll, chunks, consoleFor, ENVIRONMENT, resetPlayer, finishReset, delay, Vec3} from './common.mjs';
import {worldCommands, BOUNDS} from './world.mjs';

const names = players();
const manifest = await loadManifest();
const B = BOUNDS;
// Entity cleanup bounded to the construction volume; players are never selected.
const KILL = `kill @e[type=!minecraft:player,x=${B.minX},y=${B.minY},z=${B.minZ},dx=${B.maxX - B.minX},dy=${B.maxY - B.minY},dz=${B.maxZ - B.minZ}]`;
const commands = worldCommands();
if (commands.length >= 3000) throw Error('Too many world commands: ' + commands.length);

const bots = await connectAll(names);
try {
  const con = consoleFor(bots[0], names[0]);
  // Park every player in spectator above its spawn while the valley is rebuilt.
  await con.batch(names.flatMap(n => { const s = spawnFor(manifest, n); return [`gamemode spectator ${n}`, `tp ${n} ${s.x} 140 ${s.z}`]; }));
  await con.batch([...ENVIRONMENT, `forceload add ${B.minX} ${B.minZ} ${B.maxX} ${B.maxZ}`]);
  for (const bot of bots) await chunks(bot);
  await delay(3000);
  await con.batch([KILL]);
  await con.all(commands);
  await con.batch([KILL, `setworldspawn ${Math.floor(manifest.spawn.x)} ${Math.floor(manifest.spawn.y)} ${Math.floor(manifest.spawn.z)}`]);
  // Let the waterfall settle and redstone reach its rest state.
  await delay(4000);
  for (const n of names) await resetPlayer(con, manifest, n);
  await finishReset(con, manifest, names);
  for (const bot of bots) await chunks(bot);
  await delay(1500);
  for (const [i, bot] of bots.entries()) {
    const s = spawnFor(manifest, names[i]);
    if (bot.entity.position.distanceTo(new Vec3(s.x, s.y, s.z)) > 0.2) throw Error(`Final teleport of ${names[i]} not acknowledged by player position`);
  }
  await con.batch([`forceload remove ${B.minX} ${B.minZ} ${B.maxX} ${B.maxZ}`, 'save-all flush']);
} finally {
  await closeAll(bots);
}
