import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type EngineOptions = {
  /** Native UCI binary; defaults to $STOCKFISH_PATH, else the bundled Stockfish WASM build. */
  command?: string;
  /** Caps strength via UCI_LimitStrength (Stockfish accepts 1320-3190); null plays at full strength. */
  elo: number | null;
  /** Thinking time per move. */
  movetimeMs: number;
};

/** The pinned npm build (single-threaded NNUE) so every run faces the same opponent. */
function bundledStockfish(): string[] {
  const root = dirname(createRequire(import.meta.url).resolve("stockfish/package.json"));
  return [process.execPath, join(root, "src/stockfish-17.1-single-a496a04.js")];
}

/** Minimal line-oriented UCI client: one search at a time. */
export class UciEngine {
  private readonly process: ChildProcessWithoutNullStreams;
  private buffer = "";
  private waiters: { match: (line: string) => boolean; resolve: (line: string) => void }[] = [];
  name = "unknown engine";

  private constructor(readonly options: EngineOptions) {
    const command = options.command ?? process.env.STOCKFISH_PATH;
    const [bin, ...args] = command ? [command] : bundledStockfish();
    this.process = spawn(bin, args, { stdio: "pipe" });
    this.process.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line.startsWith("id name ")) this.name = line.slice(8);
        const index = this.waiters.findIndex((w) => w.match(line));
        if (index >= 0) this.waiters.splice(index, 1)[0].resolve(line);
      }
    });
  }

  static async start(options: EngineOptions): Promise<UciEngine> {
    const engine = new UciEngine(options);
    engine.send("uci");
    await engine.waitFor((line) => line === "uciok");
    if (options.elo !== null) {
      engine.send("setoption name UCI_LimitStrength value true");
      engine.send(`setoption name UCI_Elo value ${options.elo}`);
    }
    engine.send("isready");
    await engine.waitFor((line) => line === "readyok");
    return engine;
  }

  /** Best move in UCI notation (e.g. "e7e5", "e7e8q") for the position after `moves` from `fen`. */
  async bestMove(fen: string, moves: string[] = []): Promise<string> {
    this.send(`position fen ${fen}${moves.length ? " moves " + moves.join(" ") : ""}`);
    this.send(`go movetime ${this.options.movetimeMs}`);
    const line = await this.waitFor((l) => l.startsWith("bestmove "));
    return line.split(/\s+/)[1];
  }

  quit() {
    this.send("quit");
    this.process.stdin.end();
    setTimeout(() => this.process.kill(), 500).unref();
  }

  private send(command: string) {
    this.process.stdin.write(command + "\n");
  }

  private waitFor(match: (line: string) => boolean, timeoutMs = 30_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`UCI engine timed out (${this.name})`)), timeoutMs);
      this.waiters.push({ match, resolve: (line) => (clearTimeout(timer), resolve(line)) });
    });
  }
}
