import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';

export const IMAGE = 'agent-world/freeciv:3.1.4-json';

export type ServerOptions = {
  /** Host port; bound to 127.0.0.1 only. */
  port: number;
  /** Host directory mounted as the server's save/mapimg directory. */
  outDir: string;
  name?: string;
  onLine?: (line: string) => void;
};

/**
 * Runs the headless server in Docker and drives its console over stdin.
 * The console has hack-level access: settings, `lua`, `save`, `mapimg`.
 * Agents never get this object; it belongs to the trusted runner.
 */
export class FreecivServer {
  readonly lines: string[] = [];
  private process: ChildProcessWithoutNullStreams | undefined;
  private waiters: Array<{match: (line: string) => boolean; done: (line: string) => void}> = [];
  private marker = 0;

  constructor(readonly options: ServerOptions) {}

  async start(): Promise<void> {
    const {port, outDir, name = `freeciv-spike-${port}`} = this.options;
    this.process = spawn('docker', ['run', '--rm', '-i', '--name', name,
      '-p', `127.0.0.1:${port}:5556`, '-v', `${outDir}:/home/civ/out`, '-w', '/home/civ/out',
      '--entrypoint', 'stdbuf', IMAGE, '-oL', '-eL', '/opt/freeciv/bin/freeciv-server', '--port', '5556', '--saves', '/home/civ/out'], {stdio: 'pipe'});
    for (const stream of [this.process.stdout, this.process.stderr]) {
      createInterface({input: stream}).on('line', line => this.onLine(line));
    }
    await this.waitFor(line => line.includes('For introductory help'), 60_000);
  }

  /** Runs one console command and returns the lines it printed. */
  async command(cmd: string, timeoutMs = 15_000): Promise<string[]> {
    if (cmd.includes('\n')) throw new Error('Console commands are single-line');
    const tag = `__CMD_DONE_${++this.marker}__`;
    const start = this.lines.length;
    this.write(cmd);
    this.write(`lua print("${tag}")`);
    // The console reads one line per stdin wakeup; lines that arrive in the
    // same read sit in its stdio buffer. Empty lines are ignored by the
    // console and wake it until our marker has been processed.
    const nudge = setInterval(() => this.write(''), 200);
    try { await this.waitFor(line => line.includes(tag), timeoutMs); } finally { clearInterval(nudge); }
    return this.lines.slice(start).filter(l => !l.includes(tag) && !l.includes('Fall back to old syntax') && !l.startsWith('> '));
  }

  /** Evaluates a one-line Lua chunk that prints a single JSON-ish line prefixed with `@@`. */
  async lua(chunk: string): Promise<string[]> {
    return (await this.command(`lua ${chunk}`)).filter(l => l.startsWith('@@')).map(l => l.slice(2));
  }

  waitFor(match: (line: string) => boolean, timeoutMs = 15_000): Promise<string> {
    return new Promise((done, fail) => {
      const waiter = {match, done: (line: string) => { clearTimeout(timer); done(line); }};
      const timer = setTimeout(() => { this.waiters = this.waiters.filter(w => w !== waiter); fail(new Error('Timed out waiting for server output')); }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async stop(): Promise<void> {
    if (!this.process || this.process.exitCode !== null) return;
    const exited = new Promise(done => this.process!.once('exit', done));
    this.write('quit');
    const timer = setTimeout(() => this.process?.kill('SIGTERM'), 10_000);
    await exited; clearTimeout(timer);
  }

  private write(line: string): void { this.process!.stdin.write(`${line}\n`); }

  private onLine(raw: string): void {
    const line = raw.replace(/^> /, '');
    this.lines.push(line);
    this.options.onLine?.(line);
    for (const waiter of [...this.waiters]) {
      if (waiter.match(line)) { this.waiters = this.waiters.filter(w => w !== waiter); waiter.done(line); }
    }
  }
}
