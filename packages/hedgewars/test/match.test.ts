import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {parseFact, type Command, type Fact} from '../src/engine.js';
import {HedgewarsMatch} from '../src/match.js';
import {callTool} from '../src/session.js';
import {MatchState, renderMap} from '../src/state.js';
import {toEngineShot} from '../src/tools.js';

const facts = (...lines: string[]) => lines.map(line => parseFact('@@' + line)!);

const OPENING = [
  'hog t=0 id=1 clan=0 hp=100 x=100 y=60 angle=0 cur=1 name=Ada',
  'hog t=0 id=2 clan=1 hp=100 x=300 y=60 angle=0 cur=0 name=Cleo the Bold',
  'row y=0 cells=............', 'row y=1 cells=............', 'row y=2 cells=..########..', 'row y=3 cells=..########..',
  'land w=384 h=128 cell=32 water=96',
  'turn t=10 hog=1 wind=-42.7',
];

/** Stands in for the engine: replays scripted facts in answer to each command. */
class FakeEngine extends EventEmitter {
  readonly facts: Fact[] = [];
  readonly commands: Command[] = [];
  replies: string[][] = [];
  push(...lines: string[]) { for (const fact of facts(...lines)) { this.facts.push(fact); this.emit('fact', fact); } }
  async command(cmd: Command): Promise<Fact> {
    this.commands.push(cmd);
    const seq = this.commands.length;
    this.push(`ack t=1 seq=${seq} cmd=${cmd.kind} hog=${this.facts.filter(f => f.kind === 'turn').at(-1)!.hog}`);
    setImmediate(() => this.push(...(this.replies.shift() ?? [])));
    return this.facts.at(-1)!;
  }
  waitFact(match: (fact: Fact) => boolean, timeoutMs = 1000, since = this.facts.length): Promise<Fact> {
    const seen = this.facts.slice(since).find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.off('fact', listener); fail(new Error('timed out')); }, Math.min(timeoutMs, 300));
      const listener = (fact: Fact) => { if (match(fact)) { clearTimeout(timer); this.off('fact', listener); done(fact); } };
      this.on('fact', listener);
    });
  }
}

function setup() {
  const engine = new FakeEngine();
  engine.push(...OPENING);
  return {engine, match: new HedgewarsMatch(engine, ['Claude', 'Codex'])};
}

test('parseFact keeps spaces in the trailing name', () => {
  assert.deepEqual(parseFact('123: noise @@hog id=2 hp=90 name=Cleo the Bold'), {kind: 'hog', id: '2', hp: '90', name: 'Cleo the Bold'});
  assert.equal(parseFact('no marker here'), undefined);
});

test('agent units convert to engine units', () => {
  const shot = (elevation: number, power: number) => toEngineShot({weapon: 'bazooka', direction: 'right', elevation, power, narration: 'test'});
  assert.deepEqual([shot(90, 100).angle, shot(45, 100).angle, shot(0, 100).angle, shot(-90, 100).angle], [0, 512, 1024, 2048]);
  assert.deepEqual([shot(45, 100).power, shot(45, 0.01).power], [1500, 1]);
  assert.equal(shot(45, 50).timer, undefined);
  assert.equal(toEngineShot({weapon: 'grenade', direction: 'left', elevation: 30, power: 50, narration: 'test'}).timer, 3);
});

test('state follows damage, deaths and the winner', () => {
  const state = new MatchState();
  for (const fact of facts(...OPENING)) state.apply(fact);
  assert.equal(state.currentHog?.name, 'Ada');
  assert.equal(state.winner, undefined);
  // Two hits before the game settles both report the old health.
  for (const fact of facts('damage t=20 id=2 dmg=30 hp=100', 'damage t=21 id=2 dmg=25 hp=100')) state.apply(fact);
  assert.equal(state.hogs.get('2')!.hp, 45);
  state.apply(facts('dead t=30 id=2')[0]!);
  assert.equal(state.winner, 0);
  assert.equal(state.roster.get('2')!.name, 'Cleo the Bold');
});

test('map is cropped, shows water and marks hedgehogs by side', () => {
  const state = new MatchState();
  for (const fact of facts(...OPENING)) state.apply(fact);
  const map = renderMap(state, 1);
  assert.deepEqual(map.rows, ['..........', '..a.....C.', '.########.', '~~~~~~~~~~']);
  assert.deepEqual([map.originX, map.originY, map.cell], [32, 0, 32]);
  assert.equal(map.legend.C, 'Cleo the Bold (yours)');
  assert.equal(map.legend.a, 'Ada (enemy)');
});

test('a seat can only act on its own turn', async () => {
  const {engine, match} = setup();
  assert.equal(match.view(0).status, 'your_turn');
  assert.equal(match.view(0).active, 'Ada');
  assert.equal(match.view(1).status, 'waiting');
  const refused = await match.act(1, {kind: 'skip'});
  assert.equal(refused.ok, false);
  assert.equal(engine.commands.length, 0);
});

test('a shot reports where it landed and passes the turn', async () => {
  const {engine, match} = setup();
  engine.replies = [['shot t=20 id=9 x=100 y=50 dx=1 dy=-1', 'damage t=40 id=2 dmg=35 hp=100', 'impact t=40 id=9 x=280 y=72',
    'hog t=60 id=2 clan=1 hp=65 x=310 y=60 angle=0 cur=1 name=Cleo the Bold', 'turn t=60 hog=2 wind=12']];
  const result = await callTool(match, 0, 'shoot', {direction: 'right', elevation: 45, power: 60, narration: 'Lobbing one at Cleo.'}) as any;
  assert.equal(result.ok, true);
  assert.deepEqual(engine.commands[0], {kind: 'shoot', weapon: 'bazooka', facing: 'right', angle: 512, power: 900});
  assert.deepEqual(result.outcome.impacts, [{x: 280, y: 72, nearestEnemy: {name: 'Cleo the Bold', distance: 23, offsetX: -20, offsetY: 12}}]);
  assert.deepEqual(result.outcome.damage, [{name: 'Cleo the Bold', side: 'enemy', damage: 35, hpLeft: 65}]);
  assert.equal(result.status, 'waiting');
  const theirs = await match.waitTurn(1);
  assert.equal(theirs.status, 'your_turn');
  assert.deepEqual(theirs.sinceYourLastAction.filter(line => !line.startsWith('Explosion')), ['Ada fired.', 'Cleo the Bold took 35 damage (65 hp left).']);
});

test('walking keeps the turn; bad arguments never reach the game', async () => {
  const {engine, match} = setup();
  engine.replies = [['hog t=30 id=1 clan=0 hp=100 x=140 y=60 angle=0 cur=1 name=Ada', 'moved t=30 hog=1']];
  const walked = await callTool(match, 0, 'walk', {direction: 'right', seconds: 0.5, narration: 'Closing in.'}) as any;
  assert.equal(walked.ok, true);
  assert.equal(walked.status, 'your_turn');
  assert.deepEqual(walked.outcome.events, ['Ada moved to (140, 60).']);
  const bad = await callTool(match, 0, 'shoot', {direction: 'up', elevation: 200, power: 60, narration: 'nope'}) as any;
  assert.equal(bad.ok, false);
  assert.equal(engine.commands.length, 1);
});

test('the match ends when a team is wiped out', async () => {
  const {engine, match} = setup();
  engine.replies = [['damage t=40 id=2 dmg=120 hp=100', 'impact t=40 id=9 x=300 y=60', 'dead t=50 id=2', 'over t=60 winner=0']];
  const result = await match.act(0, {kind: 'shoot', facing: 'right', angle: 512, power: 900});
  assert.equal(result.status, 'over');
  assert.equal(result.result, 'you_won');
  assert.equal((await match.waitTurn(1)).result, 'you_lost');
  assert.equal((await match.act(1, {kind: 'skip'})).ok, false);
});

test('drowning and sudden death are told apart from blast damage', async () => {
  const engine = new FakeEngine();
  engine.push(...OPENING);
  const match = new HedgewarsMatch(engine as any, ['Claude', 'Codex']);
  engine.replies = [['shot t=20 id=9 x=100 y=50 dx=1 dy=-1', 'impact t=30 id=9 x=290 y=60', 'damage t=31 id=2 dmg=20 hp=100', 'dead t=40 id=2',
    'hog t=50 id=1 clan=0 hp=95 x=100 y=60 angle=0 cur=0 name=Ada', 'turn t=50 hog=1 wind=0']];
  const shot = await match.act(0, {kind: 'shoot', weapon: 'bazooka', facing: 'right', angle: 512, power: 700}) as any;
  assert.ok(shot.outcome.events.includes('Cleo the Bold was knocked into the water and drowned.'));
  assert.ok(shot.outcome.events.includes('Sudden death: Ada lost 5 hp (95 hp left).'));
  assert.equal(shot.suddenDeath, true);
});

test('a shot that hurts its own team says so, and wait_for_turn takes a reaction', async () => {
  const engine = new FakeEngine();
  engine.push(...OPENING);
  const match = new HedgewarsMatch(engine as any, ['Claude', 'Codex']);
  engine.replies = [['impact t=30 id=9 x=110 y=60', 'damage t=31 id=1 dmg=30 hp=100', 'turn t=50 hog=2 wind=0']];
  const shot = await match.act(0, {kind: 'shoot', weapon: 'bazooka', facing: 'right', angle: 512, power: 100}) as any;
  assert.ok(shot.outcome.events.includes('Ada took 30 damage from its own shot (70 hp left).'));
  const waited = await callTool(match, 0, 'wait_for_turn', {reaction: 'Well, that was embarrassing.'}) as any;
  assert.equal(waited.status, 'waiting');
});
