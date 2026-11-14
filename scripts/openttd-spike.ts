import {spawn, execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {mkdir, writeFile, cp, readFile, stat} from 'node:fs/promises';
import {createServer} from 'node:net';
import {randomBytes, createHash} from 'node:crypto';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {AdminClient} from '../packages/openttd/src/admin.js';
import type {Recording, Capture, Position} from '../packages/openttd/src/camera.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = process.argv.slice(2);
function option(name: string, fallback?: string): string | undefined {
  const index = options.indexOf(name);
  if (index === -1) return fallback;
  const value = options[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = (server.address() as {port: number}).port;
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  return port;
}

// A generated 64x64 uncompressed 24-bit BMP, all pixels at a nonzero height.
function flatHeightmap(): Buffer {
  const size = 64, stride = size * 3;
  const bmp = Buffer.alloc(54 + stride * size, 128);
  bmp.fill(0, 0, 54);
  bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(size, 18); bmp.writeInt32LE(size, 22);
  bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(stride * size, 34);
  return bmp;
}

type Site = {x: number; y: number; front_x: number; front_y: number; acceptance: number; production: number; town: number};
const distance = (a: Site, b: Site) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

async function main(): Promise<void> {
  const record = options.includes('--record');
  if (options.includes('--help')) {
    console.log('npm run openttd:spike -- [--record] [--binary /path/to/openttd --graphics /path/to/opengfx.tar] [--out new-directory]');
    return;
  }
  const binary = option('--binary', process.env.OPENTTD_BINARY ?? join(root, 'data/openttd-runtime/OpenTTD.app/Contents/MacOS/openttd'));
  const graphics = option('--graphics', process.env.OPENTTD_GRAPHICS ?? join(root, 'data/openttd-runtime/opengfx-8.0.tar'));
  if (!binary || !graphics) throw new Error('Set OPENTTD_BINARY and OPENTTD_GRAPHICS, or pass --binary and --graphics. See packages/openttd/README.md.');
  const executable = resolve(binary);
  const baseGraphics = resolve(graphics);
  await stat(executable); await stat(baseGraphics);
  const version = execFileSync(executable, ['-h'], {encoding: 'utf8'}).split('\n')[0]!.trim();
  if (version !== 'OpenTTD 15.3') throw new Error(`Spike requires OpenTTD 15.3; found ${version}`);
  const out = resolve(option('--out', join(root, 'data/openttd-spikes', new Date().toISOString().replaceAll(':', '-')))!);
  await mkdir(dirname(out), {recursive: true});
  await mkdir(out, {recursive: false}); // Never overwrite an earlier experiment.
  const home = join(out, 'world');
  await mkdir(join(home, 'baseset'), {recursive: true});
  // -X excludes global/bundle folders; supply the engine's own language/base files locally.
  const assets = option('--assets', executable.includes('.app/Contents/MacOS/')
    ? resolve(dirname(executable), '../Resources') : undefined);
  if (assets) for (const directory of ['lang', 'baseset', 'game', 'ai'])
    await cp(join(assets, directory), join(home, directory), {recursive: true});
  await cp(join(root, 'packages/openttd/game'), join(home, 'game'), {recursive: true});
  await cp(join(root, 'packages/openttd/ai'), join(home, 'ai'), {recursive: true});
  const graphicsTarget = join(home, 'baseset', baseGraphics.endsWith('.tar') ? 'opengfx.tar' : 'opengfx');
  await cp(baseGraphics, graphicsTarget, {recursive: true});
  const map = join(home, 'flat.bmp');
  await writeFile(map, flatHeightmap());
  const adminPort = await freePort();
  let gamePort = await freePort();
  while (gamePort === adminPort) gamePort = await freePort();
  const password = randomBytes(24).toString('hex');
  const config = `[network]
server_admin_port = ${adminPort}
server_port = ${gamePort}
allow_insecure_admin_login = true
server_game_type = local
min_active_clients = 0
pause_on_join = false
admin_password = ${password}

[misc]
transparency_options = ${record ? 4 : 0}

[server_bind_addresses]
127.0.0.1 =

[game_creation]
map_x = 6
map_y = 6
heightmap_height = 2
starting_year = 1950
custom_town_number = 2
generation_seed = 7

[difficulty]
number_towns = 4
industry_density = 0
vehicle_breakdowns = 0
disasters = false

[economy]
town_layout = 3
town_growth_rate = 0
larger_towns = 1
initial_city_size = 4
inflation = false

[construction]
command_pause_level = 3
freeform_edges = true

[game_scripts]
"Terrarium Bridge" =

[ai_players]
none =
`;
  const configPath = join(home, 'openttd.cfg');
  await writeFile(configPath, config, {mode: 0o600});
  const hashes: Record<string, string> = {};
  for (const path of ['packages/openttd/game/terrarium/main.nut', 'packages/openttd/game/terrarium/info.nut',
    'packages/openttd/ai/idle/main.nut', 'packages/openttd/ai/idle/info.nut', 'packages/openttd/src/admin.ts',
    'packages/openttd/src/camera.ts', 'scripts/openttd-spike.ts'])
    hashes[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  await writeFile(join(out, 'manifest.json'), JSON.stringify({version, seed: 7, adminPort, gamePort,
    graphicsSha256: (await stat(baseGraphics)).isFile() ? createHash('sha256').update(await readFile(baseGraphics)).digest('hex') : null,
    scriptHashes: hashes, record, config: config.replace(password, '<redacted>'), startedAt: new Date().toISOString()}, null, 2));

  const child = spawn(executable, ['-D', `127.0.0.1:${gamePort}`, '-c', configPath, '-X', '-x',
    '-g', map, '-G', '7', '-s', 'null', '-m', 'null', '-b', '8bpp-optimized', '-d', 'script=3'], {cwd: home, stdio: ['pipe', 'pipe', 'pipe']});
  let logs = '';
  const log = (value: Buffer) => { logs += value.toString(); appendFileSync(join(out, 'server.log'), value); };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  let childError: Error | undefined;
  child.on('error', error => { childError = error; });
  const client = new AdminClient(adminPort, password);
  const events: unknown[] = [];
  let closed = false;
  const stopped = new Promise<void>(done => { child.once('close', () => { closed = true; done(); }); });
  const watchdog = setTimeout(() => child.kill('SIGTERM'), record ? 420_000 : 240_000);
  const interrupted = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  async function request(op: string, args: Record<string, unknown> = {}) {
    const result = await client.request(op, args, op === 'advance' ? 100_000 : 30_000);
    events.push({at: new Date().toISOString(), op, args, result});
    await writeFile(join(out, 'events.json'), JSON.stringify(events, null, 2));
    if (!result.ok) throw new Error(`${op}: ${JSON.stringify(result.data)}`);
    return result;
  }
  async function rcon(command: string) {
    const lines = await client.rcon(command);
    events.push({at: new Date().toISOString(), trustedRunnerCommand: command, lines});
    return lines;
  }
  async function waitForArtifact(relative: string, png = false): Promise<void> {
    // RCON_END acknowledges the command; image/save work can finish asynchronously.
    const path = join(out, relative);
    for (let i = 0; i < 100; i++) {
      try {
        const bytes = await readFile(path);
        if (bytes.length > 12 && (!png || bytes.subarray(-8, -4).toString() === 'IEND')) return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (closed) throw new Error(`OpenTTD exited before finishing ${relative}`);
      await delay(100);
    }
    throw new Error(`OpenTTD did not finish artifact ${relative}`);
  }
  let recording: Recording | undefined;
  async function capture(kind: Capture['kind'], label?: string, focus?: Position) {
    if (!record) return;
    if (!recording) {
      const geometry = (await request('geometry')).data;
      recording = {version: 1, sampleEconomyDays: 1, northHeight: geometry.north_height,
        southHeight: geometry.south_height, captures: []};
    }
    const snapshot = (await request('observe')).data;
    const stations = (await request('stations')).data;
    const name = `camera-${String(recording.captures.length).padStart(5, '0')}`;
    const image = `world/screenshot/${name}.png`;
    await rcon(`screenshot giant ${name}`);
    await waitForArtifact(image, true);
    recording.captures.push({image, kind, label, focus, snapshot, stations});
    await writeFile(join(out, 'captures.json'), JSON.stringify(recording, null, 2));
  }
  try {
    // Wait for the actual listening notification, rather than probing occupied ports.
    for (let i = 0; i < 150 && !logs.includes('Map generated, starting game'); i++) {
      if (closed || childError) throw childError ?? new Error(`OpenTTD exited ${child.exitCode}`);
      await delay(100);
    }
    await client.connect();
    console.log(`OpenTTD started; artifacts: ${out}`);
    console.log(await rcon('start_ai "Terrarium Idle"'));
    const before = (await request('observe')).data;
    assert.equal(before.paused, true);
    await delay(1100);
    const still = (await request('observe')).data;
    assert.equal(still.date, before.date, 'Economy date drifted while thinking');
    const rejected = await client.request('build_road', {x: -1, y: 0, end_x: 1, end_y: 1});
    events.push({op: 'build_road', args: {x: -1, y: 0, end_x: 1, end_y: 1}, result: rejected});
    assert.equal(rejected.ok, false, 'Invalid coordinates should be rejected');
    const afterRejected = (await request('observe')).data;
    assert.equal(afterRejected.balance, before.balance);
    assert.equal(afterRejected.date, before.date);
    const sites: Site[] = [];
    for (const town of before.towns) {
      const reply = await request('sites', {...town.position, radius: 16});
      sites.push(...reply.items);
    }
    const townId = before.towns[0].id;
    const usable = sites.filter(s => s.town === townId && s.acceptance >= 8 && s.production > 0);
    let pair: [Site, Site] | undefined;
    for (const a of usable) for (const b of usable) {
      if (!pair || distance(a, b) > distance(...pair)) pair = [a, b];
    }
    assert.ok(pair && distance(...pair) >= 8, 'Need two separated passenger sites');
    const [a, b] = pair;
    const depot = sites.find(s => s.town === townId && distance(s, a) > 3 && distance(s, b) > 3);
    assert.ok(depot, 'Need a depot site');
    const plan = {a, b, depot};
    await writeFile(join(out, 'route-plan.json'), JSON.stringify(plan, null, 2));
    console.log('Building two stops, a depot and a bus from observed sites.');
    await capture('overview', 'One bus. Two stops. Can this route earn its keep?');
    await capture('construction', 'The first stop will go here', a);
    await request('build_stop', a);
    await capture('construction', 'First passenger stop built', a);
    await capture('construction', 'A second stop across town', b);
    await request('build_stop', b);
    await capture('construction', 'Second passenger stop built', b);
    await request('build_depot', depot);
    await capture('construction', 'A depot for the new bus', depot);
    // Connect the station/depot entrances explicitly, including their road tile halves.
    for (const s of [a, b, depot]) {
      const result = await client.request('build_road', {x: s.x, y: s.y, end_x: s.front_x, end_y: s.front_y});
      events.push({op: 'build_road', args: s, result});
      // Existing entrance road is a valid result; all other failures stop the spike.
      if (!result.ok && !String(result.data.error).includes('ALREADY_BUILT')) throw new Error(JSON.stringify(result));
    }
    const engines = (await request('engines')).data;
    assert.ok(engines.length, 'No available passenger bus');
    const vehicle = (await request('build_vehicle', {x: depot.x, y: depot.y, engine: engines[0].id})).data.vehicle;
    await request('append_order', {vehicle, x: a.x, y: a.y});
    await request('append_order', {vehicle, x: b.x, y: b.y});
    await request('start_vehicle', {vehicle});
    await capture('construction', 'Bus ready — two stops assigned', depot);
    const built = (await request('observe')).data;
    await rcon(`save "${join(out, 'route-built')}"`);
    await waitForArtifact('route-built.sav');
    await rcon('screenshot minimap before');
    await waitForArtifact('world/screenshot/before.png', true);
    await rcon('screenshot giant route-built');
    await waitForArtifact('world/screenshot/route-built.png', true);
    const snapshots = [built];
    const stepDays = record ? 1 : 15;
    for (let day = stepDays; day <= 90; day += stepDays) {
      const advanced = (await request('advance', {days: stepDays})).data;
      assert.equal(advanced.end_date - advanced.start_date, stepDays);
      assert.equal(advanced.paused, true);
      const snapshot = (await request('observe')).data;
      snapshots.push(snapshot);
      await writeFile(join(out, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
      await capture('operation');
      if (day % 15 === 0) console.log(`Day +${day}: balance ${snapshot.balance}, vehicle ${JSON.stringify(snapshot.vehicles[0])}`);
    }
    const after = snapshots.at(-1);
    assert.ok(snapshots.some(s => JSON.stringify(s.vehicles[0]?.position) !== JSON.stringify(built.vehicles[0]?.position)), 'Vehicle never moved');
    assert.ok(snapshots.some(s => s.vehicles[0]?.profit > 0), 'No positive vehicle profit observed');
    assert.ok(after.delivered > 0, 'No delivered passengers observed');
    await capture('outcome', `${after.delivered} passengers delivered — bus operating profit ${after.vehicles[0].profit}`);
    await rcon(`save "${join(out, 'after')}"`);
    await waitForArtifact('after.sav');
    await rcon('screenshot minimap after');
    await waitForArtifact('world/screenshot/after.png', true);
    await rcon('screenshot giant after-world');
    await waitForArtifact('world/screenshot/after-world.png', true);
    for (const file of ['route-built.sav', 'after.sav', 'world/screenshot/before.png',
      'world/screenshot/after.png', 'world/screenshot/route-built.png', 'world/screenshot/after-world.png'])
      assert.ok((await stat(join(out, file))).size > 0, `Missing capture: ${file}`);
    await writeFile(join(out, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
    const result = {status: 'passed', before, built, after, checks: ['paused observation', 'no date drift while idle',
      'invalid action rejected without state change', 'company-mode construction', 'vehicle orders and movement',
      `${90 / stepDays} exact ${stepDays}-day advances`, 'delivered passengers', 'positive vehicle profit', 'savegames and real world screenshots'],
      limitations: ['scripted driver, not an LLM trial', 'date stepping, not exact tick stepping',
        record ? 'daily sampled time-lapse; not continuous video or deterministic replay' : 'savegames and minimaps, not a video/replay system',
        'one company; multi-agent ownership not implemented']};
    await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2));
    console.log(`PASS: ${join(out, 'result.json')}`);
  } catch (error) {
    await writeFile(join(out, 'result.json'), JSON.stringify({status: 'failed', error: String(error)}, null, 2));
    throw error;
  } finally {
    client.close();
    child.stdin.end('quit\n');
    if (!closed) await Promise.race([stopped, delay(2000)]);
    if (!closed) child.kill('SIGTERM');
    if (!closed) await Promise.race([stopped, delay(2000)]);
    if (!closed) { child.kill('SIGKILL'); await stopped; }
    clearTimeout(watchdog);
    process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);
    await writeFile(join(out, 'server.log'), logs);
    await writeFile(join(out, 'events.json'), JSON.stringify(events, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
