import {spawn, execFile, type ChildProcess} from 'node:child_process';
import {createServer, type Server, type Socket} from 'node:net';
import {createInterface} from 'node:readline';
import {mkdir, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
export const IMAGE = 'agent-world/hedgewars:spike';
const LUA_DIR = fileURLToPath(new URL('../lua/', import.meta.url));

export type TeamSpec = {name: string; color: number; hogs: string[]};
export type EngineOptions = {
  port: number;
  /** Host directory for screenshots and engine logs. */
  outDir: string;
  seed: string;
  teams: TeamSpec[];
  /** Ammo scheme: four digit strings (quantity, probability, delay, crate), one digit per weapon. */
  ammo?: {count: number};
  turnTimeMs?: number;
  /** Starting health of every hedgehog (default 100). */
  health?: number;
  /** Map shape: 1 small, 2 medium, 3 large islands, 4 cavern, 5 wacky. Default 2 (open sky, good for arcing shots). */
  mapKind?: 1 | 2 | 3 | 4 | 5;
  /** Use the bridge's hand-drawn open island (gentle hills, no overhangs) instead of a random map. Default true. */
  openIsland?: boolean;
  /** Play game sound into a virtual sink so recordings carry it. Default false (silent engine). */
  sound?: boolean;
  width?: number;
  height?: number;
};

/** What the current hedgehog should do. Angle: 0 = up, 1024 = horizontal. Power: 1..1500. */
export type Command =
  | {kind: 'shoot'; facing: 'left' | 'right'; angle: number; power: number; weapon?: 'bazooka' | 'grenade'; timer?: number}
  | {kind: 'walk'; facing: 'left' | 'right'; ms: number}
  | {kind: 'jump'; facing: 'left' | 'right'; high: boolean}
  | {kind: 'skip'};

/** One `@@kind k=v ...` line printed by lua/AgentBridge.lua. */
export type Fact = {kind: string; [key: string]: string};

export function parseFact(line: string): Fact | undefined {
  const at = line.indexOf('@@');
  if (at < 0) return undefined;
  const [kind = '', ...rest] = line.slice(at + 2).trim().split(' ');
  const fact: Fact = {kind};
  rest.forEach((pair, i) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return;
    const key = pair.slice(0, eq);
    // `name` is always last and may contain spaces.
    fact[key] = key === 'name' ? rest.slice(i).join(' ').slice(5) : pair.slice(eq + 1);
  });
  return fact;
}

/**
 * Plays the role of the Hedgewars frontend. The engine (in Docker) connects
 * back to us over TCP and we send the match setup. After that the game runs
 * as a local hot-seat match: lua/AgentBridge.lua reports state on the console
 * and carries out the commands we drop into a small file it polls.
 */
export class HedgewarsEngine extends EventEmitter {
  readonly facts: Fact[] = [];
  readonly stderr: string[] = [];
  readonly ipcIn: string[] = [];
  private seq = 0;
  private setupSent = false;
  private server: Server | undefined;
  private socket: Socket | undefined;
  private process: ChildProcess | undefined;
  private pending = Buffer.alloc(0);
  private container: string;
  private ctl = '';

  constructor(readonly options: EngineOptions) {
    super();
    this.container = `hedgewars-spike-${options.port}`;
  }

  async start(): Promise<void> {
    const {port, outDir, width = 1280, height = 720, sound = false} = this.options;
    this.ctl = join(outDir, 'ctl');
    await mkdir(this.ctl, {recursive: true});
    const connected = new Promise<Socket>((done, fail) => {
      this.server = createServer(socket => done(socket)).once('error', fail).listen(port, '0.0.0.0');
    });
    const inner = [
      `Xvfb :99 -screen 0 ${width}x${height}x24 -nolisten tcp >/dev/null 2>&1 &`,
      `socat TCP-LISTEN:${port},reuseaddr TCP:host.docker.internal:${port} &`,
      ...(sound ? [
        'pulseaudio -n --daemonize=yes --exit-idle-time=-1 --log-target=stderr'
          + ' --load="module-native-protocol-unix socket=/tmp/pulse.sock auth-anonymous=1" --load="module-null-sink sink_name=game"',
        'sleep 1', 'pactl set-default-sink game',
      ] : []),
      'sleep 1',
      `DISPLAY=:99 ${sound ? '' : 'SDL_AUDIODRIVER=dummy '}exec /usr/lib/hedgewars/bin/hwengine --internal --port ${port}`
        + ' --prefix /usr/share/games/hedgewars/Data --user-prefix /home/hog/hw'
        + ` --nomusic ${sound ? '' : '--nosound '}--width ${width} --height ${height} --frame-interval 33`,
    ].join('\n');
    this.process = spawn('docker', ['run', '--rm', '-t', '--name', this.container,
      '--add-host', 'host.docker.internal:host-gateway',
      '-v', `${LUA_DIR}:/home/hog/hw/Data/Scripts/Multiplayer:ro`, '-v', `${outDir}:/out`,
      '-v', `${this.ctl}:/home/hog/hw/Data/Scripts/AgentCtl:ro`,
      IMAGE, 'sh', '-c', inner], {stdio: ['ignore', 'pipe', 'pipe']});
    for (const stream of [this.process.stdout!, this.process.stderr!]) {
      createInterface({input: stream}).on('line', line => this.onLine(line));
    }
    this.process.once('exit', code => this.emit('exit', code));
    this.socket = await withTimeout(connected, 60_000, 'engine never connected');
    this.socket.on('data', chunk => this.onData(chunk));
    await this.waitIpc(m => m[0] === 'C', 30_000);
    this.sendSetup();
  }

  private onLine(line: string): void {
    line = line.replace(/\r$/, '');
    this.stderr.push(line);
    if (/^\d+: /.test(line)) return; // the debug log echoes every console line, prefixed with the tick
    const fact = parseFact(line);
    if (!fact) return;
    this.facts.push(fact);
    this.emit('fact', fact);
  }

  private onData(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length > 0 && this.pending.length > this.pending[0]!) {
      const len = this.pending[0]!;
      const msg = this.pending.subarray(1, 1 + len).toString('latin1');
      this.pending = this.pending.subarray(1 + len);
      this.ipcIn.push(msg);
      if (msg[0] === '?' && this.setupSent) this.raw('!');
      this.emit('ipc', msg);
    }
  }

  /** Length-prefixed frame; the engine caps messages at 255 bytes. */
  private raw(msg: string | Buffer): void {
    const body = typeof msg === 'string' ? Buffer.from(msg, 'latin1') : msg;
    if (body.length > 254) throw new Error(`IPC message too long: ${body.length}`);
    this.socket!.write(Buffer.concat([Buffer.from([body.length]), body]));
  }

  private sendSetup(): void {
    const {seed, teams, turnTimeMs = 45_000, ammo = {count: 59}, mapKind = 2, health = 100, openIsland = true} = this.options;
    const digits = (d: string) => d.repeat(ammo.count);
    const setup = ['TL', 'escript Scripts/Multiplayer/AgentBridge.lua', 'etheme Nature', `eseed ${seed}`,
      'e$gmflags 0', 'e$damagepct 100', `e$turntime ${turnTimeMs}`, 'e$sd_turns 15', 'e$casefreq 0',
      'e$minestime 3000', 'e$minesnum 0', 'e$explosives 0', `e$template_filter ${mapKind}`, 'e$feature_size 12', `e$mapgen ${openIsland ? 3 : 0}`];
    for (const team of teams) {
      setup.push(`eammloadt ${digits('9')}`, `eammprob ${digits('0')}`, `eammdelay ${digits('0')}`,
        `eammreinf ${digits('1')}`, 'eammstore',
        `eaddteam ${team.name.toLowerCase()}hash ${team.color} ${team.name}`,
        'egrave Statue', 'efort Plane', 'evoicepack Default', 'eflag hedgewars');
      for (const hog of team.hogs) setup.push(`eaddhh 0 ${health} ${hog}`, 'ehat NoHat');
    }
    for (const msg of setup) this.raw(msg);
    this.setupSent = true;
    this.raw('!');
  }

  /** Hands the current hedgehog its next action. Written atomically; the Lua bridge picks it up within 20 ticks. */
  async command(cmd: Command): Promise<Fact> {
    const seq = ++this.seq;
    const mark = this.facts.length;
    const fields = Object.entries({seq, ...cmd}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} = ${typeof v === 'number' ? Math.round(v) : typeof v === 'boolean' ? String(v) : JSON.stringify(v)}`);
    await writeFile(join(this.ctl, 'cmd.tmp'), `AgentCommand = {${fields.join(', ')}}\n`);
    await rename(join(this.ctl, 'cmd.tmp'), join(this.ctl, `cmd-${seq}.lua`));
    return this.waitFact(f => (f.kind === 'ack' || f.kind === 'reject') && Number(f.seq) === seq, 10_000, mark);
  }

  /** Resolves with the first matching fact at or after index `since` (default: only facts still to come). */
  waitFact(match: (fact: Fact) => boolean, timeoutMs = 15_000, since = this.facts.length): Promise<Fact> {
    const seen = this.facts.slice(since).find(match);
    if (seen) return Promise.resolve(seen);
    return withTimeout(new Promise<Fact>(done => {
      const listener = (fact: Fact) => { if (match(fact)) { this.off('fact', listener); done(fact); } };
      this.on('fact', listener);
    }), timeoutMs, 'timed out waiting for engine fact');
  }

  private waitIpc(match: (msg: string) => boolean, timeoutMs: number): Promise<string> {
    const seen = this.ipcIn.find(match);
    if (seen) return Promise.resolve(seen);
    return withTimeout(new Promise<string>(done => {
      const listener = (msg: string) => { if (match(msg)) { this.off('ipc', listener); done(msg); } };
      this.on('ipc', listener);
    }), timeoutMs, 'timed out waiting for engine IPC message');
  }

  last(kind: string, where: (fact: Fact) => boolean = () => true): Fact | undefined {
    return this.facts.filter(f => f.kind === kind && where(f)).at(-1);
  }

  /** Grabs the virtual display to `<outDir>/<name>.png`. */
  async screenshot(name: string): Promise<void> {
    await run('docker', ['exec', this.container, 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'x11grab',
      '-video_size', `${this.options.width ?? 1280}x${this.options.height ?? 720}`, '-i', ':99',
      '-frames:v', '1', `/out/${name}.png`]);
  }

  private recorder: ChildProcess | undefined;

  /** Records the virtual display to `<outDir>/<name>.mkv` until `stopRecording` (or `stop`) is called. */
  startRecording(name = 'match', fps = 30): void {
    if (this.recorder) return;
    // Matroska stays playable even if the recorder is cut off mid-file.
    // With sound on, picture and game audio go through one ffmpeg so they share a clock.
    const audio = this.options.sound ? ['-thread_queue_size', '1024', '-f', 'pulse', '-i', 'game.monitor'] : [];
    this.recorder = spawn('docker', ['exec', '-i', this.container, 'ffmpeg', '-loglevel', 'error', '-y',
      '-thread_queue_size', '1024', '-f', 'x11grab', '-framerate', String(fps),
      '-video_size', `${this.options.width ?? 1280}x${this.options.height ?? 720}`, '-i', ':99', ...audio,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '17', '-pix_fmt', 'yuv420p',
      ...(audio.length ? ['-c:a', 'aac', '-b:a', '160k'] : []), `/out/${name}.mkv`], {stdio: ['pipe', 'ignore', 'pipe']});
    this.recorder.stderr!.on('data', chunk => this.stderr.push(`[recorder] ${String(chunk).trim()}`));
  }

  /** Asks ffmpeg to finish the file cleanly and waits for it. */
  async stopRecording(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = undefined;
    if (recorder.exitCode !== null) return;
    const closed = new Promise<void>(done => recorder.once('close', () => done()));
    recorder.stdin!.end('q');
    await Promise.race([closed, new Promise(done => setTimeout(done, 15_000))]);
  }

  async stop(): Promise<void> {
    await this.stopRecording();
    this.socket?.destroy();
    this.server?.close();
    await run('docker', ['rm', '-f', this.container]).catch(() => undefined);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([promise, new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}
