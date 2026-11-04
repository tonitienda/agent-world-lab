export type Speech = { tick: number; seconds: number; role: "decision" | "outcome"; line?: number };
export type FlowShot<T> = { tau: number; s: number; speech?: T; freeze?: T };

/** Stretch real replay motion to fit speech, preserving source order and observation anchors. */
export function flowTimeline<T extends Speech>(cues: T[], last: number, fps: number, speed: (tick: number) => number): FlowShot<T>[] {
  const out: FlowShot<T>[] = [];
  const path = (from: number, to: number) => {
    const points = [from];
    while (points.at(-1)! < to) {
      const t = points.at(-1)!;
      const s = speed(t);
      if (!Number.isFinite(s) || s <= 0) throw new Error("Replay speed must be positive");
      points.push(Math.min(to, t + s / fps));
    }
    return points;
  };
  const travel = (from: number, to: number) => {
    const points = path(from, to);
    for (let i = 1; i < points.length; i++) out.push({ tau: points[i], s: (points[i] - points[i - 1]) * fps });
  };
  let tau = 0;
  for (const [i, cue] of cues.entries()) {
    if (cue.tick > tau) travel(tau, cue.tick);
    tau = Math.max(tau, cue.tick);
    const next = cues[i + 1];
    // Same-tick observations can share a little moving anticipation, but the
    // following plan must still begin before its first action completes.
    const later = cues.slice(i + 1).find((c) => c.tick > cue.tick)?.tick ?? last;
    const end = next?.tick === cue.tick ? Math.min(later, tau + Math.min(0.2, (later - cue.tick) / 4)) : next?.tick ?? last;
    const voiceFrames = Math.ceil(cue.seconds * fps);
    if (end <= tau) {
      for (let k = 0; k < voiceFrames; k++) out.push({ tau, s: 0, speech: cue, freeze: cue });
      continue;
    }
    const points = path(tau, end);
    const lead = cue.role === "decision" ? Math.ceil(0.65 * fps) : 0;
    const count = Math.max(voiceFrames, points.length + lead);
    const sample = (k: number) => {
      const u = Math.max(0, k - lead) / Math.max(1, count - lead - 1) * (points.length - 1);
      const a = Math.min(points.length - 1, Math.floor(u));
      return points[a] + ((points[a + 1] ?? points[a]) - points[a]) * (u - a);
    };
    for (let k = 0; k < count; k++) {
      const t = sample(k);
      const speech = k < voiceFrames ? cue : undefined;
      out.push({ tau: t, s: k < lead ? 0 : (t - sample(k - 1)) * fps, speech, ...(k < lead && speech ? { freeze: speech } : {}) });
    }
    tau = end;
  }
  if (tau < last) travel(tau, last);
  return out;
}
