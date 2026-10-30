import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Cache only the pinned vanilla distribution and its installer receipt. Never
// reuse world data, player state, server.properties, operator lists or scripts.
const receipt = ".vanilla-manifest.json";
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const regular = (path: string) => {
  try { return lstatSync(path).isFile(); } catch { return false; }
};

export function configuredMinecraftVersion(root: string, env = process.env): string | undefined {
  // Compose reads .env itself; the legacy reset process does not. Honor the same
  // simple pinned version when MC_VERSION has not been explicitly forwarded.
  let version = env.MC_VERSION;
  if (version === undefined) {
    let text = "";
    try { text = readFileSync(join(root, ".env"), "utf8"); } catch {}
    version = text.match(/^\s*MC_VERSION\s*=\s*(.*?)\s*$/m)?.[1] ?? "1.21.4";
    version = version.replace(/\s+#.*$/, "").replace(/^(["'])(.*)\1$/, "$2");
  }
  // Dynamic versions need normal resolution/downloads; never map them to a
  // previously installed version. Unknown .env expressions also bypass cache.
  return /^(?:\d+\.\d+(?:\.\d+)?(?:-(?:pre|rc)\d+)?|\d{2}w\d{2}[a-z])$/.test(version)
    ? version : undefined;
}

function distribution(dir: string, version: string): { jar: string; data: Buffer; manifest: Buffer } | undefined {
  const jar = `minecraft_server.${version}.jar`;
  if (!regular(join(dir, receipt)) || !regular(join(dir, jar))) return;
  try {
    const manifest = readFileSync(join(dir, receipt));
    const m = JSON.parse(manifest.toString());
    if (m["@type"] !== "me.itzg.helpers.vanilla.VanillaManifest" ||
        m.minecraftVersion !== version || m.serverEntry !== jar ||
        !Array.isArray(m.files) || m.files.length !== 1 || m.files[0] !== jar) return;
    const data = readFileSync(join(dir, jar));
    if (!data.length) return;
    return { jar, data, manifest };
  } catch { return; }
}

function cached(dir: string, version: string) {
  const files = distribution(dir, version);
  if (!files || !regular(join(dir, "checksums.json"))) return;
  try {
    const hashes = JSON.parse(readFileSync(join(dir, "checksums.json"), "utf8"));
    if (hashes.jar === digest(files.data) && hashes.manifest === digest(files.manifest)) return files;
  } catch {}
}

/** Called under the reset lock, after archiving and before starting the server. */
export function restoreRuntimeCache(root: string, destination: string, version: string | undefined, previous?: string): boolean {
  if (!version || !/^[a-zA-Z0-9.-]+$/.test(version)) return false;
  const base = join(root, "data/minecraft-runtime-cache");
  const entry = join(base, version);
  let files = cached(entry, version);
  if (!files) {
    const archives = join(root, "data/world-archives");
    const sources = previous ? [previous] : [];
    if (existsSync(archives)) {
      sources.push(...readdirSync(archives).sort().reverse()
        .map(name => join(archives, name))
        .filter(path => lstatSync(path).isDirectory()));
    }
    for (const source of sources) {
      files = distribution(source, version);
      if (files) break;
    }
    if (!files) return false;
    mkdirSync(base, { recursive: true });
    const staging = mkdtempSync(join(base, ".runtime-"));
    try {
      writeFileSync(join(staging, files.jar), files.data);
      writeFileSync(join(staging, receipt), files.manifest);
      writeFileSync(join(staging, "checksums.json"), JSON.stringify({ jar: digest(files.data), manifest: digest(files.manifest) }));
      // Only generated cache entries are replaceable. Archives stay untouched.
      rmSync(entry, { recursive: true, force: true });
      renameSync(staging, entry);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  mkdirSync(destination, { recursive: true });
  // Copies keep archives/cache independent of changes made by the live container.
  copyFileSync(join(entry, files.jar), join(destination, files.jar));
  copyFileSync(join(entry, receipt), join(destination, receipt));
  return true;
}
