// Candidate bullet-time moments in a recorded Detonarium session: the agent's kills (traps
// included), its elimination, and near misses. Each moment names the tick where the agent
// decided and the tick where it paid off, plus the tool call (and intention) behind it.
// Dependency-free; the editor chooses which candidates make the cut.
import { replayFrames, type Frame, type MatchEvent, type Pos, type Replay } from "../../packages/detonarium/src/index.js";
import { AGENT, type CallRecord } from "./session.js";

export type MomentKind = "kill" | "death" | "near_miss";

export type Moment = {
  kind: MomentKind;
  /** Frame at which the deciding action took effect (frame n is the result of tick n). */
  decisionTick: number;
  /** Frame of the outcome: the elimination, or the explosion that missed. */
  payoffTick: number;
  /** The agent bomb behind a kill or a self-elimination. */
  bomb?: Pos;
  victims: number[];
  /** Who else's blast was involved, for kills shared with a rival or deaths. */
  by?: number[] | "collapse";
  call?: CallRecord;
  summary: string;
};

type Exploded = Extract<MatchEvent, { type: "exploded" }>;
type Eliminated = Extract<MatchEvent, { type: "eliminated" }>;
const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
const distance = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The call whose ticks produced frame `frame` (tick index frame - 1). */
export function callForFrame(calls: CallRecord[], frame: number): CallRecord | undefined {
  return calls.find((c) => c.tickStart <= frame - 1 && frame - 1 < c.tickEnd);
}

export function findMoments(replay: Replay, calls: CallRecord[], options: { nearMissDistance?: number } = {}): Moment[] {
  return findMomentsInFrames(replayFrames(replay), replay.players.map((p) => p.name), calls, options);
}

/** Same as findMoments, for frames already rebuilt (frame 0 is the start). */
export function findMomentsInFrames(frames: Frame[], names: string[], calls: CallRecord[], options: { nearMissDistance?: number } = {}): Moment[] {
  const near = options.nearMissDistance ?? 1;
  const moments: Moment[] = [];

  /** The frame where the agent placed the bomb that exploded at `pos` on frame `n`. */
  const placedAt = (pos: Pos, n: number) => {
    for (let k = n; k > 0; k--) if (frames[k].events.some((e) => e.type === "bomb_placed" && e.player === AGENT && samePos(e.pos, pos))) return k;
    return null;
  };

  for (let n = 1; n < frames.length; n++) {
    const events = frames[n].events;
    const explosions = events.filter((e): e is Exploded => e.type === "exploded");
    const eliminations = events.filter((e): e is Eliminated => e.type === "eliminated");

    // Kills: victims whose credit includes the agent, grouped by the agent bomb that reached them.
    const killed = eliminations.filter((e) => e.player !== AGENT && e.by !== "collapse" && e.by.includes(AGENT));
    const byBomb = new Map<string, { bomb: Exploded; victims: Eliminated[] }>();
    for (const victim of killed) {
      const bomb = explosions.find((x) => x.owner === AGENT && x.cells.some((c) => samePos(c, victim.pos)));
      if (!bomb) continue;
      const key = `${bomb.pos.x},${bomb.pos.y}`;
      byBomb.set(key, { bomb, victims: [...(byBomb.get(key)?.victims ?? []), victim] });
    }
    for (const { bomb, victims } of byBomb.values()) {
      const decision = placedAt(bomb.pos, n) ?? n;
      const shared = [...new Set(victims.flatMap((v) => (v.by === "collapse" ? [] : v.by)))].filter((k) => k !== AGENT && !victims.some((v) => v.player === k));
      moments.push({
        kind: "kill",
        decisionTick: decision,
        payoffTick: n,
        bomb: bomb.pos,
        victims: victims.map((v) => v.player),
        by: [AGENT, ...shared],
        call: callForFrame(calls, decision),
        summary: `${names[AGENT]} eliminates ${victims.map((v) => names[v.player]).join(" and ")}${shared.length ? ` (shared with ${shared.map((k) => names[k]).join(", ")})` : ""}`,
      });
    }

    // The agent's own elimination: decided where its fatal bomb was placed, or on the call it died in.
    const death = eliminations.find((e) => e.player === AGENT);
    if (death) {
      const own = death.by !== "collapse" && death.by.includes(AGENT)
        ? explosions.find((x) => x.owner === AGENT && x.cells.some((c) => samePos(c, death.pos)))
        : undefined;
      const decision = (own && placedAt(own.pos, n)) || n;
      const cause = death.by === "collapse" ? "the collapsing arena" : death.by.map((k) => (k === AGENT ? "its own bomb" : `${names[k]}'s bomb`)).join(" and ");
      moments.push({
        kind: "death",
        decisionTick: decision,
        payoffTick: n,
        bomb: own?.pos,
        victims: [AGENT],
        by: death.by,
        call: callForFrame(calls, decision),
        summary: `${names[AGENT]} is eliminated by ${cause}`,
      });
    }

    // Near misses: a blast lands next to the agent and it lives.
    const me = frames[n].state.players[AGENT];
    if (me.alive && !death) {
      const close = explosions.find((x) => x.cells.some((c) => distance(c, me.pos) <= near));
      if (close) {
        moments.push({
          kind: "near_miss",
          decisionTick: Math.max(1, n - 2),
          payoffTick: n,
          victims: [],
          call: callForFrame(calls, n),
          summary: `${close.owner === AGENT ? "Its own" : `${names[close.owner]}'s`} blast misses ${names[AGENT]} by a cell`,
        });
      }
    }
  }
  return moments;
}
