// Render one recorded Detonarium game to MP4 with bullet time around the agent's moments.
// The game plays at full speed, eases into slow motion before each decision, freezes while
// the decision is narrated, slows again for the payoff, then eases back.
// Needs rsvg-convert and ffmpeg on PATH.
// Usage: tsx scripts/detonarium-record.ts <game dir> [--moments kill,death] [--out file.mp4]
//        [--tps 6] [--fps 30] [--width 1920] [--height 1080] [--title "Game 1"]
// <game dir> holds session/replay.json and session/calls.json (from detonarium-session.ts).
// Writes the MP4 and <out>.cut.json, which lists every freeze (video time, length, caption)
// so narration can be laid onto the same clock.
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { blastCells, PLAYER_COLORS, renderSvg, replayFrames, type Pos, type Replay } from "../packages/detonarium/src/index.js";
import { findMoments, type Moment, type MomentKind } from "../src/detonarium/moments.js";
import { AGENT, type CallRecord } from "../src/detonarium/session.js";

const run = promisify(execFile);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    moments: { type: "string", default: "kill,death" },
    out: { type: "string" },
    tps: { type: "string", default: "6" },
    fps: { type: "string", default: "30" },
    width: { type: "string", default: "1920" },
    height: { type: "string", default: "1080" },
    title: { type: "string" },
  },
});
if (positionals.length !== 1) throw new Error("usage: detonarium-record.ts <game dir> [options]");
const gameDir = resolve(positionals[0]);
const out = resolve(values.out ?? join(gameDir, "game.mp4"));
const NORMAL = Number(values.tps), FPS = Number(values.fps), W = Number(values.width), H = Number(values.height);

const replay: Replay = JSON.parse(readFileSync(join(gameDir, "session/replay.json"), "utf8"));
const calls: CallRecord[] = JSON.parse(readFileSync(join(gameDir, "session/calls.json"), "utf8"));
const frames = replayFrames(replay);
const last = frames.length - 1;
const names = replay.players.map((p) => p.name);
const kinds = new Set(values.moments.split(",") as MomentKind[]);
const moments: Moment[] = findMoments(replay, calls).filter((m) => kinds.has(m.kind));

// ---- Clock: speed keyframes in tick space, plus freezes (narration slots). ----
/** Seconds a caption needs on screen until real narration audio replaces the estimate. */
const readTime = (text: string) => Math.max(2, text.split(/\s+/).length / 2.6 + 0.8);
const decisionText = (m: Moment) => m.call?.rationale ?? m.call?.intention ?? "";
type Freeze = { tick: number; seconds: number; caption: string; moment: number; role: "decision" | "outcome" };
const freezes: Freeze[] = [];
type Key = [tick: number, speed: number];
const inner: Key[] = [];
const windows: [number, number][] = [];
moments.forEach((m, i) => {
  const P = m.decisionTick, K = m.payoffTick;
  if (K - P >= 4) {
    inner.push([P - 0.6, 0.35], [P + 1, 0.5], [P + 2.5, 2], [K - 2, 2], [K - 0.7, 0.25], [K + 0.3, 0.25]);
    freezes.push({ tick: P, seconds: readTime(decisionText(m)), caption: decisionText(m), moment: i, role: "decision" });
  } else {
    inner.push([Math.min(P, K) - 1.5, 0.3], [K + 0.3, 0.25]);
    if (P !== K) freezes.push({ tick: P, seconds: readTime(decisionText(m)), caption: decisionText(m), moment: i, role: "decision" });
  }
  freezes.push({ tick: K, seconds: 1.5, caption: m.summary, moment: i, role: "outcome" });
  windows.push([Math.min(P, K) - 4, K + 3]);
});
const inside = (t: number) => windows.some(([a, b]) => t > a && t < b);
const keys: Key[] = [[0, NORMAL], [last, NORMAL], ...inner];
for (const [a, b] of windows) for (const t of [a, b]) if (!inside(t)) keys.push([t, NORMAL]);
keys.sort((a, b) => a[0] - b[0]);
const speed = (tau: number) => {
  for (let i = 1; i < keys.length; i++) {
    const [a, sa] = keys[i - 1], [b, sb] = keys[i];
    if (tau <= b) return sa + ((sb - sa) * (tau - a)) / Math.max(1e-9, b - a);
  }
  return NORMAL;
};
/** 0..1: how far into slow motion the frame is, for letterbox and vignette. */
const slowness = (tau: number, s: number) => (inside(tau) ? Math.max(0, Math.min(1, (NORMAL - s) / (NORMAL - 0.25))) : 0);

type Shot = { tau: number; s: number; freeze?: Freeze };
const timeline: Shot[] = [];
for (let k = 0; k < FPS; k++) timeline.push({ tau: 0, s: 0 });
const pending = [...freezes].sort((a, b) => a.tick - b.tick);
let tau = 0;
while (tau < last) {
  const s = speed(tau);
  let next = Math.min(tau + s / FPS, last);
  while (pending.length && pending[0].tick > tau && pending[0].tick <= next) {
    const f = pending.shift()!;
    timeline.push({ tau: f.tick, s });
    for (let k = 0; k < f.seconds * FPS; k++) timeline.push({ tau: f.tick, s: 0, freeze: f });
    next = f.tick + 1e-6;
  }
  tau = next;
  timeline.push({ tau, s });
}
for (let k = 0; k < 2 * FPS; k++) timeline.push({ tau: last, s: 0 });

// ---- Drawing. ----
const { width: cols, height: rows } = frames[0].state.rules;
const CELL = Math.floor(Math.min((H - 200) / rows, (W * 0.55) / cols));
const boardW = CELL * cols, boardH = CELL * rows;
const bx = Math.round((W - boardW) / 2 - W * 0.13), by = Math.round((H - boardH) / 2);
const px = bx + boardW + Math.round(W * 0.03);
const u = H / 1080; // type scale
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const blastFor = (m: Moment): Pos[] => {
  if (!m.bomb) return [];
  const state = frames[m.decisionTick].state;
  const bomb = state.bombs.find((b) => b.owner === AGENT && b.pos.x === m.bomb!.x && b.pos.y === m.bomb!.y);
  return bomb ? blastCells(state, bomb) : [];
};
const previews = moments.map(blastFor);
const kills = (n: number) => {
  const count = names.map(() => 0);
  for (let k = 1; k <= n; k++) for (const e of frames[k].events) if (e.type === "eliminated" && e.by !== "collapse") for (const p of e.by) if (p !== e.player) count[p]++;
  return count;
};

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > max) { lines.push(line); line = word; } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

function frameSvg(k: number): string {
  const { tau, s, freeze } = timeline[k];
  const n = Math.max(0, Math.min(last, Math.ceil(tau - 1e-9)));
  const t = n === 0 ? 1 : Math.max(0.0001, Math.min(1, tau - (n - 1)));
  const board = renderSvg(frames[n].state, { cell: CELL, events: frames[n].events, t }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const slow = Math.max(slowness(tau, s), freeze ? 1 : 0);
  const eased = slow * slow * (3 - 2 * slow);
  const bar = eased * Math.round(H * 0.089);
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  o.push(`<rect width="${W}" height="${H}" fill="#0d0f16"/><g transform="translate(${bx} ${by})">${board}`);
  // Blast preview: the dashed cross of the agent's bomb, from the decision until it goes off.
  moments.forEach((m, i) => {
    if (!previews[i].length || tau < m.decisionTick - 0.6 || tau > m.payoffTick + 0.2) return;
    const a = Math.min(1, (tau - (m.decisionTick - 0.6)) / 0.8) * (tau > m.payoffTick - 0.5 ? Math.max(0, (m.payoffTick + 0.2 - tau) / 0.7) : 1);
    for (const c of previews[i]) o.push(`<rect x="${c.x * CELL + CELL * 0.07}" y="${c.y * CELL + CELL * 0.07}" width="${CELL * 0.86}" height="${CELL * 0.86}" rx="${CELL * 0.12}" fill="none" stroke="#ffd166" stroke-width="${CELL * 0.05}" stroke-dasharray="${CELL * 0.16} ${CELL * 0.11}" opacity="${(0.85 * a).toFixed(2)}"/>`);
  });
  o.push(`</g>`);
  o.push(`<defs><radialGradient id="v" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${(0.65 * eased).toFixed(2)}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#v)"/>`);
  // Side panel: title, tick, players with kills.
  const top = by + 60 * u;
  if (values.title) o.push(`<text x="${px}" y="${top}" font-family="DejaVu Sans" font-weight="bold" font-size="${34 * u}" fill="#e6e9f2">${esc(values.title)}</text>`);
  o.push(`<text x="${px}" y="${top + 60 * u}" font-family="DejaVu Sans" font-size="${28 * u}" fill="#8b93a7">TICK ${n}${frames[n].state.rules.suddenDeathTick !== null && n >= frames[n].state.rules.suddenDeathTick! ? "  ·  COLLAPSE" : ""}</text>`);
  const k_ = kills(n);
  frames[n].state.players.forEach((p, i) => {
    const y = top + 140 * u + i * 66 * u;
    o.push(`<circle cx="${px + 16 * u}" cy="${y - 10 * u}" r="${15 * u}" fill="${PLAYER_COLORS[i]}" opacity="${p.alive ? 1 : 0.25}"/>`);
    o.push(`<text x="${px + 48 * u}" y="${y}" font-family="DejaVu Sans" font-size="${29 * u}" fill="${p.alive ? "#e6e9f2" : "#565d70"}"${p.alive ? "" : ` text-decoration="line-through"`}>${esc(names[i])}${k_[i] ? `  ${"✕".repeat(k_[i])}` : ""}</text>`);
  });
  const label = freeze ? "PAUSED" : s < NORMAL - 0.01 && slow > 0 ? `${(s / NORMAL).toFixed(2)}×` : "";
  if (label) o.push(`<text x="${px}" y="${top + 460 * u}" font-family="DejaVu Sans Mono" font-size="${42 * u}" fill="#ffd166" opacity="${eased.toFixed(2)}">${label}</text>`);
  o.push(`<rect width="${W}" height="${bar.toFixed(1)}" fill="#000"/><rect y="${(H - bar).toFixed(1)}" width="${W}" height="${bar.toFixed(1)}" fill="#000"/>`);
  // Caption in the lower bar during a freeze: the agent's own words, or the outcome.
  if (freeze?.caption) {
    const lines = wrap(freeze.caption, 90);
    const size = (lines.length > 1 ? 24 : 29) * u;
    lines.forEach((line, i) => o.push(`<text x="${W / 2}" y="${H - bar / 2 + (i - (lines.length - 1) / 2) * size * 1.2 + size * 0.35}" text-anchor="middle" font-family="DejaVu Sans" font-style="${freeze.role === "decision" ? "italic" : "normal"}" font-size="${size}" fill="${freeze.role === "decision" ? "#e6e9f2" : "#ffd166"}">${esc(line)}</text>`));
  }
  o.push(`</svg>`);
  return o.join("");
}

const dir = join(tmpdir(), `detonarium-record-${process.pid}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const started = Date.now();
let next = 0;
const worker = async () => {
  for (let k = next++; k < timeline.length; k = next++) {
    const svg = join(dir, `${String(k).padStart(6, "0")}.svg`);
    writeFileSync(svg, frameSvg(k));
    await run("rsvg-convert", ["-o", svg.replace(/svg$/, "png"), svg]);
    rmSync(svg);
  }
};
await Promise.all(Array.from({ length: availableParallelism() }, worker));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%06d.png"),
  "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", out]);
rmSync(dir, { recursive: true });

// The cut: where each freeze sits on the video clock, for laying narration on later.
const cut = { video: out, fps: FPS, frames: timeline.length, seconds: timeline.length / FPS, moments: moments.map(({ call, ...m }) => ({ ...m, intention: call?.intention, rationale: call?.rationale })),
  freezes: [] as (Freeze & { videoStart: number })[] };
timeline.forEach((shot, k) => { if (shot.freeze && timeline[k - 1]?.freeze !== shot.freeze) cut.freezes.push({ ...shot.freeze, videoStart: Number((k / FPS).toFixed(3)) }); });
writeFileSync(out.replace(/\.mp4$/, "") + ".cut.json", JSON.stringify(cut, null, 2) + "\n");
console.log(`${out}: ${cut.seconds.toFixed(1)} s, ${moments.length} moments, ${cut.freezes.length} freezes, rendered in ${((Date.now() - started) / 1000).toFixed(0)} s`);
