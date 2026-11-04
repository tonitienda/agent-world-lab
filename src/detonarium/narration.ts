export type NarrationCue = {
  game: number;
  tick: number;
  text: string;
  line: number;
  audio: string;
  seconds: number;
  role: "decision" | "outcome";
};

/** Explicit editorial slow-motion ranges; these do not imply kill attribution. */
export function focusRanges(value: string, lastTick: number): [number, number][] {
  if (!value) return [];
  return value.split(",").map((part) => {
    const [from, to, extra] = part.split(":").map(Number);
    if (extra !== undefined || !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > lastTick) throw new Error(`Invalid focus range: ${part}`);
    return [from, to];
  });
}

/** Select one game's cues, including opening/final holds, without reordering ties. */
export function gameNarration(cues: NarrationCue[], game: number, lastTick: number): NarrationCue[] {
  const selected = cues.filter((cue) => cue.game === game);
  if (!selected.length) throw new Error("No narration cues match --game");
  for (const cue of selected) {
    if (!Number.isInteger(cue.tick) || cue.tick < 0 || cue.tick > lastTick || !Number.isFinite(cue.seconds) || cue.seconds <= 0 || !Number.isInteger(cue.line) || cue.line < 1 || !cue.text || !cue.audio || !["decision", "outcome"].includes(cue.role)) {
      throw new Error(`Invalid narration cue ${cue.line}`);
    }
  }
  return selected.sort((a, b) => a.tick - b.tick);
}
