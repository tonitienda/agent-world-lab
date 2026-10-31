import { eventCaption } from "./captions.js";
import { PLAYER_COLORS, renderSvg, viewBox } from "./render.js";
import { replayFrames, type Replay } from "./replay.js";

const FOLLOW_RADIUS = 3;

/** A self-contained HTML page that plays a replay: frames are pre-rendered, no scripts are loaded from outside. */
export function viewerHtml(replay: Replay, options: { cell?: number } = {}): string {
  const cell = options.cell ?? 48;
  const names = replay.players.map((p) => p.name);
  const kills = replay.players.map(() => 0);
  const frames = replayFrames(replay).map(({ state, events }) => {
    for (const e of events) if (e.type === "eliminated" && typeof e.by === "number" && e.by !== e.player) kills[e.by]++;
    return {
      svg: renderSvg(state, { cell, events }),
      follow: state.players.map((p) => viewBox(state, { kind: "follow", player: p.id, radius: FOLLOW_RADIUS }, cell)),
      captions: events.map((e) => eventCaption(e, names)).filter((c): c is string => c !== null),
      players: state.players.map((p) => ({ alive: p.alive, bombs: p.bombs, range: p.range, kills: kills[p.id] })),
      tick: state.tick,
    };
  });
  const data = JSON.stringify({ names, colors: PLAYER_COLORS, frames, seed: replay.seed }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Detonarium replay</title>
<style>
  :root { color-scheme: dark; --bg: #0d0f15; --panel: #171a24; --text: #e6e8ef; --muted: #8a90a2; --accent: #ffd166; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, sans-serif; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; padding: 16px; max-width: 1100px; margin: 0 auto; }
  @media (max-width: 760px) { main { grid-template-columns: 1fr; } }
  #stage svg { width: 100%; height: auto; display: block; border-radius: 8px; }
  .panel { background: var(--panel); border-radius: 8px; padding: 12px; }
  .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
  button, select { background: #252a38; color: var(--text); border: 0; border-radius: 6px; padding: 6px 10px; font: inherit; cursor: pointer; }
  input[type=range] { flex: 1; min-width: 120px; accent-color: var(--accent); }
  .player { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .player.dead { opacity: 0.4; text-decoration: line-through; }
  .dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
  .stats { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
  #feed { list-style: none; margin: 12px 0 0; padding: 0; max-height: 360px; overflow-y: auto; }
  #feed li { padding: 3px 0; border-bottom: 1px solid #ffffff10; }
  #feed .t { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 6px; }
  h1 { font-size: 16px; margin: 0 0 8px; }
</style></head>
<body><main>
  <section>
    <div id="stage"></div>
    <div class="controls">
      <button id="play">Play</button>
      <input id="scrub" type="range" min="0" value="0">
      <span id="tick" class="stats"></span>
      <select id="speed"><option value="2">0.5x</option><option value="4" selected>1x</option><option value="8">2x</option><option value="16">4x</option></select>
      <select id="view"><option value="board">Board</option></select>
    </div>
  </section>
  <aside class="panel">
    <h1>Detonarium · seed <span id="seed"></span></h1>
    <div id="players"></div>
    <ul id="feed"></ul>
  </aside>
</main>
<script>
const data = ${data};
const $ = (id) => document.getElementById(id);
const stage = $("stage"), scrub = $("scrub"), feed = $("feed");
let frame = 0, timer = null;
scrub.max = data.frames.length - 1;
$("seed").textContent = data.seed;
data.names.forEach((n, i) => $("view").add(new Option("Follow " + n, String(i))));

function show(n) {
  frame = n;
  const f = data.frames[n];
  stage.innerHTML = f.svg;
  const view = $("view").value;
  if (view !== "board") {
    const svg = stage.firstChild, box = f.follow[Number(view)];
    svg.setAttribute("viewBox", box.join(" "));
  }
  scrub.value = n;
  $("tick").textContent = "tick " + f.tick + " / " + data.frames[data.frames.length - 1].tick;
  $("players").innerHTML = f.players.map((p, i) =>
    '<div class="player' + (p.alive ? "" : " dead") + '"><span class="dot" style="background:' + data.colors[i] + '"></span>' +
    data.names[i] + '<span class="stats">💣' + p.bombs + " 🔥" + p.range + " ☠" + p.kills + "</span></div>").join("");
  const lines = [];
  for (let i = n; i >= 0 && lines.length < 40; i--) for (const c of data.frames[i].captions) lines.push([data.frames[i].tick, c]);
  feed.innerHTML = lines.map(([t, c]) => '<li><span class="t">' + t + "</span>" + c.replace(/</g, "&lt;") + "</li>").join("");
}
function play() {
  if (timer) { clearInterval(timer); timer = null; $("play").textContent = "Play"; return; }
  if (frame >= data.frames.length - 1) show(0);
  $("play").textContent = "Pause";
  timer = setInterval(() => { if (frame >= data.frames.length - 1) play(); else show(frame + 1); }, 1000 / Number($("speed").value));
}
$("play").onclick = play;
scrub.oninput = () => show(Number(scrub.value));
$("view").onchange = () => show(frame);
$("speed").onchange = () => { if (timer) { play(); play(); } };
document.addEventListener("keydown", (e) => {
  if (e.key === " ") { e.preventDefault(); play(); }
  if (e.key === "ArrowRight") show(Math.min(frame + 1, data.frames.length - 1));
  if (e.key === "ArrowLeft") show(Math.max(frame - 1, 0));
});
show(0);
</script></body></html>`;
}
