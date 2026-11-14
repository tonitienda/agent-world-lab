// Hedgewars feasibility spike: our code acts as the game's frontend and drives
// two teams (Claude, Codex) through a Lua bridge inside the engine. No model calls.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HedgewarsEngine, type Fact} from '../packages/hedgewars/src/engine.js';
import {toEngineShot} from '../packages/hedgewars/src/tools.js';
import {chooseShot} from './hedgewars-policy.js';

const root = fileURLToPath(new URL('../', import.meta.url));

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

function latestHogs(facts: Fact[]): Fact[] {
  const byId = new Map<string, Fact>();
  const dead = new Set(facts.filter(f => f.kind === 'dead').map(f => f.id));
  for (const f of facts) if (f.kind === 'hog' && !dead.has(f.id)) byId.set(f.id!, f);
  return [...byId.values()];
}

async function main(): Promise<void> {
  const out = join(root, 'data/hedgewars-spikes', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(out, {recursive: true});
  const log = (step: string, detail?: unknown) => console.log(`ok   ${step}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
  const engine = new HedgewarsEngine({
    port: 46000 + Math.floor(Math.random() * 1000), outDir: out, seed: '{agent-world-spike-1}',
    ammo: {count: Number(process.env.AMMO_COUNT ?? 59)},
    teams: [
      {name: 'Claude', color: 0xd97757, hogs: ['Ada', 'Bram']},
      {name: 'Codex', color: 0x10a37f, hogs: ['Cleo', 'Dax']},
    ],
  });
  try {
    await engine.start();
    log('engine connected and setup sent');
    await engine.waitFact(f => f.kind === 'start', 60_000);
    log('match started');
    const wall = Date.now();
    // Scripted stand-in for the model: aim at the nearest enemy with a fixed lob.
    let mark = 0;
    for (let turn = 1; turn <= 4; turn++) {
      const t = await engine.waitFact(f => f.kind === 'turn', 60_000, mark);
      mark = engine.facts.indexOf(t) + 1;
      const hogs = latestHogs(engine.facts);
      const me = hogs.find(h => h.id === t.hog)!;
      const foe = hogs.filter(h => h.clan !== me.clan).sort((a, b) => Math.abs(Number(a.x) - Number(me.x)) - Math.abs(Number(b.x) - Number(me.x)))[0]!;
      const aim = chooseShot({x: Number(me.x), y: Number(me.y)}, {x: Number(foe.x), y: Number(foe.y)}, Number(t.wind));
      const shot = toEngineShot({weapon: 'bazooka', narration: 'spike', ...aim});
      if (turn === 1) await engine.screenshot('01-turn-start');
      const ack = await engine.command(shot);
      if (turn === 1) { await sleep(Math.min(shot.power, 600)); await engine.screenshot('02-charging'); }
      const fired = await engine.waitFact(f => f.kind === 'shot', 15_000, mark);
      if (turn === 1) { await sleep(700); await engine.screenshot('03-flight'); }
      const impact = await engine.waitFact(f => f.kind === 'impact' && f.id === fired.id, 30_000, mark);
      await sleep(1500);
      await engine.screenshot(`04-turn-${turn}-after`);
      log(`turn ${turn}: ${me.name} -> ${foe.name}`, {wind: t.wind, me: [me.x, me.y], foe: [foe.x, foe.y], shot, ack: ack.kind, fired: [fired.dx, fired.dy],
        impact: [impact.x, impact.y], damage: engine.facts.slice(mark).filter(f => f.kind === 'damage' || f.kind === 'dead')});
      mark = engine.facts.indexOf(impact) + 1;
    }
    log('four turns played', {wallMs: Date.now() - wall});
  } catch (error) {
    console.log('FAIL', error instanceof Error ? error.message : error);
    console.log(engine.stderr.slice(-25).join('\n'));
    console.log('ipc in:', JSON.stringify(engine.ipcIn.slice(-10)));
    process.exitCode = 1;
  } finally {
    await writeFile(join(out, 'facts.json'), JSON.stringify(engine.facts, null, 1));
    await writeFile(join(out, 'engine.log'), engine.stderr.join('\n'));
    await engine.stop();
    console.log('artifacts:', out);
  }
}

await main();
