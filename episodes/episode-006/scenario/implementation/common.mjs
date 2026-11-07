// Shared helpers for install.mjs and verify.mjs (two-player scenario).
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {waitForSpawn, withDeadline, closeScenarioBot} from './lifecycle.mjs';

if (!process.env.EMERGENCE_REPO) throw Error('EMERGENCE_REPO required');
const require = createRequire(process.env.EMERGENCE_REPO + '/package.json');
export const mineflayer = require('mineflayer');
export const {Vec3} = require('vec3');
const run = promisify(execFile);
export const delay = ms => new Promise(r => setTimeout(r, ms));
export const VERSION = '1.21.4';
const NAME = /^[A-Za-z0-9_]{1,16}$/;

/** Players to prepare: EMERGENCE_PLAYERS (team episodes), else AGENT_ID. */
export function players() {
  const raw = process.env.EMERGENCE_PLAYERS ?? process.env.AGENT_ID ?? 'emergence-player';
  const names = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) throw Error('No players supplied');
  for (const n of names) if (!NAME.test(n)) throw Error('Invalid player name ' + JSON.stringify(n));
  if (new Set(names.map(n => n.toLowerCase())).size !== names.length) throw Error('Duplicate player names');
  return names;
}

export async function loadManifest() {
  const dir = process.env.EMERGENCE_SCENARIO_DIR;
  if (!dir) throw Error('EMERGENCE_SCENARIO_DIR required');
  return JSON.parse(await readFile(dir + '/manifest.json', 'utf8'));
}

export function spawnFor(manifest, name) { return manifest.spawns?.[name] ?? manifest.spawn; }
/** Minecraft yaw: west-bank spawns face east (-90) across the gorge, east-bank spawns face west (90). */
export function yawFor(spawn) { return spawn.x < 8 ? -90 : 90; }
/** Mineflayer yaw (radians) for a Minecraft yaw in degrees. */
export function botYaw(mcYaw) { const t = 2 * Math.PI; return ((Math.PI - mcYaw * Math.PI / 180) % t + t) % t; }

export function connect(username) {
  const bot = mineflayer.createBot({host: '127.0.0.1', port: Number(process.env.MC_PORT ?? 25565), username, version: VERSION, viewDistance: 'normal'});
  bot.on('error', error => console.error(`Scenario connection (${username}):`, error.message));
  return bot;
}

export async function connectAll(names) {
  const bots = [];
  try {
    for (const name of names) {
      const bot = connect(name);
      bots.push(bot);
      await waitForSpawn(bot);
    }
    return bots;
  } catch (error) {
    await closeAll(bots);
    throw error;
  }
}

export async function closeAll(bots) { await Promise.all(bots.map(b => closeScenarioBot(b))); }

export async function chunks(bot, ms = 45000) { await withDeadline(bot.waitForChunksToLoad(), ms, 'Chunk loading timeout'); }

async function sendRaw(text) {
  await run('docker', ['compose', 'exec', '-T', '--user', '1000', 'minecraft', 'mc-send-to-console', text], {cwd: process.env.EMERGENCE_REPO, timeout: 60000, maxBuffer: 1048576});
}

/**
 * Console sender. Commands are sent in newline-separated batches (the image's
 * mc-send-to-console echoes its arguments into the console pipe line by line);
 * every batch ends with a tellraw token that `listener` must observe in chat,
 * so the next batch is only sent after the server has executed the previous one.
 */
export function consoleFor(listener, ackPlayer) {
  let serial = 0;
  async function batch(lines, timeoutMs = 90000) {
    const token = `twin_shrine_ack_${process.pid}_${++serial}`;
    let onMessage, timer;
    const received = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`Console acknowledgement timeout (${lines[0]?.slice(0, 60)})`)), timeoutMs);
      onMessage = m => { if (m.includes(token)) resolve(); };
      listener.on('messagestr', onMessage);
    });
    received.catch(() => {});
    try {
      await sendRaw([...lines, 'tellraw ' + ackPlayer + ' ' + JSON.stringify({text: token})].join('\n'));
      await received;
    } finally {
      clearTimeout(timer);
      listener.removeListener('messagestr', onMessage);
    }
  }
  async function all(commands, {maxLines = 40, maxBytes = 3500} = {}) {
    let chunk = [], bytes = 0;
    for (const c of commands) {
      if (/[\r\n]/.test(c)) throw Error('Console command must be a single line');
      if (chunk.length && (chunk.length >= maxLines || bytes + c.length + 1 > maxBytes)) { await batch(chunk); chunk = []; bytes = 0; }
      chunk.push(c); bytes += c.length + 1;
    }
    if (chunk.length) await batch(chunk);
  }
  return {batch, all, one: c => batch([c])};
}

export const GAMERULES = ['doDaylightCycle false', 'doWeatherCycle false', 'doMobSpawning false', 'doPatrolSpawning false', 'doTraderSpawning false', 'doFireTick false', 'randomTickSpeed 0', 'keepInventory false', 'spawnRadius 0'];
export const ENVIRONMENT = [...GAMERULES.map(r => 'gamerule ' + r), 'difficulty peaceful', 'time set 9000', 'weather clear'];

/** Reset one player to its exact start: position, facing, survival, full health/food, nothing carried. */
export async function resetPlayer(con, manifest, name) {
  const s = spawnFor(manifest, name), yaw = yawFor(s);
  await con.batch([
    `spawnpoint ${name} ${Math.floor(s.x)} ${Math.floor(s.y)} ${Math.floor(s.z)} ${yaw}`,
    `clear ${name}`, `effect clear ${name}`,
    `experience set ${name} 0 levels`, `experience set ${name} 0 points`,
    `tp ${name} ${s.x} ${s.y} ${s.z} ${yaw} 10`,
    `gamemode survival ${name}`,
    `effect give ${name} minecraft:instant_health 1 10 true`,
    `effect give ${name} minecraft:saturation 1 10 true`,
  ]);
}
export async function finishReset(con, manifest, names) {
  await delay(1500);
  await con.batch(names.flatMap(name => {
    const s = spawnFor(manifest, name);
    return [`effect clear ${name}`, `tp ${name} ${s.x} ${s.y} ${s.z} ${yawFor(s)} 10`];
  }));
}
