// Starts a Hedgewars match and a local session that two MCP adapters (one per
// team) can play through.
//
//   npm run hedgewars:session               wait for two agents to connect and play
//   npm run hedgewars:session -- --self-test   play a scripted match through real MCP clients
//   npm run hedgewars:session -- --play        launch Claude and Codex and let them play
//   add --record to capture the whole match to match.mp4
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {appendFile, mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {HedgewarsEngine} from '../packages/hedgewars/src/engine.js';
import {HedgewarsMatch, type View} from '../packages/hedgewars/src/match.js';
import {startSession} from '../packages/hedgewars/src/session.js';
import {chooseShot} from './hedgewars-policy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const selfTest = process.argv.includes('--self-test');
const play = process.argv.includes('--play');
const record = process.argv.includes('--record');
const TEAMS = [
  {name: 'Claude', color: 0xd97757, hogs: ['Ada', 'Bram']},
  {name: 'Codex', color: 0x10a37f, hogs: ['Cleo', 'Dax']},
];

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(done => probe.listen(0, '0.0.0.0', done));
  const {port} = probe.address() as {port: number};
  await new Promise(done => probe.close(done));
  return port;
}

const out = join(root, 'data/hedgewars-sessions', new Date().toISOString().replaceAll(':', '-'));
await mkdir(out, {recursive: true});
const engine = new HedgewarsEngine({port: await freePort(), outDir: out, seed: process.env.HEDGEWARS_SEED ?? `{agent-world-${Date.now()}}`,
  // The self-test uses frail hedgehogs so that it can reach the end of a match quickly.
  health: selfTest ? 30 : 100, teams: TEAMS, sound: record});
let failed = false;
let shots = 0;
try {
  await engine.start();
  await engine.waitFact(f => f.kind === 'turn', 90_000, 0);
  const match = new HedgewarsMatch(engine, TEAMS.map(t => t.name));
  const session = await startSession(match, event => {
    void appendFile(join(out, 'events.jsonl'), JSON.stringify({...event, result: undefined, ok: (event.result as any)?.ok}) + '\n');
    if (event.reaction) console.log(`[${event.team}] reacts: ${event.reaction}`);
    if (event.narration) console.log(`[${event.team}] ${event.tool} ${JSON.stringify({...(event.args as object), narration: undefined})}: ${event.narration}`);
    if (play && event.tool === 'shoot') void engine.screenshot(`shot-${String(++shots).padStart(2, '0')}`).catch(() => undefined);
  });
  const configs = await Promise.all(TEAMS.map(async (team, seat) => {
    const server = {command: process.execPath, args: ['--import', 'tsx', join(root, 'src/mcp/hedgewars.ts')], cwd: root,
      env: {HEDGEWARS_SESSION_URL: session.url, HEDGEWARS_SESSION_TOKEN: session.tokens[seat]!}};
    const file = join(out, `mcp-${team.name.toLowerCase()}.json`);
    await writeFile(file, JSON.stringify({mcpServers: {'agent-world': server}}, null, 2), {mode: 0o600});
    return {team: team.name, file, server};
  }));
  console.log(`Hedgewars match ready: ${out}`);
  for (const config of configs) console.log(`  ${config.team}: --mcp-config ${config.file}`);

  if (record) engine.startRecording();
  if (selfTest) await playScripted(configs.map(c => c.server));
  else if (play) await playModels(configs.map(c => ({file: c.file, server: c.server})), () => match.state.winner !== undefined);
  else await engine.waitFact(f => f.kind === 'over', 2 * 60 * 60_000, 0);
  await engine.screenshot('final').catch(() => undefined);
  if (record) {
    // Hold on the final scene for a moment so the video does not end on the last frame of the blast.
    await new Promise(done => setTimeout(done, 4000));
    await engine.stopRecording();
    await new Promise<void>(done => spawn('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(out, 'match.mkv'), '-c', 'copy', '-movflags', '+faststart', join(out, 'match.mp4')],
      {stdio: 'inherit'}).once('close', () => done()));
    console.log(`video: ${join(out, 'match.mp4')}`);
  }
  await session.close();
} catch (error) {
  failed = true;
  console.log('FAIL', error instanceof Error ? error.stack : error);
  console.log(engine.stderr.filter(line => !line.includes('Script not found')).slice(-25).join('\n'));
} finally {
  await writeFile(join(out, 'facts.json'), JSON.stringify(engine.facts.filter(f => f.kind !== 'row'), null, 1));
  await writeFile(join(out, 'engine.log'), engine.stderr.filter(line => !line.includes('Script not found')).join('\n'));
  await engine.stop();
  console.log('artifacts:', out);
  process.exit(failed ? 1 : 0);
}

type ToolResult = View & {ok?: boolean; error?: string; outcome?: {events: string[]}; sinceYourLastAction?: string[]};

/** Drives both teams the way two models would: each through its own MCP adapter process. */
async function playScripted(servers: {command: string; args: string[]; cwd: string; env: Record<string, string>}[]): Promise<void> {
  const check = (ok: unknown, what: string, detail?: unknown) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
    if (!ok) throw new Error(what);
  };
  const seats = await Promise.all(servers.map(async (server, seat) => {
    const client = new Client({name: `self-test-${seat}`, version: '0.0.0'});
    await client.connect(new StdioClientTransport({...server, env: {...process.env as Record<string, string>, ...server.env}}));
    const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult & {mapText?: string}> => {
      const result = await client.callTool({name, arguments: args}, undefined, {timeout: 160_000});
      const content = result.content as {type: string; text: string}[];
      if (result.isError) throw new Error(`${name}: ${content[0]?.text}`);
      return {...JSON.parse(content[0]!.text), mapText: content[1]?.text};
    };
    return {client, call};
  }));
  const tools = await seats[0]!.client.listTools();
  check(tools.tools.length === 6, 'adapter lists the tools', tools.tools.map(t => t.name));

  // What each turn should try, in order. Afterwards the Claude team blows itself up so the match ends.
  const script = ['walk', 'jump', 'skip', 'grenade', 'suicide', 'shoot', 'suicide'];
  let seat = 0;
  let screenshot = 0;
  for (let turn = 0; turn < 12; turn++) {
    let view = await seats[seat]!.call('wait_for_turn');
    if (turn === 0) {
      check(view.mapText?.includes('#'), 'terrain map has ground');
      console.log(view.mapText);
      const wrong = await seats[1]!.call('shoot', {direction: 'left', elevation: 45, power: 50, narration: 'Trying to shoot out of turn.'});
      check(wrong.ok === false, 'acting out of turn is refused', wrong.error);
      const invalid = await seats[0]!.call('observe').then(() => seats[0]!.client.callTool({name: 'shoot', arguments: {direction: 'up', elevation: 45, power: 50, narration: 'bad'}})).catch(error => ({isError: true, content: [{text: String(error)}]}));
      check(invalid.isError, 'invalid arguments are rejected by the adapter');
    }
    if (view.status === 'over') { check(true, 'match over', {seat: TEAMS[seat]!.name, result: view.result}); break; }
    if (view.status !== 'your_turn') { seat = 1 - seat; continue; }
    const me = view.hedgehogs.find(h => h.name === view.active)!;
    const foe = view.hedgehogs.filter(h => h.side === 'enemy').sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0]!;
    const aim = chooseShot(me, foe, view.wind);
    const step = script[turn] ?? (seat === 0 ? 'suicide' : 'shoot');
    let result: ToolResult;
    if (step === 'walk') {
      const moved = await seats[seat]!.call('walk', {direction: aim.direction, seconds: 0.6, narration: `${me.name} steps towards ${foe.name}.`});
      const now = moved.hedgehogs.find(h => h.name === me.name)!;
      check(moved.ok && moved.status === 'your_turn' && now.x !== me.x, 'walk moves the hedgehog and keeps the turn', {from: me.x, to: now.x});
    } else if (step === 'jump') {
      const jumped = await seats[seat]!.call('jump', {direction: aim.direction, kind: 'long', narration: `${me.name} hops forward.`});
      const now = jumped.hedgehogs.find(h => h.name === me.name);
      check(jumped.ok && jumped.status !== 'over', 'jump is carried out', {from: [me.x, me.y], to: now && [now.x, now.y], events: jumped.outcome?.events});
      view = jumped;
    }
    if (view.status !== 'your_turn' && step === 'jump') { seat = 1 - seat; continue; }
    if (step === 'skip') result = await seats[seat]!.call('skip', {narration: `${me.name} waits this one out.`});
    else if (step === 'suicide') result = await seats[seat]!.call('shoot', {direction: 'left', elevation: -90, power: 5, narration: `${me.name} ends the self-test the hard way.`});
    else result = await seats[seat]!.call('shoot', {weapon: step === 'grenade' ? 'grenade' : 'bazooka', ...(step === 'grenade' ? {fuse: 2} : {}), ...aim,
      narration: `${me.name} lobs a ${step === 'grenade' ? 'grenade' : 'shell'} at ${foe.name}.`});
    check(result.ok, `turn ${turn + 1}: ${me.name} ${step}`, result.ok ? result.outcome?.events : result.error);
    if (screenshot < 3) await engine.screenshot(`turn-${++screenshot}`).catch(() => undefined);
    seat = 1 - seat;
  }
  const finals = await Promise.all(seats.map(s => s.call('observe')));
  const results = finals.map(f => f.result);
  check(finals.every(f => f.status === 'over') && (results.join() === 'you_won,you_lost' || results.join() === 'you_lost,you_won' || results.join() === 'draw,draw'),
    'both teams see the same ending', Object.fromEntries(TEAMS.map((t, i) => [t.name, results[i]])));
  await Promise.all(seats.map(s => s.client.close()));
}

function goal(seat: number): string {
  const me = TEAMS[seat]!, foe = TEAMS[1 - seat]!;
  return `You are playing a live artillery match of Hedgewars for a recorded show. You command team ${me.name} (hedgehogs ${me.hogs.join(' and ')}) `
    + `against team ${foe.name} (${foe.hogs.join(' and ')}). Use only the agent-world tools; do not run commands or read files.\n\n`
    + `Loop until the match is over: call wait_for_turn; when status is your_turn, read the positions, wind and terrain map, optionally walk or jump `
    + `to a better spot, then shoot (that ends the turn). After each shot, use the reported impact offset from the nearest enemy to correct your next aim. `
    + `Mind your own hedgehogs: explosions hurt them too, and terrain between you and the target blocks low shots. `
    + `Give one short, characterful narration line with every action, and after every shot pass wait_for_turn a short reaction to what that shot did `
    + `(cheer a hit, grumble at a miss, own up when you hurt your own hedgehog). Be lively; this is a show. Keep your thinking brief; the audience is watching in real time. `
    + `When wait_for_turn or an action reports status "over", say one closing line and stop.`;
}

/** Launches one model per team, each restricted to its own MCP adapter, and waits for both to exit. */
async function playModels(seats: {file: string; server: {command: string; args: string[]; cwd: string; env: Record<string, string>}}[], isOver: () => boolean): Promise<void> {
  const toml = (value: unknown) => JSON.stringify(value);
  const codexServer = seats[1]!.server;
  const launches = [
    {name: 'claude', command: 'claude', args: ['--restricted', '--setting-sources', '', '--settings', '{"disableAllHooks":true,"autoMemoryEnabled":false,"claudeMdExcludes":["**"]}',
      '--disable-slash-commands', '--no-chrome', '--strict-mcp-config', '--print', '--no-session-persistence', '--permission-mode', 'dontAsk', '--tools', '',
      '--mcp-config', seats[0]!.file, '--allowedTools', 'mcp__agent-world__*', '--output-format', 'stream-json', '--verbose',
      '--model', process.env.HEDGEWARS_CLAUDE_MODEL ?? 'claude-opus-5-5', '--max-budget-usd', '10']},
    {name: 'codex', command: 'codex', args: ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-s', 'read-only', '--json',
      '-c', `mcp_servers.agent-world.command=${toml(codexServer.command)}`,
      '-c', `mcp_servers.agent-world.args=${toml(codexServer.args)}`,
      '-c', `mcp_servers.agent-world.cwd=${toml(codexServer.cwd)}`,
      '-c', `mcp_servers.agent-world.env={${Object.entries(codexServer.env).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`,
      '-c', 'mcp_servers.agent-world.tool_timeout_sec=170',
      // codex exec never asks, so without this every MCP call is refused.
      '-c', 'mcp_servers.agent-world.default_tools_approval_mode="approve"', '-']},
  ];
  const children: import('node:child_process').ChildProcess[] = [];
  const exits = await Promise.all(launches.map(async (launch, seat) => {
    const cwd = join(out, launch.name);
    await mkdir(cwd, {recursive: true});
    const child = spawn(launch.command, launch.args, {cwd, stdio: ['pipe', 'pipe', 'pipe']});
    children.push(child);
    child.stdin.end(goal(seat));
    child.stdout.pipe(createWriteStream(join(out, `${launch.name}.transcript.jsonl`)));
    child.stderr.pipe(createWriteStream(join(out, `${launch.name}.stderr.log`)));
    const code = await new Promise<number | null>((done, fail) => { child.once('error', fail); child.once('close', done); });
    console.log(`${launch.name} exited ${code} (match ${isOver() ? 'over' : 'NOT over'})`);
    // One player gone mid-match leaves the other waiting forever: stop it too.
    if (!isOver()) for (const other of children) if (other !== child) other.kill();
    return code;
  }));
  if (!isOver()) throw new Error(`models stopped before the match ended (exit codes ${exits.join(', ')})`);
}
