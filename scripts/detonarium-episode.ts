// Build the two-game Episode 004 board and narration schedule from recorded games.
// node --import tsx scripts/detonarium-episode.ts [--audio-dir path]
// Without audio this produces a silent draft. With audio it measures every WAV,
// rebuilds the holds, and prepares the shared Motion Canvas project for final export.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { "audio-dir": { type: "string" } } });
const id = "episode-004";
const dir = resolve(root, "production", id);
const media = resolve(root, "production/public", id);
const generated = resolve(media, "generated");
const output = resolve(root, "production/output");
for (const path of [generated, output, resolve(media, "video"), resolve(media, "audio")]) mkdirSync(path, { recursive: true });
const source = JSON.parse(readFileSync(resolve(dir, "source.json"), "utf8"));
type Cue = { line: number; game: number; tick: number; text: string; audio: string; seconds: number; timing: string };
const cues: Cue[] = JSON.parse(readFileSync(resolve(dir, "narration-manifest.json"), "utf8"));
if (values["audio-dir"]) {
  const audioDir = resolve(values["audio-dir"]);
  // Check the entire set before starting any expensive rendering.
  for (const cue of cues) if (!existsSync(resolve(audioDir, cue.audio))) throw new Error(`Missing audio: ${resolve(audioDir, cue.audio)}`);
  for (const cue of cues) {
    const file = resolve(audioDir, cue.audio);
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
    if (!(seconds > 0)) throw new Error(`Invalid audio duration: ${file}`);
    cue.seconds = Math.ceil((seconds + 0.8) * source.fps) / source.fps;
    cue.timing = "measured WAV duration plus 0.8 seconds breathing room";
    const target = resolve(media, "audio", cue.audio);
    if (target !== file) {
      if (existsSync(target) && !readFileSync(target).equals(readFileSync(file))) throw new Error(`Different audio already exists: ${target}`);
      writeFileSync(target, readFileSync(file));
    }
  }
}
const timingFile = resolve(generated, "narration-cues.json");
writeFileSync(timingFile, JSON.stringify(cues, null, 2) + "\n");
const narration: { line: number; audio: string; at: number }[] = [];
let offset = 0;
let totalFrames = 0;
const videos: string[] = [];
for (const game of source.games as number[]) {
  const video = resolve(generated, `game-${game}.mp4`);
  execFileSync(process.execPath, ["--import", "tsx", resolve(root, "scripts/detonarium-record.ts"), resolve(root, source.session, `game-${game}`), "--out", video, "--title", `Game ${game}`, "--fps", String(source.fps), "--width", String(source.resolution.width), "--height", String(source.resolution.height), "--narration", timingFile, "--game", String(game)], { cwd: root, stdio: "inherit" });
  const cut = JSON.parse(readFileSync(video.replace(/\.mp4$/, ".cut.json"), "utf8"));
  for (const freeze of cut.freezes) if (freeze.line) narration.push({ line: freeze.line, audio: freeze.audio, at: Number((offset + freeze.videoStart + 0.25).toFixed(3)) });
  totalFrames += cut.frames;
  offset = totalFrames / source.fps;
  videos.push(video);
}
// Constant codec, resolution and frame rate make this a lossless stream join.
const list = resolve(generated, "concat.txt");
writeFileSync(list, videos.map((v) => `file '${v.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
const board = resolve(media, "video/board.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", board]);
const plan = { version: 2, title: "Episode 004: Claude in Detonarium — Two Games", fps: source.fps, resolution: source.resolution,
  cameras: [{ id: "board", file: "board.mp4", offsetSeconds: 0 }],
  segments: [{ id: "two-games", kind: "shot", duration: offset, narration,
    shot: { kind: "full", cameras: ["board"], start: 0, duration: offset } }] };
writeFileSync(resolve(dir, "edit-plan.json"), JSON.stringify(plan, null, 2) + "\n");
writeFileSync(resolve(generated, "narration-schedule.json"), JSON.stringify(narration, null, 2) + "\n");
if (!values["audio-dir"]) {
  const draft = resolve(output, `${id}-silent-draft.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", board, "-c", "copy", "-movflags", "+faststart", draft]);
  console.log(`Silent draft: ${draft}`);
} else console.log(`Audio-ready project. Final export: EPISODE_ID=${id} npm run episode:render`);
console.log(`${cues.length} narration clips; ${offset.toFixed(1)} seconds. Schedule: ${resolve(generated, "narration-schedule.json")}`);
