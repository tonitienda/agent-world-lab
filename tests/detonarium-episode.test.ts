import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadEpisode, parseEpisodeYaml } from "../src/detonarium/episode.js";

const real = resolve(import.meta.dirname, "../episodes/episode-004/episode.yaml");
const source = readFileSync(real, "utf8");

function withEpisode(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "detonarium-episode-"));
  writeFileSync(join(dir, "goal.md"), "play");
  writeFileSync(join(dir, "episode.yaml"), text);
  return join(dir, "episode.yaml");
}

test("the episode 004 file loads with its settings and prompt path", () => {
  const e = loadEpisode(real);
  assert.equal(e.episode.id, "episode-004");
  assert.deepEqual(e.environment.bots, ["hunter", "hunter", "hunter"]);
  assert.equal(e.environment.seed, 1);
  assert.equal(e.games, 3);
  assert.equal(e.promptPath, resolve(import.meta.dirname, "../episodes/episode-004/goal.md"));
});

test("the reader handles comments, quotes and inline lists", () => {
  assert.deepEqual(parseEpisodeYaml("# top\na: 1   # note\nb:\n  c: \"x # y\"\n  d: [p, 'q']\n"), { a: 1, b: { c: "x # y", d: ["p", "q"] } });
});

for (const [name, from, to, message] of [
  ["unknown key", "games: 3", "games: 3\nsurprise: true", /unknown key surprise/],
  ["unknown nested", "  seed: 1 ", "  seed: 1\n  secret: 2 ", /unknown key environment.secret/],
  ["missing", "games: 3", "", /missing games/],
  ["provider", "provider: detonarium", "provider: minecraft", /provider must be detonarium/],
  ["bot kind", "bots: [hunter, hunter, hunter]", "bots: [hunter, sniper]", /unknown bot kind sniper/],
  ["too many bots", "bots: [hunter, hunter, hunter]", "bots: [hunter, hunter, hunter, hunter]", /1 to 3 bots/],
  ["escape prompt", "prompt_file: goal.md", "prompt_file: ../goal.md", /inside the episode folder/],
  ["duplicate", "games: 3", "games: 3\ngames: 4", /duplicate key games/],
  ["bad number", "games: 3", "games: three", /games must be an integer/],
  ["indentation", "  id: episode-004", "    id: episode-004", /unexpected indentation/],
] as const) {
  test(`rejects: ${name}`, () => {
    assert.ok(source.includes(from), `fixture text not found: ${from}`);
    assert.throws(() => loadEpisode(withEpisode(source.replace(from, to))), message);
  });
}
