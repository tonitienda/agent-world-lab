import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir, writeFile, cp, readFile, stat} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {randomBytes, createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve, join, dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {AdminClient, type Reply} from './admin.js';
import type {Recording, Capture, Position, Observation, Station} from './camera.js';

export async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = (server.address() as {port: number}).port;
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  return port;
}

export class OpenTTDRuntime {
  readonly recording: Recording = {version: 1, sampleEconomyDays: 1, northHeight: 1, southHeight: 1, captures: []};
  private child?: ChildProcessWithoutNullStreams;
  private client?: AdminClient;
  private closed = false;
  private logs = '';
  private requests: unknown[] = [];
  private closing?: Promise<void>;
  constructor(readonly root: string, readonly folder: string, readonly options: {
    mapSize?: 64 | 128; seed?: number; initialCash?: number; river?: boolean; title?: string; goalFile?: string;
  } = {}) {}

  async start(): Promise<Observation> {
    const binary = join(this.root, 'data/openttd-runtime/OpenTTD.app/Contents/MacOS/openttd');
    const assets = resolve(dirname(binary), '../Resources');
    const home = join(this.folder, 'world');
    await mkdir(home, {recursive: true});
    for (const directory of ['lang', 'baseset', 'game', 'ai'])
      await cp(join(assets, directory), join(home, directory), {recursive: true});
    for (const directory of ['game', 'ai'])
      await cp(join(this.root, 'packages/openttd', directory), join(home, directory), {recursive: true});
    await cp(join(this.root, 'data/openttd-runtime/opengfx-8.0.tar'), join(home, 'baseset/opengfx.tar'));
    const size = this.options.mapSize ?? 64;
    const seed = this.options.seed ?? 7;
    const initialCash = this.options.initialCash ?? 20000;
    const bmp = Buffer.alloc(54 + size * size * 3, 128);
    bmp.fill(0, 0, 54); bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(size, 18); bmp.writeInt32LE(size, 22);
    bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(size * size * 3, 34);
    if (this.options.river) for (let y = 0; y < size; y++) for (let x = size / 2 - 2; x <= size / 2 + 1; x++)
      bmp.fill(0, 54 + (y * size + x) * 3, 54 + (y * size + x) * 3 + 3);
    await writeFile(join(home, 'flat.bmp'), bmp);
    const adminPort = await availablePort();
    let gamePort = await availablePort();
    while (gamePort === adminPort) gamePort = await availablePort();
    const password = randomBytes(24).toString('hex');
    const config = `[network]
server_admin_port = ${adminPort}
server_port = ${gamePort}
allow_insecure_admin_login = true
server_game_type = local
min_active_clients = 0
pause_on_join = false
admin_password = ${password}
server_name = The Agent Terrarium
client_name = Terrarium Observer
[misc]
transparency_options = 4
[server_bind_addresses]
127.0.0.1 =
[game_creation]
map_x = ${Math.log2(size)}
map_y = ${Math.log2(size)}
heightmap_height = 2
starting_year = 1950
custom_town_number = 2
generation_seed = ${seed}
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
    const cfg = join(home, 'openttd.cfg');
    await writeFile(cfg, config, {mode: 0o600});
    const hashes: Record<string, string> = {};
    for (const file of ['packages/openttd/game/terrarium/main.nut', 'packages/openttd/game/terrarium/info.nut',
      'packages/openttd/src/runtime.ts', 'packages/openttd/src/session.ts', this.options.goalFile ?? 'episodes/episode-007/goal.md'])
      hashes[file] = createHash('sha256').update(await readFile(join(this.root, file))).digest('hex');
    await writeFile(join(this.folder, 'world-manifest.json'), JSON.stringify({engine: 'OpenTTD 15.3', seed, options: this.options,
      gamePort, config: config.replace(password, '<redacted>'), hashes, startedAt: new Date().toISOString()}, null, 2));
    this.child = spawn(binary, ['-D', `127.0.0.1:${gamePort}`, '-c', cfg, '-X', '-x', '-g', join(home, 'flat.bmp'),
      '-G', String(seed), '-s', 'null', '-m', 'null', '-b', '8bpp-optimized', '-d', 'script=3'], {cwd: home, stdio: 'pipe'});
    let error: Error | undefined;
    this.child.on('error', e => { error = e; });
    this.child.on('close', () => { this.closed = true; });
    const log = (bytes: Buffer) => { this.logs += bytes.toString(); appendFileSync(join(this.folder, 'server.log'), bytes); };
    this.child.stdout.on('data', log); this.child.stderr.on('data', log);
    for (let i = 0; i < 200 && !this.logs.includes('Map generated, starting game'); i++) {
      if (error || this.closed) throw error ?? new Error('OpenTTD exited during startup');
      await delay(100);
    }
    this.client = new AdminClient(adminPort, password);
    await this.client.connect();
    await this.client.rcon('start_ai "Terrarium Idle"');
    const state = await this.request('bootstrap', {loan: initialCash});
    if (!state.ok || state.data.balance !== initialCash || state.data.loan !== initialCash) throw new Error('Initial budget fixture failed');
    const geometry = await this.request('geometry');
    this.recording.northHeight = geometry.data.north_height;
    this.recording.southHeight = geometry.data.south_height;
    await this.capture('overview', this.options.title ?? 'Claude Transit — a commuter service from scratch');
    await this.save('initial');
    return state.data;
  }

  async request(op: string, args: Record<string, unknown> = {}): Promise<Reply> {
    if (!this.client) throw new Error('OpenTTD not connected');
    const reply = await this.client.request(op, args, op === 'advance' ? 100_000 : 30_000);
    this.requests.push({at: new Date().toISOString(), op, args, reply});
    await writeFile(join(this.folder, 'engine-events.json.tmp'), JSON.stringify(this.requests, null, 2));
    const {rename} = await import('node:fs/promises');
    await rename(join(this.folder, 'engine-events.json.tmp'), join(this.folder, 'engine-events.json'));
    return reply;
  }

  async observe(): Promise<Observation & {loan: number; paused: boolean; towns: any[]}> {
    const reply = await this.request('observe');
    if (!reply.ok) throw new Error(JSON.stringify(reply.data));
    return reply.data;
  }
  async stations(): Promise<Station[]> {
    const reply = await this.request('stations');
    if (!reply.ok) throw new Error(JSON.stringify(reply.data));
    return reply.data;
  }
  async capture(kind: Capture['kind'], label?: string, focus?: Position, eventId?: number, phase?: 'before' | 'after'): Promise<number> {
    const snapshot = await this.observe();
    const stations = await this.stations();
    const id = this.recording.captures.length;
    const name = `source-${String(id).padStart(5, '0')}`;
    const image = `world/screenshot/${name}.png`;
    await this.client!.rcon(`screenshot giant ${name}`);
    await this.waitArtifact(image, true);
    const capture: Capture & {eventId?: number; phase?: 'before' | 'after'} = {image, snapshot, stations, kind, label, focus, eventId, phase};
    this.recording.captures.push(capture);
    await writeFile(join(this.folder, 'captures.json'), JSON.stringify(this.recording, null, 2));
    return id;
  }
  async save(name: string) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid save name');
    await this.client!.rcon(`save "${join(this.folder, name)}"`);
    await this.waitArtifact(`${name}.sav`);
  }
  private async waitArtifact(relative: string, png = false) {
    for (let i = 0; i < 100; i++) {
      try {
        const bytes = await readFile(join(this.folder, relative));
        if (bytes.length > 12 && (!png || bytes.subarray(-8, -4).toString() === 'IEND')) return;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (this.closed) throw new Error('OpenTTD exited during capture');
      await delay(100);
    }
    throw new Error(`Timed out capturing ${relative}`);
  }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.client?.close();
      if (!this.child || this.closed) return;
      this.child.stdin.on('error', () => {});
      this.child.stdin.end('quit\n');
      for (let i = 0; i < 30 && !this.closed; i++) await delay(100);
      if (!this.closed) this.child.kill('SIGTERM');
      for (let i = 0; i < 20 && !this.closed; i++) await delay(100);
      if (!this.closed) this.child.kill('SIGKILL');
    })();
  }
}
