import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { characterBrief, characterLabel, loadRoster, lookupCharacter } from "../src/characters.js";
import { loadEpisode } from "../src/detonarium/episode.js";

const require = createRequire(import.meta.url);
const { loadCast, addCast, installCast, ENTITY, SELF } = require("../packages/minecraft-recorder/cast.cjs");
const { addObserverFollow } = require("../packages/minecraft-recorder/observer-follow.cjs");
const { addFollowCamera } = require("../packages/minecraft-recorder/follow-camera.cjs");
const root = resolve(import.meta.dirname, "..");

test("roster has two Claude and two Codex characters with committed skins", () => {
  const roster = loadRoster();
  assert.equal(roster.filter((c) => c.family === "claude").length, 2);
  assert.equal(roster.filter((c) => c.family === "codex").length, 2);
  for (const c of roster) assert.ok(existsSync(join(root, "characters/skins", `${c.id}.png`)), c.id);
  const bram = lookupCharacter("bram");
  assert.equal(characterLabel(bram), "Bram · Codex");
  assert.match(characterBrief(bram), /^## Your character\n\nOn screen you are Bram/);
  assert.throws(() => lookupCharacter("nobody"), /unknown character nobody/);
});

test("recorder cast loads each skin as a data URL keyed by lower-case username", () => {
  const cast = loadCast(JSON.stringify({ Ada: { name: "Ada", family: "Claude", label: "Ada · Claude", accent: "#d97757", skin: join(root, "characters/skins/ada.png") } }));
  assert.equal(cast.ada.label, "Ada · Claude");
  assert.match(cast.ada.skin, /^data:image\/png;base64,iVBOR/);
  assert.equal(loadCast(undefined), null);
  assert.throws(() => loadCast({ x: { accent: "orange", skin: "x" } }), /accent/);
});

test("cast patch hooks both player meshes and fails loudly on an unknown bundle", () => {
  const patched = addCast(`/*a*/${ENTITY}/*b*/${SELF}/*c*/`);
  assert.match(patched, /window\.__emergentDress\?\.\(i\.mesh,t\.username,t\.height\)\)return i\.mesh/);
  assert.match(patched, /window\.__emergentDress\?\.\(e,window\.__emergentSelf,1\.8\)/);
  assert.throws(() => addCast("minified code"), /character skins/);
});

test("dress swaps the skin and adds a nametag only for cast members", () => {
  class Texture { magFilter = 0; minFilter = 0; flipY = true; constructor(public src = "") {} }
  const added: unknown[] = [];
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).THREE = {
    NearestFilter: 1, TextureLoader: class { load(src: string) { return new Texture(src); } },
    CanvasTexture: Texture, SpriteMaterial: class { constructor(public o: unknown) {} },
    Sprite: class { renderOrder = 0; position = { y: 0 }; scale = { set() {} }; },
  };
  (globalThis as Record<string, unknown>).document = { createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 100 }), beginPath() {}, roundRect() {}, fill() {}, fillRect() {}, fillText() {} }) }) };
  installCast({ ada: { name: "Ada", family: "Claude", label: "Ada · Claude", accent: "#d97757", skin: "data:ada" } }, "ada");
  const skinned = { isSkinnedMesh: true, material: { map: new Texture("steve"), needsUpdate: false } };
  const mesh = { traverse: (fn: (c: unknown) => void) => fn(skinned), add: (c: unknown) => added.push(c) };
  const dress = (globalThis as unknown as { __emergentDress: (m: unknown, u: string, h: number) => boolean }).__emergentDress;
  assert.equal(dress(mesh, "Ada", 1.8), true);
  assert.equal((skinned.material.map as Texture).src, "data:ada");
  assert.equal(added.length, 1);
  assert.equal(dress(mesh, "stranger", 1.8), false);
});

const bundle = resolve(root, "packages/minecraft-recorder/node_modules/prismarine-viewer/public/index.js");
test("cast patch composes with both camera patches on the pinned viewer bundle", { skip: !existsSync(bundle) && "recorder not installed" }, () => {
  const source = readFileSync(bundle, "utf8");
  for (const camera of [addObserverFollow, addFollowCamera, (s: string) => s]) {
    const out = addCast(camera(source));
    assert.equal(out.split("window.__emergentDress?.(").length - 1, 2);
  }
});

function episodeWith(character: string) {
  const dir = mkdtempSync(join(tmpdir(), "detonarium-character-"));
  writeFileSync(join(dir, "goal.md"), "play");
  const yaml = readFileSync(join(root, "episodes/episode-004/episode.yaml"), "utf8").replace("  model: claude-opus-5-5\n", `  model: claude-opus-5-5\n  character: ${character}\n`);
  writeFileSync(join(dir, "episode.yaml"), yaml);
  return join(dir, "episode.yaml");
}

test("Detonarium accepts a Claude character and rejects a Codex one", () => {
  assert.equal(loadEpisode(episodeWith("ada")).player.character, "ada");
  assert.throws(() => loadEpisode(episodeWith("bram")), /codex character; Detonarium plays Claude/);
  assert.throws(() => loadEpisode(episodeWith("nobody")), /unknown character/);
  assert.equal(loadEpisode(join(root, "episodes/episode-004/episode.yaml")).player.character, undefined);
});
