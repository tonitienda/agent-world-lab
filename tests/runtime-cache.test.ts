import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuredMinecraftVersion, restoreRuntimeCache } from "../src/environments/minecraft/runtime-cache.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "awl-runtime-cache-"));
  const source = join(root, "data/world-archives/prior-world");
  mkdirSync(join(source, "world/playerdata"), { recursive: true });
  const jar = "minecraft_server.1.21.4.jar";
  writeFileSync(join(source, jar), "completed-fixture-server");
  writeFileSync(join(source, ".vanilla-manifest.json"), JSON.stringify({
    "@type": "me.itzg.helpers.vanilla.VanillaManifest", minecraftVersion: "1.21.4",
    serverEntry: jar, files: [jar],
  }));
  writeFileSync(join(source, "server.properties"), "old-world-configuration");
  writeFileSync(join(source, "world/playerdata/old-player.dat"), "old-player");
  writeFileSync(join(source, "minecraft_server.1.21.5.jar.download"), "partial");
  return { root, source, jar, destination: join(root, "data/minecraft") };
}

test("cache restores only matching completed runtime files, independently of prior world state", () => {
  const f = fixture();
  try {
    assert.ok(restoreRuntimeCache(f.root, f.destination, "1.21.4", f.source));
    assert.deepEqual(readdirSync(f.destination).sort(), [".vanilla-manifest.json", f.jar].sort());
    assert.equal(readFileSync(join(f.source, "world/playerdata/old-player.dat"), "utf8"), "old-player");
    // A new runtime can be restored even when no archive remains available.
    rmSync(join(f.root, "data/world-archives"), { recursive: true });
    writeFileSync(join(f.destination, f.jar), "live-container-change");
    const fresh = join(f.root, "second-reset");
    assert.ok(restoreRuntimeCache(f.root, fresh, "1.21.4"));
    assert.equal(readFileSync(join(fresh, f.jar), "utf8"), "completed-fixture-server");
    assert.equal(restoreRuntimeCache(f.root, join(f.root, "other-version"), "1.21.5"), false);
    assert.equal(restoreRuntimeCache(f.root, join(f.root, "dynamic-version"), "LATEST"), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("corrupted cache is recovered from an archive, or treated as a cache miss", () => {
  const f = fixture();
  try {
    assert.ok(restoreRuntimeCache(f.root, f.destination, "1.21.4"));
    const cachedJar = join(f.root, "data/minecraft-runtime-cache/1.21.4", f.jar);
    writeFileSync(cachedJar, "corrupted");
    assert.ok(restoreRuntimeCache(f.root, join(f.root, "recovered"), "1.21.4"));
    assert.equal(readFileSync(cachedJar, "utf8"), "completed-fixture-server");
    writeFileSync(cachedJar, "corrupted-again");
    rmSync(join(f.root, "data/world-archives"), { recursive: true });
    assert.equal(restoreRuntimeCache(f.root, join(f.root, "missing"), "1.21.4"), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("partial files, mismatched receipts and symlinked distributions are not reused", () => {
  const f = fixture();
  try {
    rmSync(join(f.source, f.jar));
    assert.equal(restoreRuntimeCache(f.root, f.destination, "1.21.4"), false);
    writeFileSync(join(f.root, "outside.jar"), "outside");
    symlinkSync(join(f.root, "outside.jar"), join(f.source, f.jar));
    assert.equal(restoreRuntimeCache(f.root, f.destination, "1.21.4"), false);
    rmSync(join(f.source, f.jar));
    writeFileSync(join(f.source, f.jar), "complete");
    writeFileSync(join(f.source, ".vanilla-manifest.json"), JSON.stringify({minecraftVersion: "1.21.5", serverEntry: f.jar, files: [f.jar]}));
    assert.equal(restoreRuntimeCache(f.root, f.destination, "1.21.4"), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("cache version follows explicit environment then pinned .env, and bypasses unresolved/dynamic versions", () => {
  const root = mkdtempSync(join(tmpdir(), "awl-runtime-version-"));
  try {
    assert.equal(configuredMinecraftVersion(root, {}), "1.21.4");
    writeFileSync(join(root, ".env"), 'MC_VERSION="1.21.5" # pinned\n');
    assert.equal(configuredMinecraftVersion(root, {}), "1.21.5");
    assert.equal(configuredMinecraftVersion(root, { MC_VERSION: "1.21.4" }), "1.21.4");
    assert.equal(configuredMinecraftVersion(root, { MC_VERSION: "LATEST" }), undefined);
    writeFileSync(join(root, ".env"), 'MC_VERSION=${OTHER_VERSION}\n');
    assert.equal(configuredMinecraftVersion(root, {}), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
