import type { Frame } from "../../packages/detonarium/src/index.js";

export const SFX_KINDS = ["place", "explosion", "elimination", "pickup", "collapse", "slow-in", "slow-out"] as const;
export type SfxKind = typeof SFX_KINDS[number];
export type SoundCue = { kind: SfxKind; frame: number; time: number; tick: number; eventIds: string[]; gain: number };
type ClockFrame = { tau: number; s: number };
const gain: Record<SfxKind, number> = { place: .24, explosion: .45, elimination: .34, pickup: .26, collapse: .16, "slow-in": .21, "slow-out": .18 };

/** Uses exactly the fractional source ticks drawn by the renderer, not ticks/tps. */
export function soundCues(frames: Frame[], clock: ClockFrame[], fps: number, normal: number): SoundCue[] {
  if (!(Number.isFinite(fps) && Number.isFinite(normal) && fps > 0 && normal > 0) || clock.some((f, i) => !Number.isFinite(f.tau) || !Number.isFinite(f.s) || f.s < 0 || f.tau < 0 || (i > 0 && f.tau < clock[i - 1].tau))) throw new Error("Invalid sound clock");
  const cues: SoundCue[] = [];
  const at = (tau: number) => {
    let a = 0, b = clock.length;
    while (a < b) { const m = (a + b) >>> 1; if (clock[m].tau < tau) a = m + 1; else b = m; }
    return a;
  };
  for (let tick = 1; tick < frames.length; tick++) {
    frames[tick].events.forEach((e, i) => {
      const kind: SfxKind | undefined = e.type === "bomb_placed" ? "place" : e.type === "exploded" ? "explosion" : e.type === "eliminated" ? "elimination" : e.type === "pickup_collected" ? "pickup" : e.type === "collapse" ? "collapse" : undefined;
      if (!kind) return;
      // Blast/pop/death at their first visible frame; falling blocks thud as they land.
      const frame = at(tick - 1 + (kind === "collapse" ? .98 : 1e-7));
      if (frame >= clock.length) return;
      cues.push({ kind, frame, time: frame / fps, tick, eventIds: [`${tick}:${i}:${e.type}`], gain: gain[kind] });
    });
  }
  // Hysteresis and dwell avoid a whoosh every time a short narration lead-in ends.
  let slow = false, candidate = -1, candidateFrames = 0, lastTransition = -Infinity;
  for (let k = 0; k < clock.length; k++) {
    if (clock[k].s <= 1e-8) continue; // A hold does not change the playback mode.
    const ratio = clock[k].s / normal;
    const change = slow ? ratio > .75 : ratio < .45;
    if (!change) { candidate = -1; candidateFrames = 0; continue; }
    if (candidate < 0) candidate = k;
    candidateFrames++;
    if (candidateFrames < Math.ceil(.15 * fps) || candidate - lastTransition < .75 * fps) continue;
    const kind = slow ? "slow-out" : "slow-in";
    cues.push({ kind, frame: candidate, time: candidate / fps, tick: Math.ceil(clock[candidate].tau), eventIds: [`${kind}:${candidate}`], gain: gain[kind] });
    slow = !slow; lastTransition = candidate; candidate = -1; candidateFrames = 0;
  }
  // One controlled sound for near-simultaneous effects of the same type, retaining provenance.
  const grouped: SoundCue[] = [];
  const previous = new Map<SfxKind, SoundCue>();
  for (const cue of cues.sort((a, b) => a.frame - b.frame || a.kind.localeCompare(b.kind))) {
    const prev = previous.get(cue.kind);
    if (prev && cue.frame - prev.frame <= Math.ceil(.055 * fps)) {
      prev.eventIds.push(...cue.eventIds);
      continue;
    }
    grouped.push(cue); previous.set(cue.kind, cue);
  }
  return grouped;
}

export const SFX_SAMPLE_RATE = 48000;
const lengths: Record<SfxKind, number> = { place: .11, explosion: .7, elimination: .45, pickup: .28, collapse: .23, "slow-in": .42, "slow-out": .26 };

/** Original deterministic procedural arcade sounds; no recordings or third-party samples. */
export function synthesizeEffect(kind: SfxKind): Float32Array {
  const sr = SFX_SAMPLE_RATE, duration = lengths[kind];
  const samples = new Float32Array(Math.ceil(duration * sr));
  let seed = 173 + SFX_KINDS.indexOf(kind), phase = 0, low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sr, u = t / duration;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const attack = Math.min(1, t / .004), tail = Math.min(1, (duration - t) / .025);
    let sample = 0;
    if (kind === "place") {
      phase += 2 * Math.PI * (190 - 120 * u) / sr;
      sample = (.75 * Math.sin(phase) + .18 * noise * Math.exp(-t * 160)) * Math.exp(-t * 40);
    } else if (kind === "explosion" || kind === "collapse") {
      const explosion = kind === "explosion";
      const cutoff = explosion ? 2400 * (1 - u) ** 2 + 150 : 700 * (1 - u) + 100;
      low += (1 - Math.exp(-2 * Math.PI * cutoff / sr)) * (noise - low);
      phase += 2 * Math.PI * (explosion ? 40 + 100 * Math.exp(-t * 18) : 55 + 55 * Math.exp(-t * 25)) / sr;
      sample = (.8 * low + .4 * Math.sin(phase)) * Math.exp(-t * (explosion ? 7 : 18));
    } else if (kind === "elimination") {
      phase += 2 * Math.PI * (520 * Math.exp(-t * 5) + 60) / sr;
      sample = (.65 * Math.sin(phase) + .18 * Math.sin(phase * 2)) * Math.exp(-t * 7);
    } else if (kind === "pickup") {
      const frequency = t < .1 ? 660 : 990;
      phase += 2 * Math.PI * frequency / sr;
      const note = t < .1 ? t : t - .1;
      sample = (.65 * Math.sin(phase) + .15 * Math.sin(phase * 2)) * Math.min(1, note / .005) * Math.exp(-note * 18);
    } else {
      const sweep = kind === "slow-in" ? 1 - u : u;
      low += (1 - Math.exp(-2 * Math.PI * (250 + 3500 * sweep ** 2) / sr)) * (noise - low);
      sample = low * Math.sin(Math.PI * u) ** 1.5;
    }
    samples[i] = Math.tanh(sample * 1.6) * attack * tail * .7;
  }
  return samples;
}

export function pcmWav(samples: Float32Array, sampleRate = SFX_SAMPLE_RATE): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24); out.writeUInt32LE(sampleRate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((x, i) => out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2));
  return out;
}

export function mixEffects(cues: SoundCue[], seconds: number): { samples: Float32Array; peakBeforeLimit: number } {
  const samples = new Float32Array(Math.ceil(seconds * SFX_SAMPLE_RATE));
  const bank = new Map(SFX_KINDS.map((kind) => [kind, synthesizeEffect(kind)]));
  for (const cue of cues) {
    const clip = bank.get(cue.kind)!;
    const start = Math.round(cue.time * SFX_SAMPLE_RATE);
    for (let i = 0; i < clip.length && start + i < samples.length; i++) if (start + i >= 0) samples[start + i] += clip[i] * cue.gain;
  }
  let peak = 0;
  samples.forEach((s) => { peak = Math.max(peak, Math.abs(s)); });
  // Keep the effects stem below -6 dBFS even if different kinds coincide.
  if (peak > .5) for (let i = 0; i < samples.length; i++) samples[i] *= .5 / peak;
  return { samples, peakBeforeLimit: peak };
}
