// Episode file for Detonarium games (episodes/episode-NNN/episode.yaml), read by
// scripts/detonarium-session.ts. The Go CLI does not know this provider yet, so this file
// has its own small, strict reader: two levels of `key: value`, integers, strings and
// inline lists. Unknown or missing keys are errors, as in internal/config.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BotKind } from "../../packages/detonarium/src/index.js";

export type DetonariumEpisode = {
  version: 1;
  episode: { id: string; title: string };
  environment: { provider: "detonarium"; seed: number; bots: BotKind[]; alert_radius: number; max_macro_ticks: number };
  goal: { prompt_file: string };
  player: { harness: "claude"; model: string };
  games: number;
  /** Absolute path of the goal prompt, resolved next to the episode file. */
  promptPath: string;
};

type Scalar = string | number | string[];
type Doc = Record<string, Scalar | Record<string, Scalar>>;

function scalar(raw: string, where: string): Scalar {
  const v = raw.trim();
  if (v.startsWith("[")) {
    if (!v.endsWith("]")) throw new Error(`${where}: unterminated list`);
    const inner = v.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((item) => String(scalar(item, where)));
  }
  if (/^-?\d+$/.test(v)) return Number(v);
  const quoted = v.match(/^"(.*)"$/) ?? v.match(/^'(.*)'$/);
  if (quoted) return quoted[1];
  if (v === "") throw new Error(`${where}: missing value`);
  return v;
}

/** Drop a `#` comment that starts the line or follows whitespace, unless it is inside quotes. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/** Parse the restricted YAML subset. Exported for tests. */
export function parseEpisodeYaml(text: string): Doc {
  const doc: Doc = {};
  let section: Record<string, Scalar> | null = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const where = `line ${i + 1}`;
    const content = stripComment(line);
    if (content.trim() === "") return;
    if (/\t/.test(content)) throw new Error(`${where}: tabs are not allowed`);
    const indent = content.length - content.trimStart().length;
    const m = content.trim().match(/^([a-z_][a-z0-9_]*):(?:\s+(.*))?$/);
    if (!m) throw new Error(`${where}: expected "key: value"`);
    const [, key, value] = m;
    const target = indent === 0 ? doc : indent === 2 && section ? section : null;
    if (!target) throw new Error(`${where}: unexpected indentation`);
    if (key in target) throw new Error(`${where}: duplicate key ${key}`);
    if (indent === 0 && value === undefined) {
      section = {};
      doc[key] = section;
    } else {
      if (indent === 0) section = null;
      target[key] = scalar(value ?? "", where);
    }
  });
  return doc;
}

const BOT_KINDS = ["passive", "wanderer", "hunter"];

export function loadEpisode(path: string): DetonariumEpisode {
  const file = resolve(path);
  const doc = parseEpisodeYaml(readFileSync(file, "utf8"));
  const fail = (message: string): never => { throw new Error(`${file}: ${message}`); };
  const shape: Record<string, string[] | null> = {
    version: null, games: null,
    episode: ["id", "title"],
    environment: ["provider", "seed", "bots", "alert_radius", "max_macro_ticks"],
    goal: ["prompt_file"],
    player: ["harness", "model"],
  };
  for (const key of Object.keys(doc)) if (!(key in shape)) fail(`unknown key ${key}`);
  for (const [key, fields] of Object.entries(shape)) {
    if (!(key in doc)) fail(`missing ${key}`);
    if (fields === null) continue;
    const section = doc[key];
    if (typeof section !== "object" || Array.isArray(section)) fail(`${key} must be a section`);
    for (const field of Object.keys(section as object)) if (!fields.includes(field)) fail(`unknown key ${key}.${field}`);
    for (const field of fields) if (!(field in (section as object))) fail(`missing ${key}.${field}`);
  }
  const s = doc as Record<string, Record<string, Scalar>> & { version: Scalar; games: Scalar };
  const int = (v: Scalar, name: string, min: number) => (typeof v === "number" && v >= min ? v : fail(`${name} must be an integer >= ${min}`));
  const str = (v: Scalar, name: string) => (typeof v === "string" && v !== "" ? v : fail(`${name} must be a string`));
  if (s.version !== 1) fail("version must be 1");
  if (s.environment.provider !== "detonarium") fail(`environment.provider must be detonarium, not ${String(s.environment.provider)}`);
  if (s.player.harness !== "claude") fail("player.harness must be claude");
  const bots = s.environment.bots;
  if (!Array.isArray(bots) || bots.length < 1 || bots.length > 3) fail("environment.bots must list 1 to 3 bots");
  for (const bot of bots as string[]) if (!BOT_KINDS.includes(bot)) fail(`unknown bot kind ${bot} (use ${BOT_KINDS.join(", ")})`);
  const promptFile = str(s.goal.prompt_file, "goal.prompt_file");
  if (promptFile.includes("..") || promptFile.startsWith("/")) fail("goal.prompt_file must stay inside the episode folder");
  return {
    version: 1,
    episode: { id: str(s.episode.id, "episode.id"), title: str(s.episode.title, "episode.title") },
    environment: {
      provider: "detonarium",
      seed: int(s.environment.seed, "environment.seed", 0),
      bots: bots as BotKind[],
      alert_radius: int(s.environment.alert_radius, "environment.alert_radius", 0),
      max_macro_ticks: int(s.environment.max_macro_ticks, "environment.max_macro_ticks", 1),
    },
    goal: { prompt_file: promptFile },
    player: { harness: "claude", model: str(s.player.model, "player.model") },
    games: int(s.games, "games", 1),
    promptPath: resolve(dirname(file), promptFile),
  };
}
