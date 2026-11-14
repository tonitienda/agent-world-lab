import type {Command, Fact} from './engine.js';
import {MatchState, renderMap, type Hog, type MapView} from './state.js';

/** The part of HedgewarsEngine the match needs; tests pass a fake. */
export type EngineLike = {
  readonly facts: Fact[];
  on(event: 'fact', listener: (fact: Fact) => void): unknown;
  command(cmd: Command): Promise<Fact>;
  waitFact(match: (fact: Fact) => boolean, timeoutMs?: number, since?: number): Promise<Fact>;
};

export type View = {
  status: 'your_turn' | 'waiting' | 'over';
  result?: 'you_won' | 'you_lost' | 'draw';
  turn: number;
  /** -100..100. Negative blows to the left, positive to the right. */
  wind: number;
  /** True once sudden death has begun: every hedgehog loses health at the start of each turn (never below 1). */
  suddenDeath: boolean;
  /** Your hedgehog that acts now (only on your turn). */
  active?: string;
  hedgehogs: {name: string; team: string; side: 'yours' | 'enemy'; hp: number; x: number; y: number}[];
  map: MapView;
};

export type Outcome = {
  /** Plain-language account, oldest first. */
  events: string[];
  impacts: {x: number; y: number; nearestEnemy?: {name: string; distance: number; offsetX: number; offsetY: number}}[];
  damage: {name: string; side: 'yours' | 'enemy'; damage: number; hpLeft: number}[];
  deaths: string[];
};

const ENDS_TURN: Record<Command['kind'], boolean> = {shoot: true, skip: true, walk: false, jump: false};

/**
 * Turn-based view of a running engine for the two seats (clan 0 and clan 1).
 * Each seat may only act while one of its own hedgehogs has the turn.
 */
export class HedgewarsMatch {
  readonly state = new MatchState();
  /** True between a turn-ending action and the next turn: nobody may act. */
  private resolving = false;
  private busy = false;
  /** Per seat: how much of the fact log it has already been told about. */
  private told = new Map<number, {facts: number; hogs: Map<string, Hog>}>();

  constructor(private readonly engine: EngineLike, readonly teams: string[]) {
    for (const fact of engine.facts) this.state.apply(fact);
    teams.forEach((_, clan) => this.told.set(clan, {facts: engine.facts.length, hogs: this.snapshot()}));
    engine.on('fact', fact => {
      this.state.apply(fact);
      if (fact.kind === 'turn') this.resolving = false;
    });
  }

  view(clan: number): View {
    const s = this.state;
    const winner = s.winner;
    const active = s.currentHog;
    const yours = !this.resolving && active?.clan === clan;
    return {
      status: winner !== undefined ? 'over' : yours ? 'your_turn' : 'waiting',
      ...(winner === undefined ? {} : {result: winner === null ? 'draw' as const : winner === clan ? 'you_won' as const : 'you_lost' as const}),
      turn: s.turn?.number ?? 0,
      wind: Math.round(s.turn?.wind ?? 0),
      suddenDeath: s.suddenDeath,
      ...(yours && winner === undefined ? {active: active!.name} : {}),
      hedgehogs: [...s.hogs.values()].map(h => ({name: h.name, team: this.teams[h.clan] ?? `team ${h.clan}`,
        side: h.clan === clan ? 'yours' as const : 'enemy' as const, hp: h.hp, x: h.x, y: h.y})),
      map: renderMap(s, clan),
    };
  }

  /** Waits until this seat can act or the match is over. Gives up quietly after `timeoutMs`. */
  async waitTurn(clan: number, timeoutMs = 100_000): Promise<View & {sinceYourLastAction: string[]}> {
    const deadline = Date.now() + timeoutMs;
    while (this.view(clan).status === 'waiting' && Date.now() < deadline) {
      await this.engine.waitFact(f => f.kind === 'turn' || f.kind === 'over' || f.kind === 'dead', deadline - Date.now()).catch(() => undefined);
    }
    const last = this.told.get(clan) ?? {facts: this.engine.facts.length, hogs: this.snapshot()};
    this.told.set(clan, {facts: this.engine.facts.length, hogs: this.snapshot()});
    return {sinceYourLastAction: this.describe(this.engine.facts.slice(last.facts), clan, last.hogs).events, ...this.view(clan)};
  }

  async act(clan: number, cmd: Command): Promise<({ok: true; outcome: Outcome} | {ok: false; error: string}) & View> {
    const refuse = (error: string) => ({ok: false as const, error, ...this.view(clan)});
    const status = this.view(clan).status;
    if (status === 'over') return refuse('The match is over.');
    if (status !== 'your_turn') return refuse('It is not your turn. Call wait_for_turn.');
    if (this.busy) return refuse('Your previous action is still playing out.');
    this.busy = true;
    try {
      const mark = this.engine.facts.length;
      const before = this.snapshot();
      const ack = await this.engine.command(cmd);
      if (ack.kind === 'reject') return refuse(`The game refused the action (${ack.why ?? 'unknown reason'}).`);
      if (ENDS_TURN[cmd.kind]) {
        this.resolving = true;
        await this.engine.waitFact(f => f.kind === 'turn' || f.kind === 'over', 90_000, mark);
      } else {
        // A walk or jump can end the turn by itself: the hedgehog may fall into the water.
        await this.engine.waitFact(f => f.kind === 'moved' || f.kind === 'turn' || f.kind === 'over', 30_000, mark);
      }
      const outcome = this.describe(this.engine.facts.slice(mark), clan, before);
      this.told.set(clan, {facts: this.engine.facts.length, hogs: this.snapshot()});
      return {ok: true, outcome, ...this.view(clan)};
    } catch (error) {
      return refuse(`The game did not answer: ${(error as Error).message}`);
    } finally {
      this.busy = false;
      this.resolving = false;
    }
  }

  private snapshot(): Map<string, Hog> {
    return new Map([...this.state.hogs].map(([id, hog]) => [id, {...hog}]));
  }

  /** Turns raw facts into what a player would say happened. `before` is where everyone stood when it began. */
  private describe(facts: Fact[], viewer: number, before: Map<string, Hog>): Outcome {
    const out: Outcome = {events: [], impacts: [], damage: [], deaths: []};
    const who = (id: string | undefined) => this.state.roster.get(id ?? '');
    let shooter: {name: string; clan: number} | undefined;
    const hp = new Map([...before].map(([id, h]) => [id, h.hp]));
    for (const fact of facts) {
      const hog = who(fact.kind === 'ack' || fact.kind === 'moved' || fact.kind === 'misfire' ? fact.hog : fact.id);
      switch (fact.kind) {
        case 'ack':
          shooter = hog;
          if (fact.cmd === 'shoot') out.events.push(`${hog?.name} fired.`);
          if (fact.cmd === 'skip') out.events.push(`${hog?.name} skipped the turn.`);
          break;
        case 'misfire': out.events.push(`${hog?.name} failed to fire; the turn was lost.`); break;
        case 'moved': {
          const now = this.state.hogs.get(fact.hog!);
          if (now) out.events.push(`${now.name} moved to (${now.x}, ${now.y}).`);
          break;
        }
        case 'impact': {
          const x = Number(fact.x), y = Number(fact.y);
          const targets = [...before.values()].filter(h => h.clan !== (shooter?.clan ?? viewer));
          const nearest = targets.map(h => ({name: h.name, distance: Math.round(Math.hypot(x - h.x, y - h.y)), offsetX: x - h.x, offsetY: y - h.y}))
            .sort((a, b) => a.distance - b.distance)[0];
          out.impacts.push({x, y, ...(nearest ? {nearestEnemy: nearest} : {})});
          out.events.push(`Explosion at (${x}, ${y})` + (nearest ? `, ${nearest.distance} px from ${nearest.name}.` : '.'));
          break;
        }
        case 'damage': {
          if (!hog) break;
          const damage = Number(fact.dmg), hpLeft = Math.max(0, (hp.get(fact.id!) ?? Number(fact.hp)) - damage);
          hp.set(fact.id!, hpLeft);
          out.damage.push({name: hog.name, side: hog.clan === viewer ? 'yours' : 'enemy', damage, hpLeft});
          // Say so plainly when a team hurts itself: players (and viewers) care.
          const own = shooter && hog.clan === shooter.clan ? ` from ${hog.name === shooter.name ? 'its own' : `${shooter.name}'s`} shot` : '';
          out.events.push(`${hog.name} took ${damage} damage${own} (${hpLeft} hp left).`);
          break;
        }
        case 'dead':
          if (!hog) break;
          out.deaths.push(hog.name);
          // Dying with health to spare means the water took it, not the blast.
          out.events.push((hp.get(fact.id!) ?? 0) > 0 ? `${hog.name} was knocked into the water and drowned.` : `${hog.name} died.`);
          hp.delete(fact.id!);
          break;
      }
    }
    // Health lost with no hit behind it is the sudden-death drain.
    for (const [id, expected] of hp) {
      const now = this.state.hogs.get(id);
      if (now && now.hp < expected) out.events.push(`Sudden death: ${now.name} lost ${expected - now.hp} hp (${now.hp} hp left).`);
    }
    return out;
  }
}
