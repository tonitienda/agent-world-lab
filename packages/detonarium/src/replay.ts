import { createMatch } from "./board.js";
import { createBot, type BotKind } from "./bots.js";
import { step } from "./engine.js";
import type { Action, MatchEvent, MatchState, Rules } from "./types.js";

/**
 * Everything needed to reproduce a match exactly: the engine is deterministic, so
 * seed + rules + per-tick actions (and contest timings) rebuild every state.
 */
export type Replay = {
  format: "detonarium-replay";
  version: 1;
  seed: number;
  rules: Rules;
  /** Display metadata per player slot; not used by the engine. */
  players: { name: string; kind?: string }[];
  ticks: { actions: Action[]; timing?: (number | undefined)[] }[];
};
export type Frame = { state: MatchState; events: MatchEvent[] };

export function newReplay(state: MatchState, players: Replay["players"]): Replay {
  if (state.tick !== 0) throw new Error("a replay starts from tick 0");
  if (players.length !== state.players.length) throw new Error(`expected ${state.players.length} player entries`);
  return { format: "detonarium-replay", version: 1, seed: state.seed, rules: state.rules, players, ticks: [] };
}

/** Rebuild every state. Frame 0 is the start (no events); frame n is the result of tick n. */
export function replayFrames(replay: Replay): Frame[] {
  if (replay.format !== "detonarium-replay" || replay.version !== 1) throw new Error("unsupported replay");
  let state = createMatch({ seed: replay.seed, rules: replay.rules });
  const frames: Frame[] = [{ state, events: [] }];
  for (const tick of replay.ticks) {
    const result = step(state, tick.actions, { timing: tick.timing });
    frames.push(result);
    state = result.state;
  }
  return frames;
}

/** Play a full bot-only match and return its replay. */
export function playBots(kinds: BotKind[], seed: number, rules: Partial<Rules> = {}): Replay {
  let state = createMatch({ seed, rules: { ...rules, players: kinds.length } });
  const replay = newReplay(state, kinds.map((kind, i) => ({ name: `${kind} ${i + 1}`, kind })));
  const bots = kinds.map((kind, i) => createBot(kind, i, seed * 10 + i));
  while (!state.over) {
    const actions = bots.map((bot) => bot(state));
    replay.ticks.push({ actions });
    state = step(state, actions).state;
  }
  return replay;
}
