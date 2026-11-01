import type { Analysis } from "./analysis.js";
import { replayPositions, type ChessReplay, type Result, type Side } from "./match.js";
import type { Callout } from "./story.js";

export const FRAME = { width: 1920, height: 1080 };
const SQUARE = 120;
const BOARD = { x: 60, y: 60 };
const BAR = { x: 1032, width: 36 };
const PANEL = { x: 1092, width: 768 };
const COLORS = {
  bg: "#0d0f15", panel: "#171a24", card: "#1c2030", text: "#e6e8ef", muted: "#8a90a2", accent: "#ffd166",
  light: "#ead9b9", dark: "#b0835c", highlight: "#f6d55c", check: "#e5484d", bad: "#ff8a80", info: "#7cc4ff",
};
const TONES: Record<Callout["tone"], { fill: string; text: string }> = {
  highlight: { fill: "#ffd166", text: "#1a1405" },
  alert: { fill: "#e5484d", text: "#ffffff" },
  info: { fill: "#2b3a55", text: "#e6f2ff" },
};
const GLYPHS: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const FILES = "abcdefgh";
const FONT = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;
const GLYPH_FONT = `font-family="Apple Symbols, DejaVu Sans, Segoe UI Symbol"`;

type Pieces = Map<string, string>;

/** Square name -> FEN piece letter (uppercase white). */
function piecesOf(fen: string): Pieces {
  const pieces: Pieces = new Map();
  fen.split(" ")[0].split("/").forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else pieces.set(`${FILES[f++]}${8 - r}`, ch);
    }
  });
  return pieces;
}

/** Opponent pieces each side has taken (most valuable first) and its material lead. */
function material(pieces: Pieces): Record<Side, { taken: string[]; lead: number }> {
  const count = (white: boolean) => {
    const c: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
    for (const p of pieces.values()) if ((p === p.toUpperCase()) === white && p.toLowerCase() in c) c[p.toLowerCase()]++;
    return c;
  };
  const w = count(true), b = count(false);
  const sum = (c: Record<string, number>) => Object.entries(c).reduce((s, [k, n]) => s + VALUES[k] * n, 0);
  const missing = (c: Record<string, number>) =>
    ["q", "r", "b", "n", "p"].flatMap((k) => Array(Math.max(0, START_COUNT[k] - c[k])).fill(k));
  const lead = sum(w) - sum(b);
  return { white: { taken: missing(b), lead }, black: { taken: missing(w), lead: -lead } };
}

function squareXY(square: string, flip: boolean): [number, number] {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]) - 1;
  return [BOARD.x + (flip ? 7 - f : f) * SQUARE, BOARD.y + (flip ? r : 7 - r) * SQUARE];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const svg = (body: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}" viewBox="0 0 ${FRAME.width} ${FRAME.height}">${body.join("")}</svg>`;

function piece(letter: string, x: number, y: number, opacity = 1): string {
  const white = letter === letter.toUpperCase();
  const fill = white ? "#fbfbf8" : "#1c1c22";
  const stroke = white ? "#2a2a2a" : "#f0e6d2";
  return `<text x="${x + SQUARE / 2}" y="${y + SQUARE / 2 + 4}" fill="${fill}" stroke="${stroke}" stroke-width="${white ? 1.6 : 0.8}" opacity="${opacity}">${GLYPHS[letter.toLowerCase()]}</text>`;
}

/** Pieces that travel during a move: the mover plus the rook when castling. */
function travellers(uci: string, before: Pieces): { letter: string; from: string; to: string }[] {
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const letter = before.get(from)!;
  const list = [{ letter, from, to }];
  if (letter.toLowerCase() === "k" && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2) {
    const rank = from[1];
    const kingside = to[0] === "g";
    const rookFrom = `${kingside ? "h" : "a"}${rank}`;
    list.push({ letter: before.get(rookFrom)!, from: rookFrom, to: `${kingside ? "f" : "d"}${rank}` });
  }
  return list;
}

export type FrameOptions = {
  /** Plies applied so far; the move at index `ply - 1` is animating while t < 1. */
  ply: number;
  /** Progress through that move, 0..1. */
  t: number;
  /** View the board from black's side. */
  flip?: boolean;
  title?: string;
  /** Agent's public intention, shown under the move list. */
  caption?: string;
  callout?: Callout;
  /** Seconds since the callout appeared (drives its pop-in). */
  calloutAge?: number;
  /** Rejected move on show: square to cross out, the piece(s) it meant to move, and its index in replay.illegal. */
  illegal?: { square: string | null; index: number; from?: string[] };
  thinking?: Side;
  /** Video time in seconds, for looping animations. */
  clock?: number;
  /** White's win chance (0-100) for the win bar; omit to hide it. */
  whiteWin?: number;
  /** Precomputed positions (replayPositions) to avoid replaying per frame. */
  positions?: string[];
};

function resultLine(result: Result, replay: ChessReplay): string {
  const how = result.termination.replace(/-/g, " ");
  return result.winner ? `${replay.players[result.winner].label} wins by ${how}` : `Draw by ${how}`;
}

export function renderFrame(replay: ChessReplay, options: FrameOptions): string {
  const positions = options.positions ?? replayPositions(replay);
  const { ply, flip = false } = options;
  const t = ply === 0 ? 1 : clamp01(options.t);
  const after = piecesOf(positions[ply]);
  const before = ply > 0 ? piecesOf(positions[ply - 1]) : after;
  const move = ply > 0 ? replay.moves[ply - 1] : undefined;
  const out: string[] = [`<rect width="${FRAME.width}" height="${FRAME.height}" fill="${COLORS.bg}"/>`];

  // Board, last-move highlight and coordinates.
  for (let f = 0; f < 8; f++)
    for (let r = 1; r <= 8; r++) {
      const sq = `${FILES[f]}${r}`;
      const [x, y] = squareXY(sq, flip);
      out.push(`<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="${(f + r) % 2 ? COLORS.dark : COLORS.light}"/>`);
      if (move && (sq === move.uci.slice(0, 2) || sq === move.uci.slice(2, 4)))
        out.push(`<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="${COLORS.highlight}" opacity="${0.45 * t}"/>`);
    }
  for (let i = 0; i < 8; i++) {
    const file = flip ? FILES[7 - i] : FILES[i];
    const rank = flip ? i + 1 : 8 - i;
    out.push(`<text x="${BOARD.x + i * SQUARE + SQUARE - 8}" y="${BOARD.y + 8 * SQUARE - 8}" font-size="18" text-anchor="end" fill="${i % 2 ? COLORS.dark : COLORS.light}" ${FONT} font-weight="700">${file}</text>`);
    out.push(`<text x="${BOARD.x + 6}" y="${BOARD.y + i * SQUARE + 22}" font-size="18" fill="${i % 2 ? COLORS.light : COLORS.dark}" ${FONT} font-weight="700">${rank}</text>`);
  }

  // Check glow on the king of the side to move once the move has landed.
  if (t === 1 && move && /[+#]$/.test(move.san)) {
    const king = move.side === "white" ? "k" : "K";
    const sq = [...after].find(([, p]) => p === king)?.[0];
    if (sq) {
      const [x, y] = squareXY(sq, flip);
      out.push(`<circle cx="${x + SQUARE / 2}" cy="${y + SQUARE / 2}" r="${SQUARE * 0.48}" fill="${COLORS.check}" opacity="0.55"/>`);
    }
  }

  const origins = options.illegal?.from ?? [];
  for (const sq of origins) {
    const [x, y] = squareXY(sq, flip);
    out.push(`<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="${COLORS.check}" opacity="0.3"/>`);
  }

  out.push(`<g ${GLYPH_FONT} font-size="${SQUARE * 0.82}" text-anchor="middle" dominant-baseline="central">`);
  if (!move || t === 1) {
    for (const [sq, p] of after) out.push(piece(p, ...squareXY(sq, flip)));
  } else {
    const moving = travellers(move.uci, before);
    const origins = new Set(moving.map((m) => m.from));
    for (const [sq, p] of before) {
      if (origins.has(sq)) continue;
      // Captured pieces (including en passant) fade as the attacker arrives.
      const captured = after.get(sq) !== p;
      out.push(piece(p, ...squareXY(sq, flip), captured ? 1 - ease(t) : 1));
    }
    const k = ease(t);
    for (const m of moving) {
      const [x0, y0] = squareXY(m.from, flip);
      const [x1, y1] = squareXY(m.to, flip);
      out.push(piece(m.letter, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k));
    }
  }
  out.push(`</g>`);

  for (const sq of origins) {
    const [x, y] = squareXY(sq, flip);
    out.push(`<rect x="${x + 4}" y="${y + 4}" width="${SQUARE - 8}" height="${SQUARE - 8}" rx="8" fill="none" stroke="${COLORS.check}" stroke-width="6"/>`);
  }
  // With a single suspect piece, a dashed arrow spells out the attempted move.
  if (origins.length === 1 && options.illegal?.square && origins[0] !== options.illegal.square) {
    const [x0, y0] = squareXY(origins[0], flip).map((v) => v + SQUARE / 2);
    const [x1, y1] = squareXY(options.illegal.square, flip).map((v) => v + SQUARE / 2);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
    const [sx, sy] = [x0 + ux * SQUARE * 0.42, y0 + uy * SQUARE * 0.42];
    const [ex, ey] = [x1 - ux * SQUARE * 0.5, y1 - uy * SQUARE * 0.5];
    const head = (side: number) => `${ex - ux * 26 + side * uy * 16},${ey - uy * 26 - side * ux * 16}`;
    out.push(`<line x1="${sx}" y1="${sy}" x2="${ex - ux * 20}" y2="${ey - uy * 20}" stroke="${COLORS.check}" stroke-width="10" stroke-dasharray="18 12" stroke-linecap="round" opacity="0.9"/>`);
    out.push(`<polygon points="${ex},${ey} ${head(1)} ${head(-1)}" fill="${COLORS.check}" opacity="0.9"/>`);
  }
  if (options.illegal?.square) {
    const [x, y] = squareXY(options.illegal.square, flip);
    const pad = 22;
    out.push(`<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="${COLORS.check}" opacity="0.35"/>`);
    out.push(`<path d="M${x + pad} ${y + pad} L${x + SQUARE - pad} ${y + SQUARE - pad} M${x + SQUARE - pad} ${y + pad} L${x + pad} ${y + SQUARE - pad}" stroke="${COLORS.check}" stroke-width="14" stroke-linecap="round"/>`);
  }
  if (options.whiteWin !== undefined) out.push(...winBar(options.whiteWin, flip));
  out.push(...panel(replay, ply, t, options, material(t === 1 ? after : before)));
  if (options.callout) out.push(callout(options.callout, options.calloutAge ?? 1));
  return svg(out);
}

/** Banner between the player cards and the move list that pops in over its first ~0.25 s. */
function callout(c: Callout, age: number): string {
  const k = clamp01(age / 0.25);
  const scale = 0.85 + 0.15 * (1 - (1 - k) ** 3);
  const width = PANEL.width - 48;
  const cx = PANEL.x + PANEL.width / 2, cy = 420;
  const tone = TONES[c.tone];
  return `<g opacity="${k}" transform="translate(${cx} ${cy}) scale(${scale})">` +
    `<rect x="${-width / 2}" y="-40" width="${width}" height="80" rx="40" fill="#000" opacity="0.35" transform="translate(0 6)"/>` +
    `<rect x="${-width / 2}" y="-40" width="${width}" height="80" rx="40" fill="${tone.fill}"/>` +
    `<text y="12" font-size="36" font-weight="700" text-anchor="middle" fill="${tone.text}" ${FONT}>${esc(c.text)}</text></g>`;
}

/** Vertical tug-of-war bar: white's share fills from white's side of the board. */
function winBar(whiteWin: number, flip: boolean): string[] {
  const h = 8 * SQUARE, y = BOARD.y, x = BAR.x, w = BAR.width;
  const whiteH = (h * whiteWin) / 100;
  const whiteY = flip ? y : y + h - whiteH;
  const leader = whiteWin >= 50 ? "white" : "black";
  const pct = Math.round(leader === "white" ? whiteWin : 100 - whiteWin);
  const labelY = (leader === "white") !== flip ? y + h - 12 : y + 24;
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#26262c"/>`,
    `<rect x="${x}" y="${whiteY}" width="${w}" height="${whiteH}" fill="#f2f2ee"/>`,
    `<line x1="${x - 4}" x2="${x + w + 4}" y1="${y + h / 2}" y2="${y + h / 2}" stroke="${COLORS.accent}" stroke-width="2" opacity="0.7"/>`,
    `<text x="${x + w / 2}" y="${labelY}" font-size="15" font-weight="700" text-anchor="middle" fill="${leader === "white" ? "#26262c" : "#f2f2ee"}" ${FONT}>${pct}</text>`,
  ];
}

function panel(replay: ChessReplay, ply: number, t: number, options: FrameOptions, mat: ReturnType<typeof material>): string[] {
  const out: string[] = [];
  const x = PANEL.x, w = PANEL.width;
  out.push(`<rect x="${x}" y="60" width="${w}" height="960" rx="16" fill="${COLORS.panel}"/>`);
  out.push(`<text x="${x + 32}" y="112" font-size="30" font-weight="700" fill="${COLORS.accent}" ${FONT}>${esc(options.title ?? "Chess")}</text>`);

  const played = replay.moves.slice(0, ply);
  const toMove: Side = played.length ? (played.at(-1)!.side === "white" ? "black" : "white") : (replay.startFen.split(" ")[1] === "b" ? "black" : "white");
  const over = ply === replay.moves.length && replay.result !== null && t === 1;
  const sides: Side[] = options.flip ? ["white", "black"] : ["black", "white"];
  sides.forEach((side, i) => {
    const y = 150 + i * 110;
    const player = replay.players[side];
    const shown = options.illegal?.index ?? -1;
    // While the side thinks about its next move with no attempt on show, its rejected attempts at
    // that move have already been shown (the story plays them before the narration).
    const after = options.thinking === side && !options.illegal;
    const illegal = replay.illegal.filter((a, k) => a.side === side && (a.ply <= ply || k <= shown || (after && a.ply === ply + 1))).length;
    const thinking = played.filter((m) => m.side === side);
    const avg = thinking.length ? thinking.reduce((s, m) => s + m.thinkMs, 0) / thinking.length / 1000 : 0;
    const active = !over && side === toMove;
    out.push(`<rect x="${x + 24}" y="${y}" width="${w - 48}" height="92" rx="12" fill="${active ? "#232838" : COLORS.card}" stroke="${active ? COLORS.accent : "none"}" stroke-width="2"/>`);
    out.push(`<circle cx="${x + 64}" cy="${y + 46}" r="18" fill="${side === "white" ? "#fbfbf8" : "#1c1c22"}" stroke="${COLORS.muted}" stroke-width="2"/>`);
    out.push(`<text x="${x + 100}" y="${y + 40}" font-size="28" font-weight="700" fill="${COLORS.text}" ${FONT}>${esc(player.label)}</text>`);
    if (options.thinking === side) {
      const phase = Math.floor((options.clock ?? 0) * 3) % 4;
      out.push(`<text x="${x + 100}" y="${y + 72}" font-size="20" fill="${COLORS.accent}" ${FONT}>thinking${".".repeat(phase)}</text>`);
    } else
      out.push(`<text x="${x + 100}" y="${y + 72}" font-size="20" fill="${COLORS.muted}" ${FONT}>${player.kind === "agent" ? "LLM agent" : "engine"} · avg ${avg.toFixed(1)} s/move</text>`);
    // Captured pieces and material lead, right-aligned.
    const { taken, lead } = mat[side];
    const glyphs = taken.map((k) => GLYPHS[k]).join("");
    const enemyWhite = side === "black";
    out.push(`<text x="${x + w - 48}" y="${y + 44}" font-size="38" text-anchor="end" ${GLYPH_FONT} fill="${enemyWhite ? "#fbfbf8" : "#1c1c22"}" stroke="${enemyWhite ? "#2a2a2a" : "#c9ccd6"}" stroke-width="${enemyWhite ? 1 : 1.2}">${glyphs}</text>`);
    if (lead > 0) out.push(`<text x="${x + w - 48}" y="${y + 74}" font-size="22" font-weight="700" text-anchor="end" fill="${COLORS.accent}" ${FONT}>+${lead}</text>`);
    if (player.kind === "agent")
      out.push(`<text x="${x + w - (lead > 0 ? 110 : 48)}" y="${y + 74}" font-size="20" text-anchor="end" fill="${illegal ? COLORS.bad : COLORS.muted}" ${FONT}>${illegal} illegal</text>`);
  });

  // Caption (agent intention, or its longer rationale) or the final result. Long captions get a
  // smaller font and a taller box, which the move list makes room for.
  const footer = over ? resultLine(replay.result!, replay) : options.caption;
  const long = !over && !!footer && wrap(`“${footer}”`, 44).length > 3;
  const style = over ? { size: 32, chars: 44, lh: 34, max: 3 } : long ? { size: 23, chars: 56, lh: 29, max: 8 } : { size: 27, chars: 44, lh: 34, max: 3 };
  const lines = footer ? wrap(over ? footer : `“${footer}”`, style.chars) : [];
  if (lines.length > style.max) lines.splice(style.max - 1, Infinity, lines.slice(style.max - 1).join(" ").slice(0, style.chars - 2) + "…”");
  const boxTop = over || !lines.length ? 840 : Math.min(840, 996 - (96 + (lines.length - 1) * style.lh));

  // Move list: the last rows that fit above the caption, current move highlighted.
  const rows: string[][] = [];
  for (const m of played) {
    if (m.side === "white" || !rows.length) rows.push([m.side === "white" ? m.san : "…", m.side === "black" ? m.san : ""]);
    else rows.at(-1)![1] = m.san;
  }
  const firstMove = Number(replay.startFen.split(" ")[5] ?? 1);
  const visible = Math.max(1, Math.min(8, Math.floor((boxTop - 30 - 510) / 40) + 1));
  const start = Math.max(0, rows.length - visible);
  rows.slice(start).forEach(([wm, bm], i) => {
    const y = 510 + i * 40;
    const n = start + i;
    const last = n === rows.length - 1;
    out.push(`<text x="${x + 40}" y="${y}" font-size="24" fill="${COLORS.muted}" ${FONT}>${firstMove + n}.</text>`);
    out.push(`<text x="${x + 120}" y="${y}" font-size="26" fill="${last && !bm ? COLORS.accent : COLORS.text}" ${FONT}>${esc(wm)}</text>`);
    out.push(`<text x="${x + 300}" y="${y}" font-size="26" fill="${last && bm ? COLORS.accent : COLORS.text}" ${FONT}>${esc(bm)}</text>`);
  });

  if (footer) {
    const agentLabel = Object.values(replay.players).find((p) => p.kind === "agent")?.label;
    out.push(`<rect x="${x + 24}" y="${boxTop}" width="${w - 48}" height="${996 - boxTop}" rx="12" fill="${over ? "#3a2f12" : COLORS.card}"/>`);
    if (!over && agentLabel) out.push(`<text x="${x + 48}" y="${boxTop + 36}" font-size="18" fill="${COLORS.muted}" ${FONT}>${esc(agentLabel)} says</text>`);
    lines.forEach((line, i) =>
      out.push(over
        ? `<text x="${x + 48}" y="${900 + i * 34}" font-size="32" font-weight="700" fill="${COLORS.accent}" ${FONT}>${esc(line)}</text>`
        : `<text x="${x + 48}" y="${boxTop + 74 + i * style.lh}" font-size="${style.size}" font-style="italic" fill="${COLORS.text}" ${FONT}>${esc(line)}</text>`));
  }
  return out;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > width) (lines.push(line), (line = word));
    else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

export type CardOptions = {
  title?: string;
  /** Channel wordmark on the intro splash, shown a beat before the rest. */
  channel?: string;
  /** One line under each player in the intro; defaults describe agent/engine. */
  notes?: Partial<Record<Side, string>>;
  /** Closing hook on the outro, e.g. "Next: Stockfish 2000". */
  next?: string;
  /** 0..1 progress through the card, for fades. */
  t?: number;
};

function engineNote(label: string): string {
  const elo = /(\d{4})/.exec(label)?.[1];
  if (!elo) return "Chess engine at full strength";
  const n = Number(elo);
  const tier = n < 1400 ? "a casual player" : n < 1700 ? "an average club player" : n < 2000 ? "a strong club player" : n < 2300 ? "an expert" : "a master";
  return `Chess engine capped at Elo ${elo}, about ${tier}`;
}

export function renderIntro(replay: ChessReplay, options: CardOptions = {}): string {
  const t = options.t ?? 1;
  const out = [`<rect width="${FRAME.width}" height="${FRAME.height}" fill="${COLORS.bg}"/>`];
  if (options.channel) {
    // Wordmark between two thin rules; it lands first, then the match card fades in under it.
    const name = options.channel.toUpperCase();
    const half = name.length * 13 + 40;
    out.push(`<g opacity="${clamp01(t * 6)}">`);
    out.push(`<text x="960" y="138" font-size="28" font-weight="700" letter-spacing="8" text-anchor="middle" fill="${COLORS.text}" ${FONT}>${esc(name)}</text>`);
    for (const dir of [-1, 1]) out.push(`<line x1="${960 + dir * half}" y1="128" x2="${960 + dir * (half + 120)}" y2="128" stroke="${COLORS.accent}" stroke-width="2"/>`);
    out.push(`</g>`);
  }
  out.push(`<g opacity="${options.channel ? clamp01((t - 0.1) * 5) : clamp01(t * 4)}">`);
  out.push(`<text x="960" y="230" font-size="40" font-weight="700" text-anchor="middle" fill="${COLORS.accent}" ${FONT}>${esc(options.title ?? "Chess")}</text>`);
  (["white", "black"] as const).forEach((side, i) => {
    const p = replay.players[side];
    const x = i === 0 ? 220 : 1020;
    const note = options.notes?.[side] ?? (p.kind === "agent" ? "Language model. Sees only the board: no move list, no hints" : engineNote(p.label));
    out.push(`<rect x="${x}" y="320" width="680" height="380" rx="20" fill="${COLORS.panel}"/>`);
    out.push(`<text x="${x + 340}" y="440" font-size="110" text-anchor="middle" ${GLYPH_FONT} fill="${side === "white" ? "#fbfbf8" : "#1c1c22"}" stroke="${side === "white" ? "#2a2a2a" : "#f0e6d2"}" stroke-width="1.5">♚</text>`);
    out.push(`<text x="${x + 340}" y="540" font-size="44" font-weight="700" text-anchor="middle" fill="${COLORS.text}" ${FONT}>${esc(p.label)}</text>`);
    out.push(`<text x="${x + 340}" y="580" font-size="22" text-anchor="middle" fill="${COLORS.muted}" ${FONT}>plays ${side}</text>`);
    wrap(note, 40).forEach((line, j) =>
      out.push(`<text x="${x + 340}" y="${630 + j * 30}" font-size="22" text-anchor="middle" fill="${COLORS.text}" ${FONT}>${esc(line)}</text>`));
  });
  out.push(`<text x="960" y="530" font-size="56" font-weight="700" text-anchor="middle" fill="${COLORS.accent}" ${FONT}>vs</text>`);
  out.push(`<text x="960" y="820" font-size="26" text-anchor="middle" fill="${COLORS.muted}" ${FONT}>Illegal moves are rejected and counted. The bar shows who is winning.</text>`);
  out.push(`</g>`);
  return svg(out);
}

export function renderOutro(replay: ChessReplay, analysis: Analysis | null, options: CardOptions = {}): string {
  const fade = clamp01((options.t ?? 1) * 4);
  const out = [`<rect width="${FRAME.width}" height="${FRAME.height}" fill="${COLORS.bg}"/>`, `<g opacity="${fade}">`];
  out.push(`<text x="960" y="130" font-size="52" font-weight="700" text-anchor="middle" fill="${COLORS.accent}" ${FONT}>${esc(replay.result ? resultLine(replay.result, replay) : "Game unfinished")}</text>`);
  out.push(`<text x="960" y="180" font-size="24" text-anchor="middle" fill="${COLORS.muted}" ${FONT}>${Math.ceil(replay.moves.length / 2)} moves</text>`);

  // Stats per player.
  const rows: [string, (side: Side) => string][] = [
    ["Average think time", (s) => {
      const ms = replay.moves.filter((m) => m.side === s);
      return ms.length ? `${(ms.reduce((a, m) => a + m.thinkMs, 0) / ms.length / 1000).toFixed(1)} s` : "–";
    }],
    ["Illegal move attempts", (s) => String(replay.illegal.filter((a) => a.side === s).length)],
    ...(analysis ? [
      ["Mistakes", (s: Side) => String(analysis.moves.filter((m, i) => replay.moves[i].side === s && m.grade === "mistake").length)],
      ["Blunders", (s: Side) => String(analysis.moves.filter((m, i) => replay.moves[i].side === s && m.grade === "blunder").length)],
    ] as [string, (side: Side) => string][] : []),
  ];
  out.push(`<rect x="160" y="230" width="1600" height="${80 + rows.length * 50}" rx="16" fill="${COLORS.panel}"/>`);
  out.push(`<text x="1060" y="282" font-size="26" font-weight="700" text-anchor="middle" fill="${COLORS.text}" ${FONT}>${esc(replay.players.white.label)}</text>`);
  out.push(`<text x="1480" y="282" font-size="26" font-weight="700" text-anchor="middle" fill="${COLORS.text}" ${FONT}>${esc(replay.players.black.label)}</text>`);
  rows.forEach(([label, value], i) => {
    const y = 336 + i * 50;
    out.push(`<text x="220" y="${y}" font-size="26" fill="${COLORS.muted}" ${FONT}>${label}</text>`);
    out.push(`<text x="1060" y="${y}" font-size="28" text-anchor="middle" fill="${COLORS.text}" ${FONT}>${value("white")}</text>`);
    out.push(`<text x="1480" y="${y}" font-size="28" text-anchor="middle" fill="${COLORS.text}" ${FONT}>${value("black")}</text>`);
  });

  // Win-chance graph for the agent (or white), with turning points marked.
  if (analysis) {
    const agentSide: Side = replay.players.black.kind === "agent" && replay.players.white.kind !== "agent" ? "black" : "white";
    const gx = 160, gy = 330 + rows.length * 50 + 70, gw = 1600, gh = 1000 - gy - (options.next ? 70 : 20);
    const n = analysis.positions.length - 1 || 1;
    const pad = 24;
    const pt = (i: number) => {
      const v = analysis.positions[i].white;
      const mine = agentSide === "white" ? v : 100 - v;
      return [gx + (gw * i) / n, gy + pad + ((gh - 2 * pad) * (100 - mine)) / 100];
    };
    const reveal = clamp01(((options.t ?? 1) - 0.1) / 0.5);
    const shown = Math.max(1, Math.round(n * reveal));
    out.push(`<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="12" fill="${COLORS.panel}"/>`);
    out.push(`<line x1="${gx}" x2="${gx + gw}" y1="${gy + gh / 2}" y2="${gy + gh / 2}" stroke="${COLORS.muted}" stroke-dasharray="6 8" opacity="0.6"/>`);
    out.push(`<text x="${gx}" y="${gy - 14}" font-size="22" fill="${COLORS.muted}" ${FONT}>${esc(replay.players[agentSide].label)}'s chance of winning</text>`);
    const line = Array.from({ length: shown + 1 }, (_, i) => pt(i).join(",")).join(" ");
    out.push(`<polygon points="${gx},${gy + gh} ${line} ${pt(shown)[0]},${gy + gh}" fill="${COLORS.accent}" opacity="0.15"/>`);
    out.push(`<polyline points="${line}" fill="none" stroke="${COLORS.accent}" stroke-width="4" stroke-linejoin="round"/>`);
    analysis.moves.forEach((m, i) => {
      if (i + 1 > shown || (m.grade !== "mistake" && m.grade !== "blunder")) return;
      const [px, py] = pt(i + 1);
      const mine = replay.moves[i].side === agentSide;
      out.push(`<circle cx="${px}" cy="${py}" r="${m.grade === "blunder" ? 11 : 8}" fill="${mine ? COLORS.check : COLORS.info}" stroke="${COLORS.bg}" stroke-width="3"/>`);
    });
    out.push(`<text x="${gx + gw}" y="${gy - 14}" font-size="20" text-anchor="end" fill="${COLORS.muted}" ${FONT}><tspan fill="${COLORS.check}">●</tspan> ${esc(replay.players[agentSide].label)} mistake   <tspan fill="${COLORS.info}">●</tspan> opponent mistake</text>`);
  }
  if (options.next) out.push(`<text x="960" y="1040" font-size="34" font-weight="700" text-anchor="middle" fill="${COLORS.accent}" ${FONT}>${esc(options.next)}</text>`);
  out.push(`</g>`);
  return svg(out);
}
