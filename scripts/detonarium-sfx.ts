// Event-based effects for an existing Detonarium edit, without rerendering pictures.
// node --import tsx scripts/detonarium-sfx.ts --episode <id>
// Add --review-of <existing-id> to create a separate project and remux its exact MC frames.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { mixEffects, pcmWav, SFX_KINDS, synthesizeEffect, type SoundCue } from "../src/detonarium/sfx.js";
// @ts-ignore Node-only shared soundtrack pipeline.
import { prepare } from "../production/tools/pipeline.mjs";

const root = resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { episode: { type: "string" }, "review-of": { type: "string" } } });
const id = values.episode;
if (!id || !/^episode-[a-zA-Z0-9-]+$/.test(id)) throw new Error("Provide --episode episode-…");
const dir = resolve(root, "production", id), media = resolve(root, "production/public", id), generated = resolve(media, "generated");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const save = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const review = values["review-of"];
if (review) {
  if (!/^episode-[a-zA-Z0-9-]+$/.test(review) || review === id) throw new Error("Invalid review source");
  if (existsSync(dir) || existsSync(media)) throw new Error("Review destination exists; choose a fresh episode ID");
  mkdirSync(dir, { recursive: true }); mkdirSync(generated, { recursive: true });
  const original = resolve(root, "production", review), originalMedia = resolve(root, "production/public", review);
  for (const name of ["source.json", "edit-plan.json", "narration-manifest.json", "narration.txt", "project.meta", "scene.meta"]) cpSync(resolve(original, name), resolve(dir, name));
  for (const name of ["project.ts", "scene.tsx"]) writeFileSync(resolve(dir, name), readFileSync(resolve(original, name), "utf8").replaceAll(review, id));
  for (const name of ["audio", "video"]) cpSync(resolve(originalMedia, name), resolve(media, name), { recursive: true });
  const source = json(resolve(dir, "source.json"));
  source.reviewOf = review; source.soundEffects = true; save(resolve(dir, "source.json"), source);
  for (const game of source.games) cpSync(resolve(originalMedia, "generated", `game-${game}.cut.json`), resolve(generated, `game-${game}.cut.json`));
}
mkdirSync(generated, { recursive: true });
const source = json(resolve(dir, "source.json")), plan = json(resolve(dir, "edit-plan.json"));
if (source.provider !== "detonarium" || !Array.isArray(source.games)) throw new Error("Sound effects require a Detonarium production source");
const seconds = plan.segments.reduce((n: number, s: { duration: number }) => n + s.duration, 0);
const cues: (SoundCue & { game: number })[] = [];
let offset = 0;
for (const segment of plan.segments) {
  const game = source.games.find((g: number) => segment.id === `game-${g}`);
  if (game !== undefined) {
    const cut = json(resolve(generated, `game-${game}.cut.json`));
    if (Math.abs(cut.frames / cut.fps - segment.duration) > 1e-6 || cut.fps !== plan.fps) throw new Error("Game cut differs from the edit; rebuild the board first");
    const speech = cut.narration ?? cut.freezes;
    const input = resolve(generated, `sfx-input-${game}.json`);
    save(input, speech.filter((s: { line?: number }) => s.line).map((s: Record<string, unknown>) => ({ ...s, text: s.caption, game })));
    const focus = (source.focus?.[game] ?? []).map((range: number[]) => range.join(":" )).join(",");
    const stem = resolve(generated, `sfx-clock-${game}`);
    execFileSync(process.execPath, ["--import", "tsx", resolve(root, "scripts/detonarium-record.ts"), resolve(root, source.session, `game-${game}`), "--out", stem + ".mp4", "--fps", String(plan.fps), "--tps", String(source.tps ?? 6), "--narration", input, "--game", String(game), "--focus", focus, "--narration-mode", source.narrationMode ?? "pause", "--timing-only"], { cwd: root, stdio: "inherit" });
    const timing = json(stem + ".timing.json");
    if (timing.frames !== cut.frames || (cut.clockHash && timing.clockHash !== cut.clockHash) || JSON.stringify(timing.narration) !== JSON.stringify(speech.map((s: { line?: number; videoStart: number }) => ({ line: s.line, videoStart: s.videoStart })))) throw new Error("Retiming changed; rebuild the board before placing sounds");
    const frameOffset = Math.round(offset * plan.fps);
    cues.push(...timing.cues.map((c: SoundCue) => ({ ...c, game, frame: frameOffset + c.frame, time: (frameOffset + c.frame) / plan.fps, eventIds: c.eventIds.map((id) => `game-${game}:${id}`) })));
  }
  offset += segment.duration;
}
const bank = resolve(root, "production/public/detonarium-sfx"); mkdirSync(bank, { recursive: true });
for (const kind of SFX_KINDS) writeFileSync(resolve(bank, `${kind}.wav`), pcmWav(synthesizeEffect(kind)));
save(resolve(bank, "manifest.json"), { origin: "Original deterministic procedural synthesis in src/detonarium/sfx.ts; no third-party samples", rights: "Project-original assets; use under repository terms. No external attribution required.", sampleRate: 48000, assets: SFX_KINDS.map((kind) => ({ kind, file: `${kind}.wav` })) });
const effectsDir = resolve(media, "effects"); mkdirSync(effectsDir, { recursive: true });
const mixed = mixEffects(cues, seconds);
writeFileSync(resolve(effectsDir, "detonarium-effects.wav"), pcmWav(mixed.samples));
save(resolve(generated, "sound-effects-cues.json"), { version: 1, fps: plan.fps, seconds, peakBeforeLimit: mixed.peakBeforeLimit, cueCount: cues.length, cues });
plan.effects = { file: "detonarium-effects.wav", volume: 1, duck: true };
save(resolve(dir, "edit-plan.json"), plan);
const prepared = prepare(resolve(root, "production"), id);
const pictureSource = review ?? source.reviewOf;
if (pictureSource) {
  if (typeof pictureSource !== "string" || !/^episode-[a-zA-Z0-9-]+$/.test(pictureSource) || pictureSource === id) throw new Error("Invalid review picture source");
  const original = resolve(root, "production/output", `${pictureSource}.mp4`), output = resolve(root, "production/output", `${id}.mp4`);
  const probe = jsonProbe(original);
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const resolution = plan.resolution ?? { width: 1920, height: 1080 };
  if (!video || Number(video.nb_frames) !== Math.round(seconds * plan.fps) || Math.abs(Number(probe.format.duration) - seconds) > .08 || video.width !== resolution.width || video.height !== resolution.height || video.avg_frame_rate !== `${plan.fps}/1`) throw new Error("Existing Motion Canvas render does not match the review timeline");
  // Audio-only revision: retain the already-rendered Motion Canvas pictures bit-for-bit.
  const partial = output.replace(/\.mp4$/, ".rendering.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", original, "-i", prepared.soundtrack, "-map", "0:v:0", "-map", "1:a:0", "-t", String(seconds), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", partial]);
  renameSync(partial, output);
  console.log(`Review video: ${output}`);
}
console.log(`${id}: ${cues.length} sound cues; ${seconds.toFixed(2)} seconds. Cue sheet: ${resolve(generated, "sound-effects-cues.json")}`);
function jsonProbe(file: string) { return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" })); }
