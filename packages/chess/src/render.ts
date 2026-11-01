import { replayPositions, type ChessReplay, type Result, type Side } from "./match.js";

export const FRAME = { width: 1920, height: 1080 };
const SQUARE = 120;
const BOARD = { x: 60, y: 60 };
const PANEL = { x: 1080, width: 780 };
const COLORS = {
  bg: "#0d0f15", panel: "#171a24", text: "#e6e8ef", muted: "#8a90a2", accent: "#ffd166",
  light: "#ead9b9", dark: "#b0835c", highlight: "#f6d55c", check: "#e5484d", bad: "#ff8a80",
};
const GLYPHS: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";

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

function squareXY(square: string, flip: boolean): [number, number] {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]) - 1;
  const col = flip ? 7 - f : f;
  const row = flip ? r : 7 - r;
  return [BOARD.x + col * SQUARE, BOARD.y + row * SQUARE];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

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
  /** Large line under the board header, e.g. the mover's public intention. */
  caption?: string;
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
  const t = ply === 0 ? 1 : Math.min(1, Math.max(0, options.t));
  const after = piecesOf(positions[ply]);
  const before = ply > 0 ? piecesOf(positions[ply - 1]) : after;
  const move = ply > 0 ? replay.moves[ply - 1] : undefined;
  const out: string[] = [];

  out.push(`<rect width="${FRAME.width}" height="${FRAME.height}" fill="${COLORS.bg}"/>`);

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
    out.push(`<text x="${BOARD.x + i * SQUARE + SQUARE - 8}" y="${BOARD.y + 8 * SQUARE - 8}" font-size="18" text-anchor="end" fill="${i % 2 ? COLORS.dark : COLORS.light}" font-family="Helvetica, Arial, sans-serif" font-weight="700">${file}</text>`);
    out.push(`<text x="${BOARD.x + 6}" y="${BOARD.y + i * SQUARE + 22}" font-size="18" fill="${i % 2 ? COLORS.light : COLORS.dark}" font-family="Helvetica, Arial, sans-serif" font-weight="700">${rank}</text>`);
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

  out.push(`<g font-family="Apple Symbols, DejaVu Sans, Segoe UI Symbol" font-size="${SQUARE * 0.82}" text-anchor="middle" dominant-baseline="central">`);
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

  out.push(...panel(replay, ply, t, options));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}" viewBox="0 0 ${FRAME.width} ${FRAME.height}">${out.join("")}</svg>`;
}

function panel(replay: ChessReplay, ply: number, t: number, options: FrameOptions): string[] {
  const out: string[] = [];
  const font = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;
  const x = PANEL.x, w = PANEL.width;
  out.push(`<rect x="${x}" y="60" width="${w}" height="960" rx="16" fill="${COLORS.panel}"/>`);
  out.push(`<text x="${x + 32}" y="112" font-size="30" font-weight="700" fill="${COLORS.accent}" ${font}>${esc(options.title ?? "Chess")}</text>`);

  const played = replay.moves.slice(0, ply);
  const toMove: Side = played.length ? (played.at(-1)!.side === "white" ? "black" : "white") : (replay.startFen.split(" ")[1] === "b" ? "black" : "white");
  const over = ply === replay.moves.length && replay.result !== null && t === 1;
  const sides: Side[] = options.flip ? ["white", "black"] : ["black", "white"];
  sides.forEach((side, i) => {
    const y = 150 + i * 110;
    const player = replay.players[side];
    const illegal = replay.illegal.filter((a) => a.side === side && a.ply <= ply).length;
    const thinking = played.filter((m) => m.side === side);
    const avg = thinking.length ? thinking.reduce((s, m) => s + m.thinkMs, 0) / thinking.length / 1000 : 0;
    const active = !over && side === toMove;
    out.push(`<rect x="${x + 24}" y="${y}" width="${w - 48}" height="92" rx="12" fill="${active ? "#232838" : "#1c2030"}" stroke="${active ? COLORS.accent : "none"}" stroke-width="2"/>`);
    out.push(`<circle cx="${x + 64}" cy="${y + 46}" r="18" fill="${side === "white" ? "#fbfbf8" : "#1c1c22"}" stroke="${COLORS.muted}" stroke-width="2"/>`);
    out.push(`<text x="${x + 100}" y="${y + 40}" font-size="28" font-weight="700" fill="${COLORS.text}" ${font}>${esc(player.label)}</text>`);
    out.push(`<text x="${x + 100}" y="${y + 72}" font-size="20" fill="${COLORS.muted}" ${font}>${player.kind === "agent" ? "LLM agent" : "engine"} · avg ${avg.toFixed(1)} s/move</text>`);
    if (player.kind === "agent")
      out.push(`<text x="${x + w - 48}" y="${y + 56}" font-size="22" text-anchor="end" fill="${illegal ? COLORS.bad : COLORS.muted}" ${font}>${illegal} illegal</text>`);
  });

  // Move list: the last rows that fit, current move highlighted.
  const rows: string[][] = [];
  for (const m of played) {
    if (m.side === "white" || !rows.length) rows.push([m.side === "white" ? m.san : "…", m.side === "black" ? m.san : ""]);
    else rows.at(-1)![1] = m.san;
  }
  const firstMove = Number(replay.startFen.split(" ")[5] ?? 1);
  const visible = 11;
  const start = Math.max(0, rows.length - visible);
  rows.slice(start).forEach(([wm, bm], i) => {
    const y = 420 + i * 40;
    const n = start + i;
    const last = n === rows.length - 1;
    out.push(`<text x="${x + 40}" y="${y}" font-size="24" fill="${COLORS.muted}" ${font}>${firstMove + n}.</text>`);
    out.push(`<text x="${x + 120}" y="${y}" font-size="26" fill="${last && !bm ? COLORS.accent : COLORS.text}" ${font}>${esc(wm)}</text>`);
    out.push(`<text x="${x + 300}" y="${y}" font-size="26" fill="${last && bm ? COLORS.accent : COLORS.text}" ${font}>${esc(bm)}</text>`);
  });

  // Caption (agent intention) or the final result.
  const footer = over ? resultLine(replay.result!, replay) : options.caption;
  if (footer) {
    out.push(`<rect x="${x + 24}" y="880" width="${w - 48}" height="116" rx="12" fill="${over ? "#3a2f12" : "#1c2030"}"/>`);
    wrap(footer, 46).slice(0, 3).forEach((line, i) =>
      out.push(`<text x="${x + 48}" y="${922 + i * 32}" font-size="${over ? 30 : 24}" font-weight="${over ? 700 : 400}" fill="${over ? COLORS.accent : COLORS.text}" ${font}>${esc(line)}</text>`));
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
