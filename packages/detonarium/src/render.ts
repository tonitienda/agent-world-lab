import { index } from "./board.js";
import type { Direction, MatchEvent, MatchState, PickupKind, Pos } from "./types.js";

export const PLAYER_COLORS = ["#4cc9f0", "#f72585", "#90be6d", "#f9c74f"];
const C = {
  background: "#14161f",
  floor: "#262b38",
  floorAlt: "#2a3040",
  wall: "#3d4457",
  wallTop: "#59627c",
  wallSide: "#2c3242",
  crate: "#b07a3e",
  crateDark: "#7a5226",
  crateLight: "#cf9a5a",
  nail: "#4a3016",
  cord: "#d8c39a",
  spark: "#ffd166",
  fuse: "#ffd166",
  fuseLow: "#ef476f",
  flameOuter: "#ff6b1a",
  flameMid: "#ffb703",
  flameCore: "#fff3c4",
  warning: "#ef476f",
  ink: "#11131a",
};

export type View =
  | { kind: "board" }
  /** Square crop centred on a player (clamped to the board), `radius` cells each side. */
  | { kind: "follow"; player: number; radius: number };

export type RenderOptions = {
  /** Pixels per cell. */
  cell?: number;
  view?: View;
  /** Events of the tick that produced `state`: drive movement, bumps, explosions, debris and eliminations. */
  events?: MatchEvent[];
  /**
   * Progress through the tick that produced `state`, 0..1. 1 (default) is the settled frame;
   * smaller values draw the in-between moment (players mid-step, flames blooming).
   */
  t?: number;
  /** How many upcoming collapse cells to mark during sudden death. */
  collapseWarning?: number;
};

const DIRS: Record<Direction, Pos> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const f = (n: number) => Number(n.toFixed(2));
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
/** Deterministic 0..1 hash: flicker must look random but re-render identically. */
const noise = (n: number) => Math.abs((Math.sin(n * 12.9898) * 43758.5453) % 1);

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The [x, y, width, height] pixel region a view shows. `centre` overrides the followed player's cell (for smooth tracking). */
export function viewBox(state: MatchState, view: View, cell: number, centre?: Pos): [number, number, number, number] {
  const { width, height } = state.rules;
  if (view.kind === "board") return [0, 0, width * cell, height * cell];
  const size = Math.min(2 * view.radius + 1, width, height);
  const c = centre ?? state.players[view.player].pos;
  const x = clamp(c.x - view.radius, 0, width - size);
  const y = clamp(c.y - view.radius, 0, height - size);
  return [f(x * cell), f(y * cell), size * cell, size * cell];
}

type Pose = { x: number; y: number; look: Direction; sx: number; sy: number; hop: number; step: number; dying: number | null };

/** Where each visible player is drawn at progress t, and how its body is deformed. */
function poses(state: MatchState, events: MatchEvent[], t: number): Map<number, Pose> {
  const result = new Map<number, Pose>();
  for (const player of state.players) {
    const death = events.find((e) => e.type === "eliminated" && e.player === player.id);
    if (!player.alive && !death) continue;
    const breathe = Math.sin((2 * Math.PI * (state.tick + t)) / 3 + player.id) * 0.025;
    const pose: Pose = { ...player.pos, look: "down", sx: 1 - breathe, sy: 1 + breathe, hop: 0, step: 0, dying: death ? t : null };
    for (const e of events) {
      if (e.type === "moved" && e.player === player.id) {
        const k = easeInOut(t);
        pose.x = e.from.x + (e.to.x - e.from.x) * k;
        pose.y = e.from.y + (e.to.y - e.from.y) * k;
        pose.look = direction(e.from, e.to);
        pose.hop = Math.sin(Math.PI * t) * 0.1;
        pose.step = Math.sin(2 * Math.PI * t);
      } else if (e.type === "bumped" && e.player === player.id) {
        // Lean into the contested cell and squash on contact halfway through.
        const d = DIRS[e.direction], lean = Math.sin(Math.PI * t) * 0.22;
        const impact = Math.max(0, 1 - Math.abs(t - 0.5) * 4);
        pose.x += d.x * lean;
        pose.y += d.y * lean;
        pose.look = e.direction;
        pose.sx = d.x !== 0 ? 1 - 0.2 * impact : 1 + 0.14 * impact;
        pose.sy = d.y !== 0 ? 1 - 0.2 * impact : 1 + 0.14 * impact;
      }
    }
    result.set(player.id, pose);
  }
  return result;
}

/** One frame as a standalone SVG document. Original flat art; no external assets. */
export function renderSvg(state: MatchState, options: RenderOptions = {}): string {
  const cell = options.cell ?? 48;
  const events = options.events ?? [];
  const t = clamp(options.t ?? 1, 0, 1);
  const time = state.tick - 1 + t;
  const { rules } = state;
  const { width, height } = rules;
  const view = options.view ?? { kind: "board" };
  const pose = poses(state, events, t);
  const followed = view.kind === "follow" ? pose.get(view.player) : undefined;
  const [vx, vy, vw, vh] = viewBox(state, view, cell, followed);
  const out: string[] = [];
  const centre = (p: Pos) => ({ cx: (p.x + 0.5) * cell, cy: (p.y + 0.5) * cell });
  const falling = new Set(events.flatMap((e) => (e.type === "collapse" && t < 1 ? [index(rules, e.pos)] : [])));

  out.push(`<defs>
<radialGradient id="dn-bomb" cx="35%" cy="35%" r="75%"><stop offset="0" stop-color="#525a75"/><stop offset="1" stop-color="#101219"/></radialGradient>
<radialGradient id="dn-glow"><stop offset="0" stop-color="#ffd166" stop-opacity="0.4"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient>
</defs>`);
  out.push(`<rect x="0" y="0" width="${width * cell}" height="${height * cell}" fill="${C.floor}"/>`);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x * cell, py = y * cell, i = index(rules, { x, y });
      const kind = falling.has(i) ? "floor" : state.cells[i];
      if (kind === "wall") wall(out, px, py, cell);
      else if ((x + y) % 2) out.push(`<rect x="${px}" y="${py}" width="${cell}" height="${cell}" fill="${C.floorAlt}"/>`);
      if (kind === "crate") crate(out, px, py, cell);
    }
  }

  if (rules.suddenDeathTick !== null && options.collapseWarning !== 0) {
    const count = options.collapseWarning ?? 3;
    const from = Math.max(0, state.tick - rules.suddenDeathTick);
    const ahead = rules.suddenDeathTick - state.tick;
    if (ahead < count) {
      const pulse = f(0.55 + 0.45 * Math.sin(2 * Math.PI * time));
      for (const p of state.collapseOrder.slice(from, from + count - Math.max(0, ahead))) {
        out.push(`<rect x="${p.x * cell + 3}" y="${p.y * cell + 3}" width="${cell - 6}" height="${cell - 6}" fill="${C.warning}" fill-opacity="0.12" stroke="${C.warning}" stroke-width="${f(cell * 0.05)}" stroke-dasharray="${f(cell * 0.14)} ${f(cell * 0.09)}" rx="${f(cell * 0.1)}" opacity="${pulse}"/>`);
      }
    }
  }

  const revealed = new Set(events.flatMap((e) => (e.type === "crate_destroyed" && e.revealed ? [index(rules, e.pos)] : [])));
  state.pickups.forEach((kind, i) => {
    if (!kind) return;
    const { cx, cy } = centre({ x: i % width, y: Math.floor(i / width) });
    const bob = Math.sin((2 * Math.PI * time) / 4 + i) * cell * 0.04;
    pickup(out, kind, cx, cy + bob, cell, revealed.has(i) ? easeOutBack(t) : 1, 1);
  });
  for (const e of events) {
    if (e.type !== "pickup_collected") continue;
    const { cx, cy } = centre(e.pos);
    pickup(out, e.kind, cx, cy - t * cell * 0.4, cell, 1 + t * 0.5, 1 - t);
  }

  for (const bomb of state.bombs) {
    const { cx, cy } = centre(bomb.pos);
    const fresh = events.some((e) => e.type === "bomb_placed" && e.pos.x === bomb.pos.x && e.pos.y === bomb.pos.y);
    const remaining = Math.min(rules.fuse, bomb.fuse + 1 - t) / rules.fuse;
    drawBomb(out, cx, cy, cell, fresh ? easeOutBack(clamp(t * 1.6, 0, 1)) : 1, remaining, bomb.fuse <= 2, time);
  }

  const flames = new Map(state.flames.map((fl) => [index(rules, fl.pos), fl]));
  const layers: [string, number][] = [[C.flameOuter, 0.8], [C.flameMid, 0.52], [C.flameCore, 0.24]];
  for (const [color, thickness] of layers) {
    for (const [i, flame] of flames) {
      const fresh = flame.ticks === rules.flameTicks;
      const grow = fresh ? 0.35 + 0.65 * easeOut(t) : 1;
      const intensity = fresh ? 1 : Math.min(1, (flame.ticks + 1 - t) / rules.flameTicks);
      const jitter = 1 + 0.12 * (noise(i * 7 + Math.floor(time * 8)) - 0.5);
      const w = f(cell * thickness * grow * jitter * (0.55 + 0.45 * intensity));
      const { cx, cy } = centre(flame.pos);
      const parts = [`<circle cx="${cx}" cy="${cy}" r="${f(w / 2)}"/>`];
      for (const d of Object.values(DIRS)) {
        const n = { x: flame.pos.x + d.x, y: flame.pos.y + d.y };
        if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height || !flames.has(index(rules, n))) continue;
        const half = cell / 2;
        parts.push(d.x !== 0
          ? `<rect x="${d.x > 0 ? cx : cx - half}" y="${f(cy - w / 2)}" width="${half}" height="${w}"/>`
          : `<rect x="${f(cx - w / 2)}" y="${d.y > 0 ? cy : cy - half}" width="${w}" height="${half}"/>`);
      }
      out.push(`<g fill="${color}" opacity="${f(0.35 + 0.65 * intensity)}">${parts.join("")}</g>`);
    }
  }
  for (const e of events) {
    if (e.type === "exploded" && t < 1) {
      const { cx, cy } = centre(e.pos);
      out.push(`<circle cx="${cx}" cy="${cy}" r="${f(cell * 0.75 * easeOut(t))}" fill="#fff" opacity="${f(0.8 * (1 - t))}"/>`);
    }
    if (e.type === "crate_destroyed" && t < 1) {
      const { cx, cy } = centre(e.pos);
      for (let k = 0; k < 4; k++) {
        const angle = Math.PI / 4 + (k * Math.PI) / 2 + noise(e.pos.x * 31 + e.pos.y * 17 + k) * 0.6;
        const dist = easeOut(t) * cell * 0.6;
        const px = f(cx + Math.cos(angle) * dist), py = f(cy + Math.sin(angle) * dist + t * t * cell * 0.3);
        out.push(`<rect x="${f(px - cell * 0.12)}" y="${f(py - cell * 0.05)}" width="${f(cell * 0.24)}" height="${f(cell * 0.1)}" rx="2" fill="${k % 2 ? C.crate : C.crateLight}" opacity="${f(1 - t)}" transform="rotate(${f((k % 2 ? 1 : -1) * t * 220)} ${px} ${py})"/>`);
      }
    }
  }

  for (const [id, p] of [...pose].sort(([, a], [, b]) => a.y - b.y)) drawPlayer(out, id, p, cell);
  for (const e of events) {
    if (e.type !== "eliminated") continue;
    const { cx, cy } = centre(e.pos), d = f(cell * 0.22);
    out.push(`<path d="M${cx - d} ${cy - d}L${cx + d} ${cy + d}M${cx + d} ${cy - d}L${cx - d} ${cy + d}" stroke="${PLAYER_COLORS[e.player]}" stroke-width="${f(cell * 0.09)}" stroke-linecap="round" opacity="${f(easeOut(t))}"/>`);
  }

  // Collapsing blocks drop in from above, over whatever they crush.
  for (const i of falling) {
    const px = (i % width) * cell, py = Math.floor(i / width) * cell;
    out.push(`<rect x="${px + cell * 0.1}" y="${py + cell * 0.1}" width="${cell * 0.8}" height="${cell * 0.8}" rx="${f(cell * 0.1)}" fill="#000" opacity="${f(0.45 * t)}"/>`);
    out.push(`<g transform="translate(0 ${f(-(1 - easeIn(t)) * cell * 1.2)})" opacity="${f(Math.min(1, t * 3))}">`);
    wall(out, px, py, cell);
    out.push(`</g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}">${out.join("")}</svg>`;
}

function wall(out: string[], px: number, py: number, cell: number) {
  out.push(`<rect x="${px}" y="${py}" width="${cell}" height="${cell}" fill="${C.wall}"/>`);
  out.push(`<rect x="${px}" y="${py}" width="${cell}" height="${f(cell * 0.2)}" fill="${C.wallTop}"/>`);
  out.push(`<rect x="${px}" y="${f(py + cell * 0.86)}" width="${cell}" height="${f(cell * 0.14)}" fill="${C.wallSide}"/>`);
  out.push(`<path d="M${px} ${f(py + cell * 0.53)}h${cell}M${f(px + cell * 0.5)} ${f(py + cell * 0.2)}v${f(cell * 0.33)}M${f(px + cell * 0.25)} ${f(py + cell * 0.53)}v${f(cell * 0.33)}M${f(px + cell * 0.75)} ${f(py + cell * 0.53)}v${f(cell * 0.33)}" stroke="${C.wallSide}" stroke-width="${f(cell * 0.04)}"/>`);
}

function crate(out: string[], px: number, py: number, cell: number) {
  const m = cell * 0.07, s = cell - 2 * m, b = cell * 0.09;
  const x0 = f(px + m), y0 = f(py + m), x1 = f(px + m + s), y1 = f(py + m + s);
  out.push(`<rect x="${x0}" y="${y0}" width="${f(s)}" height="${f(s)}" rx="${f(cell * 0.06)}" fill="${C.crateDark}"/>`);
  out.push(`<rect x="${f(x0 + b)}" y="${f(y0 + b)}" width="${f(s - 2 * b)}" height="${f(s - 2 * b)}" fill="${C.crate}"/>`);
  out.push(`<path d="M${f(x0 + b)} ${f(py + cell * 0.38)}H${f(x1 - b)}M${f(x0 + b)} ${f(py + cell * 0.62)}H${f(x1 - b)}" stroke="${C.crateDark}" stroke-width="${f(cell * 0.025)}" opacity="0.6"/>`);
  out.push(`<path d="M${f(x0 + b)} ${f(y1 - b)}L${f(x1 - b)} ${f(y0 + b)}" stroke="${C.crateLight}" stroke-width="${f(cell * 0.08)}"/>`);
  for (const [nx, ny] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    out.push(`<circle cx="${f(nx + (nx === x0 ? 1 : -1) * b / 2)}" cy="${f(ny + (ny === y0 ? 1 : -1) * b / 2)}" r="${f(cell * 0.025)}" fill="${C.nail}"/>`);
  }
}

function pickup(out: string[], kind: PickupKind, cx: number, cy: number, cell: number, scale: number, opacity: number) {
  const s = cell * 0.22;
  out.push(`<g transform="translate(${f(cx)} ${f(cy)}) scale(${f(Math.max(0, scale))})" opacity="${f(clamp(opacity, 0, 1))}">`);
  out.push(`<circle r="${f(cell * 0.42)}" fill="url(#dn-glow)"/>`);
  if (kind === "bomb") {
    out.push(`<path d="M${f(s * 0.45)} ${f(-s * 0.45)}q${f(s * 0.25)} ${f(-s * 0.45)} ${f(s * 0.6)} ${f(-s * 0.4)}" stroke="${C.cord}" stroke-width="${f(cell * 0.035)}" fill="none"/>`);
    out.push(`<circle r="${f(s * 0.75)}" fill="url(#dn-bomb)"/><circle cx="${f(s * 1.05)}" cy="${f(-s * 0.85)}" r="${f(cell * 0.04)}" fill="${C.spark}"/>`);
  } else {
    const flame = (k: number) => `M0 ${f(-s * k)}C${f(s * 0.65 * k)} ${f(-s * 0.3 * k)} ${f(s * 0.8 * k)} ${f(s * 0.4 * k)} 0 ${f(s * 0.8 * k)}C${f(-s * 0.8 * k)} ${f(s * 0.4 * k)} ${f(-s * 0.65 * k)} ${f(-s * 0.3 * k)} 0 ${f(-s * k)}Z`;
    out.push(`<path d="${flame(1)}" fill="${C.flameOuter}"/><path d="${flame(0.55)}" transform="translate(0 ${f(s * 0.3)})" fill="${C.flameMid}"/>`);
  }
  const bx = f(s * 0.85), by = f(s * 0.7), br = f(cell * 0.1), arm = f(cell * 0.055);
  out.push(`<circle cx="${bx}" cy="${by}" r="${br}" fill="#fff"/><path d="M${f(bx - arm)} ${by}h${f(2 * arm)}M${bx} ${f(by - arm)}v${f(2 * arm)}" stroke="${C.ink}" stroke-width="${f(cell * 0.03)}" stroke-linecap="round"/>`);
  out.push(`</g>`);
}

function drawBomb(out: string[], cx: number, cy: number, cell: number, pop: number, remaining: number, low: boolean, time: number) {
  const r = cell * 0.28;
  const pulse = 1 + (low ? 0.08 : 0.03) * Math.sin(2 * Math.PI * time * (low ? 2 : 0.5));
  const ring = cell * 0.43, length = 2 * Math.PI * ring;
  out.push(`<ellipse cx="${cx}" cy="${f(cy + r * 0.95)}" rx="${f(r * 0.85 * pop)}" ry="${f(r * 0.25 * pop)}" fill="#00000066"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${f(ring)}" fill="none" stroke="${low ? C.fuseLow : C.fuse}" stroke-opacity="0.55" stroke-width="${f(cell * 0.04)}" stroke-linecap="round" stroke-dasharray="${f(length * remaining)} ${f(length)}" transform="rotate(-90 ${cx} ${cy})"/>`);
  out.push(`<g transform="translate(${cx} ${cy}) scale(${f(Math.max(0, pop * pulse))})">`);
  out.push(`<circle r="${f(r)}" fill="url(#dn-bomb)"/>`);
  if (low) out.push(`<circle r="${f(r)}" fill="${C.fuseLow}" opacity="${f(0.25 + 0.25 * Math.sin(2 * Math.PI * time * 2))}"/>`);
  out.push(`<rect x="${f(r * 0.42)}" y="${f(-r * 0.98)}" width="${f(r * 0.4)}" height="${f(r * 0.32)}" rx="2" fill="#5b6380" transform="rotate(45 ${f(r * 0.62)} ${f(-r * 0.82)})"/>`);
  // The cord burns down with the fuse; its spark flickers.
  const ex = f(r * 0.75 + r * 0.55 * remaining), ey = f(-r * 0.95 - r * 0.6 * remaining);
  out.push(`<path d="M${f(r * 0.72)} ${f(-r * 0.92)}Q${f(r * 0.75)} ${ey} ${ex} ${ey}" stroke="${C.cord}" stroke-width="${f(cell * 0.04)}" fill="none" stroke-linecap="round"/>`);
  const spark = cell * 0.09 * (0.8 + 0.4 * noise(Math.floor(time * 8) + cx));
  const star = Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4 + time * 3, d = k % 2 ? spark * 0.45 : spark;
    return `${f(ex + Math.cos(a) * d)},${f(ey + Math.sin(a) * d)}`;
  }).join(" ");
  out.push(`<polygon points="${star}" fill="${C.spark}"/><circle cx="${ex}" cy="${ey}" r="${f(spark * 0.35)}" fill="#fff"/>`);
  out.push(`<circle cx="${f(-r * 0.35)}" cy="${f(-r * 0.35)}" r="${f(r * 0.2)}" fill="#ffffff40"/>`);
  out.push(`</g>`);
}

function drawPlayer(out: string[], id: number, p: Pose, cell: number) {
  const color = PLAYER_COLORS[id], dark = shade(color, -0.45), light = shade(color, 0.55);
  const r = cell * 0.32;
  const cx = f((p.x + 0.5) * cell), cy = f((p.y + 0.5) * cell - p.hop * cell), ground = f((p.y + 0.5) * cell + r * 0.95);
  const d = p.dying;
  const scale = d === null ? 1 : 1 - easeIn(d) * 0.9;
  out.push(`<ellipse cx="${cx}" cy="${ground}" rx="${f(r * 0.8 * (1 - p.hop) * scale)}" ry="${f(r * 0.22 * scale)}" fill="#00000066"/>`);
  out.push(`<g data-player="${id}" transform="translate(${cx} ${cy}) rotate(${f(d === null ? 0 : d * 140)}) scale(${f(p.sx * scale)} ${f(p.sy * scale)})" opacity="${f(d === null ? 1 : 1 - d * d)}">`);
  for (const side of [-1, 1]) {
    const lift = side * p.step > 0 ? r * 0.14 * Math.abs(p.step) : 0;
    out.push(`<ellipse cx="${f(side * r * 0.42)}" cy="${f(r * 0.85 - lift)}" rx="${f(r * 0.26)}" ry="${f(r * 0.15)}" fill="${dark}"/>`);
  }
  const top = -r * 0.92, stroke = f(cell * 0.03);
  if (id === 0) {
    out.push(`<path d="M0 ${f(top)}Q${f(r * 0.2)} ${f(top - r * 0.35)} ${f(r * 0.08)} ${f(top - r * 0.6)}" stroke="${dark}" stroke-width="${stroke}" fill="none"/><circle cx="${f(r * 0.08)}" cy="${f(top - r * 0.6)}" r="${f(r * 0.15)}" fill="${C.spark}" stroke="${dark}" stroke-width="${stroke}"/>`);
  } else if (id === 1) {
    for (const s of [-1, 1]) out.push(`<path d="M${f(s * r * 0.62)} ${f(-r * 0.55)}L${f(s * r * 0.82)} ${f(top - r * 0.4)}L${f(s * r * 0.22)} ${f(top + r * 0.05)}Z" fill="#f1e9dc" stroke="${dark}" stroke-width="${stroke}" stroke-linejoin="round"/>`);
  } else if (id === 2) {
    out.push(`<path d="M0 ${f(top)}q${f(-r * 0.05)} ${f(-r * 0.3)} ${f(r * 0.05)} ${f(-r * 0.4)}" stroke="#4f772d" stroke-width="${stroke}" fill="none"/><ellipse cx="${f(r * 0.28)}" cy="${f(top - r * 0.42)}" rx="${f(r * 0.28)}" ry="${f(r * 0.13)}" transform="rotate(-25 ${f(r * 0.28)} ${f(top - r * 0.42)})" fill="#b5e48c" stroke="#4f772d" stroke-width="${stroke}"/>`);
  } else {
    const xs = [-0.5, -0.33, -0.17, 0, 0.17, 0.33, 0.5], ys = [0, -0.45, -0.05, -0.55, -0.05, -0.45, 0];
    out.push(`<polygon points="${xs.map((x, k) => `${f(x * r)},${f(top + r * 0.2 + ys[k] * r)}`).join(" ")}" fill="${C.spark}" stroke="${dark}" stroke-width="${stroke}" stroke-linejoin="round"/>`);
  }
  out.push(`<ellipse rx="${f(r)}" ry="${f(r * 0.95)}" fill="${color}" stroke="${dark}" stroke-width="${f(cell * 0.035)}"/>`);
  out.push(`<ellipse cx="${f(-r * 0.38)}" cy="${f(-r * 0.42)}" rx="${f(r * 0.26)}" ry="${f(r * 0.15)}" fill="${light}" opacity="0.7" transform="rotate(-30 ${f(-r * 0.38)} ${f(-r * 0.42)})"/>`);
  const look = DIRS[p.look];
  for (const side of [-1, 1]) {
    const ex = f(side * r * 0.36 + look.x * r * 0.25), ey = f(-r * 0.1 + look.y * r * 0.2);
    if (d !== null) {
      const k = f(r * 0.13);
      out.push(`<path d="M${f(ex - k)} ${f(ey - k)}L${f(ex + k)} ${f(ey + k)}M${f(ex + k)} ${f(ey - k)}L${f(ex - k)} ${f(ey + k)}" stroke="${C.ink}" stroke-width="${stroke}" stroke-linecap="round"/>`);
    } else {
      out.push(`<ellipse cx="${ex}" cy="${ey}" rx="${f(r * 0.2)}" ry="${f(r * 0.24)}" fill="#fff"/><circle cx="${f(ex + look.x * r * 0.08)}" cy="${f(ey + look.y * r * 0.08)}" r="${f(r * 0.11)}" fill="${C.ink}"/>`);
    }
  }
  out.push(`</g>`);
}

function direction(from: Pos, to: Pos): Direction {
  if (to.x > from.x) return "right";
  if (to.x < from.x) return "left";
  return to.y < from.y ? "up" : "down";
}
