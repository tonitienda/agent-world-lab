// Freeciv feasibility spike: two scripted "agents" (Claude, Codex) join a
// headless Freeciv 3.1.4 server over the JSON protocol, alongside built-in AIs.
// No model calls. See docs/research/freeciv-spike-results.md.
import {mkdir, writeFile, readdir} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {FreecivClient} from '../packages/freeciv/src/client.js';
import {FreecivServer} from '../packages/freeciv/src/server.js';
import {CLAUSE, DIPLSTATE, type Packet} from '../packages/freeciv/src/protocol.js';

const root = fileURLToPath(new URL('../', import.meta.url));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = (server.address() as {port: number}).port;
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

type Step = {at: string; step: string; ok: boolean; detail?: unknown};

async function main(): Promise<void> {
  const out = join(root, 'data/freeciv-spikes', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(out, {recursive: true});
  const steps: Step[] = [];
  const log = (step: string, ok: boolean, detail?: unknown) => {
    steps.push({at: new Date().toISOString(), step, ok, detail});
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
  };
  const serverLog: string[] = [];
  const port = await freePort();
  const server = new FreecivServer({port, outDir: out, onLine: line => serverLog.push(line)});
  const packetLog: Record<string, Packet[]> = {Claude: [], Codex: []};
  const clients = ['Claude', 'Codex'].map(name => {
    const client = new FreecivClient(name);
    client.on('packet', p => packetLog[name]!.push(p));
    return client;
  });
  const [claude, codex] = clients as [FreecivClient, FreecivClient];

  try {
    await server.start();
    log('server started', true, {port});
    for (const cmd of ['set mapseed 7', 'set gameseed 7', 'set size 1', 'set aifill 4', 'set timeout 0',
      'set saveturns 0', 'set startpos ALL']) await server.command(cmd);

    for (const client of clients) await client.connect('127.0.0.1', port);
    log('clients joined over JSON', true, clients.map(c => ({user: c.username, conn: c.connId})));
    await server.command("list");

    await server.command('start', 60_000);
    await Promise.all(clients.map(c => c.until(() => c.playerno >= 0 && c.myUnits().length > 0 && !!c.map, 30_000)));
    for (const c of clients) {
      log(`${c.username} sees own state`, true, {playerno: c.playerno, me: c.me()?.name, units: c.myUnits().map(u => c.unitType(u)), turn: c.turn, map: c.map, knownTiles: c.tiles.size});
    }

    // --- A. founding and delegation to Freeciv's own server-side agents ---
    for (const c of clients) {
      const settler = c.myUnits().find(u => c.unitType(u) === 'Settlers');
      assert(settler, `${c.username} has no Settlers`);
      c.foundCity(settler.id, `${c.username}polis`);
      for (const u of c.myUnits()) {
        if (c.unitType(u) === 'Explorer') c.autoExplore(u.id);
        if (c.unitType(u) === 'Workers') c.autoWork(u.id);
      }
    }
    await Promise.all(clients.map(c => c.until(() => c.myCities().length > 0)));
    log('cities founded via UNIT_DO_ACTION', true, clients.map(c => c.myCities().map(x => ({name: x.name, ...c.tileXY(x.tile)}))));

    // --- B. private chat between agents ---
    const secret = `meet me at the river, turn ${claude.turn}`;
    const heard = codex.next(p => p.pid === 25 && String(p.message).includes(secret), 5_000);
    claude.whisper('Codex', secret);
    const got = await heard;
    log('private message delivered', true, {codexSaw: got.message});

    // --- C. turn loop: the runner decides when a turn ends ---
    const turnMs: number[] = [];
    let contactTurn: number | undefined;
    const turns = Number(process.env.FREECIV_SPIKE_TURNS ?? 30);
    for (let i = 0; i < turns; i++) {
      const from = claude.turn;
      const t0 = Date.now();
      const advanced = Promise.all(clients.map(c => c.next(p => p.pid === 127 && Number(p.turn) > from, 60_000)));
      for (const c of clients) c.phaseDone();
      await advanced;
      turnMs.push(Date.now() - t0);
      // Any settlers built since: found where they stand (may fail near a city; that's fine).
      for (const c of clients) for (const u of c.myUnits()) if (c.unitType(u) === 'Settlers') c.foundCity(u.id, `${c.username} ${c.myCities().length + 1}`);
      const d = claude.diplstate(claude.playerno, codex.playerno);
      if (contactTurn === undefined && d && DIPLSTATE[d.type] !== 'no-contact') contactTurn = claude.turn;
    }
    log('turns advanced only when both agents ended phase', true, {turns, turnMs, contactTurn});

    // --- D. contact: force it with the trusted runner if it did not happen naturally ---
    if (contactTurn === undefined) {
      const target = codex.myCities()[0]!;
      const {x, y} = claude.tileXY(target.tile);
      const mover = claude.myUnits()[0]!;
      await server.lua(`edit.unit_teleport(find.unit(find.player(${claude.playerno}), ${mover.id}), find.tile(${x + 2}, ${y}))`);
      const from = claude.turn;
      const advanced = Promise.all(clients.map(c => c.next(p => p.pid === 127 && Number(p.turn) > from, 60_000)));
      for (const c of clients) c.phaseDone();
      await advanced;
    }
    const before = claude.diplstate(claude.playerno, codex.playerno);
    log('Claude and Codex have contact', !!before && DIPLSTATE[before.type] !== 'no-contact', {state: before && DIPLSTATE[before.type], forced: contactTurn === undefined});

    // --- E. a real treaty through the diplomacy packets ---
    const opened = codex.next(p => p.pid === 96, 5_000);
    claude.openMeeting(codex.playerno);
    await opened;
    const war = before && DIPLSTATE[before.type] === 'war';
    claude.addClause(codex.playerno, claude.playerno, war ? CLAUSE.CEASEFIRE : CLAUSE.PEACE);
    claude.addClause(codex.playerno, claude.playerno, CLAUSE.EMBASSY);
    codex.addClause(claude.playerno, codex.playerno, CLAUSE.EMBASSY);
    await delay(500);
    const closed = claude.next(p => p.pid === 98, 5_000);
    claude.acceptTreaty(codex.playerno);
    codex.acceptTreaty(claude.playerno);
    await closed;
    await claude.until(() => claude.diplstate(claude.playerno, codex.playerno)?.type !== before?.type, 5_000).catch(() => undefined);
    const after = claude.diplstate(claude.playerno, codex.playerno);
    log('treaty signed', !!after && after.type !== before?.type, {from: before && DIPLSTATE[before.type], to: after && DIPLSTATE[after.type]});

    // --- F. evidence: scoreboard, map images, savegame ---
    const board = await server.lua(`for p in players_iterate() do print("@@"..p.name.."|"..p:num_cities().."|"..p:num_units().."|"..p:gold().."|"..server.civilization_score(p)) end`);
    log('scoreboard via console Lua', true, board);
    await server.command('mapimg define zoom=4:map=tcub:show=all:format=ppm|ppm');
    await server.command('mapimg create all');
    await server.command('save spike-final');
    const files = await readdir(out);
    for (const ppm of files.filter(f => f.endsWith('.ppm'))) {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(out, ppm), join(out, ppm.replace(/\.ppm$/, '.png'))]);
    }
    log('map image and save written', files.some(f => f.endsWith('.ppm')) && files.some(f => f.startsWith('spike-final')), (await readdir(out)).filter(f => !f.endsWith('.json') && !f.endsWith('.log')));
  } finally {
    for (const c of clients) c.close();
    await server.stop().catch(() => undefined);
    await writeFile(join(out, 'steps.json'), JSON.stringify(steps, null, 2));
    await writeFile(join(out, 'server.log'), serverLog.join('\n'));
    await writeFile(join(out, 'packets.json'), JSON.stringify(Object.fromEntries(Object.entries(packetLog).map(([k, v]) => [k, v.length]))));
    console.log(`evidence: ${out}`);
  }
}

main().catch(error => { console.error(error); process.exit(1); });
