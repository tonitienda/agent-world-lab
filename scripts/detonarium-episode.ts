// Build the two-game Episode 004 board and narration schedule from recorded games.
// node --import tsx scripts/detonarium-episode.ts [--episode episode-004-take-2] [--audio-dir path]
// Without audio this produces a silent draft. With audio it measures every WAV,
// rebuilds the holds, and prepares the shared Motion Canvas project for final export.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { renderSvg, replayFrames } from "../packages/detonarium/src/index.js";
import type { Segment } from "../production/src/timeline.js";
import { cardTiming } from "../src/detonarium/card-timing.js";

const root = resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { "audio-dir": { type: "string" }, episode: { type: "string" } } });
const id = values.episode ?? "episode-004";
if (!/^episode-[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid episode ID");
const dir = resolve(root, "production", id);
const media = resolve(root, "production/public", id);
const generated = resolve(media, "generated");
const output = resolve(root, "production/output");
for (const path of [generated, output, resolve(media, "video"), resolve(media, "audio")]) mkdirSync(path, { recursive: true });
const source = JSON.parse(readFileSync(resolve(dir, "source.json"), "utf8"));
type Cue = { line: number; game: number; tick: number; text: string; audio: string; seconds: number; timing: string; card?: string };
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
// Card speech belongs on its card, not in a second hold inside the game.
writeFileSync(timingFile, JSON.stringify(cues.filter((c) => !c.card), null, 2) + "\n");
const narration: { line: number; audio: string; at: number }[] = [];
let offset = 0;
let totalFrames = 0;
const videos: string[] = [];
const segments: Segment[] = [];
type Voice = { line: number; audio: string; at: number };
type Card = { id: string; beforeGame?: number; afterGames?: boolean; title: string; body: string };
const cards: Card[] = source.cards ?? [];
for (const cue of cues) if (cue.card && !cards.some((c) => c.id === cue.card)) throw new Error(`Unknown card: ${cue.card}`);
const addPart = (video: string, frames: number, voices: Voice[], partId: string) => {
  const duration = frames / source.fps;
  segments.push({ id: partId, kind: "shot", duration, narration: voices,
    shot: { kind: "full", cameras: ["board"], start: offset, duration } });
  narration.push(...voices.map((v) => ({ ...v, at: Number((offset + v.at).toFixed(6)) })));
  totalFrames += frames;
  offset = totalFrames / source.fps;
  videos.push(video);
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const addCard = (card: Card, game: number) => {
  const speech = cues.filter((c) => c.card === card.id);
  const timing = cardTiming(speech, source.fps);
  const replay = JSON.parse(readFileSync(resolve(root, source.session, `game-${game}/session/replay.json`), "utf8"));
  const states = replayFrames(replay);
  const state = card.afterGames ? states.at(-1)!.state : states[0].state;
  const boardSvg = renderSvg(state, { cell: 80 }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${source.resolution.width}" height="${source.resolution.height}" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#0d0f16"/><g transform="translate(520 100)">${boardSvg}</g><rect width="1920" height="1080" fill="#07121b" opacity="0.89"/><rect x="915" y="240" width="90" height="5" fill="#d97757"/><text x="960" y="330" text-anchor="middle" font-family="DejaVu Sans" font-size="40" letter-spacing="5" fill="#e6e9f2">THE AGENT TERRARIUM</text><text x="960" y="485" text-anchor="middle" font-family="DejaVu Sans" font-size="64" font-weight="bold" fill="#d97757">${esc(card.title)}</text>${card.body.split("\n").map((line, i) => `<text x="960" y="${590 + i * 56}" text-anchor="middle" font-family="DejaVu Sans" font-size="34" fill="#b7c3d5">${esc(line)}</text>`).join("")}</svg>`;
  const path = resolve(generated, `${card.id}.svg`), png = resolve(generated, `${card.id}.png`), video = resolve(generated, `${card.id}.mp4`);
  writeFileSync(path, svg);
  execFileSync("rsvg-convert", ["-o", png, path]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-framerate", String(source.fps), "-i", png, "-frames:v", String(timing.frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video]);
  addPart(video, timing.frames, timing.voices, card.id);
};
for (const game of source.games as number[]) {
  for (const card of cards.filter((c) => c.beforeGame === game)) addCard(card, game);
  const video = resolve(generated, `game-${game}.mp4`);
  const focus = (source.focus?.[game] ?? []).map(([from, to]: [number, number]) => `${from}:${to}`).join(",");
  execFileSync(process.execPath, ["--import", "tsx", resolve(root, "scripts/detonarium-record.ts"), resolve(root, source.session, `game-${game}`), "--out", video, "--title", `Game ${game}`, "--fps", String(source.fps), "--tps", String(source.tps ?? 6), "--width", String(source.resolution.width), "--height", String(source.resolution.height), "--narration", timingFile, "--game", String(game), "--focus", focus, "--narration-mode", source.narrationMode ?? "pause"], { cwd: root, stdio: "inherit" });
  const cut = JSON.parse(readFileSync(video.replace(/\.mp4$/, ".cut.json"), "utf8"));
  const voices = (cut.narration ?? cut.freezes).filter((f: { line?: number }) => f.line).map((f: { line: number; audio: string; videoStart: number }) => ({ line: f.line, audio: f.audio, at: f.videoStart + 0.25 }));
  addPart(video, cut.frames, voices, `game-${game}`);
}
for (const card of cards.filter((c) => c.afterGames)) addCard(card, source.games.at(-1));
if (narration.length !== cues.length || narration.some((v, i) => v.line !== cues[i].line)) throw new Error("Narration is missing, duplicated, or out of manifest order");
// Constant codec, resolution and frame rate make this a lossless stream join.
const list = resolve(generated, "concat.txt");
writeFileSync(list, videos.map((v) => `file '${v.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
const board = resolve(media, "video/board.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", board]);
const plan = { version: 2, title: "Episode 004: Claude in Detonarium — Two Games", fps: source.fps, resolution: source.resolution,
  cameras: [{ id: "board", file: "board.mp4", offsetSeconds: 0 }],
  segments };
writeFileSync(resolve(dir, "edit-plan.json"), JSON.stringify(plan, null, 2) + "\n");
writeFileSync(resolve(generated, "narration-schedule.json"), JSON.stringify(narration, null, 2) + "\n");
if (!values["audio-dir"]) {
  const draft = resolve(output, `${id}-silent-draft.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", board, "-c", "copy", "-movflags", "+faststart", draft]);
  console.log(`Silent draft: ${draft}`);
} else console.log(`Audio-ready project. Final export: EPISODE_ID=${id} npm run episode:render`);
console.log(`${cues.length} narration clips; ${offset.toFixed(1)} seconds. Schedule: ${resolve(generated, "narration-schedule.json")}`);
