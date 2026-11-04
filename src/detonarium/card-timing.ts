/** Schedule whole clips on a card, leaving lead/trailing room and whole video frames. */
export function cardTiming(cues: { line: number; audio: string; seconds: number }[], fps: number) {
  if (!Number.isInteger(fps) || fps < 1) throw new Error("Invalid card fps");
  let at = 0.25;
  const voices = cues.map((cue) => {
    if (!Number.isFinite(cue.seconds) || cue.seconds < 0.8) throw new Error(`Invalid card duration for line ${cue.line}`);
    const voice = { line: cue.line, audio: cue.audio, at };
    at += cue.seconds;
    return voice;
  });
  return { voices, frames: Math.ceil(Math.max(3, at + 0.3) * fps) };
}
