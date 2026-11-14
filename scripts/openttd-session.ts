import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createWriteStream} from 'node:fs';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {OpenTTDRuntime} from '../packages/openttd/src/runtime.js';
import {OpenTTDSession, toolDefinitions, type ToolName, GOAL} from '../packages/openttd/src/session.js';

import {FreightSession, freightTools, freightBudget, type FreightTool} from '../packages/openttd/src/freight-session.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = process.argv.slice(2);
const baseline = options.includes('--baseline');
const freight = options.includes('--freight');
if (freight && baseline) throw new Error('Use the dedicated freight calibration script');
const episode = freight ? 'episode-009' : 'episode-007';
const spec = freight ? JSON.parse(await readFile(join(root, 'episodes', episode, 'scenario.json'), 'utf8')) : undefined;
const at = options.indexOf('--out');
const folder = resolve(at >= 0 ? options[at + 1]! : join(root, 'data/openttd-sessions',
  `${episode}-${baseline ? 'baseline' : 'claude'}-${new Date().toISOString().replaceAll(':', '-')}`));
await mkdir(join(root, 'data/openttd-sessions'), {recursive: true});
await mkdir(folder, {recursive: false});
const world = new OpenTTDRuntime(root, folder, freight ? {mapSize: spec.environment.mapSize, seed: spec.environment.seed,
  initialCash: spec.initialCash, river: true, title: spec.displayTitle, goalFile: `episodes/${episode}/goal.md`} : {});
const passenger = new OpenTTDSession(world, baseline ? 'baseline' : 'claude');
const freightSession = freight ? new FreightSession(world, spec) : undefined;
const session = freightSession ?? passenger;
const definitions = freight ? freightTools : toolDefinitions;
let serial = false;
let active: Promise<any> = Promise.resolve();
let child: ReturnType<typeof spawn> | undefined;
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await active.catch(() => {});
  if (!session.finished) await session.finish(undefined, 'runner-stopped').catch(() => {});
  await world.close();
  child?.kill('SIGTERM');
};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
const watchdog = setTimeout(() => { console.error('Session wall-clock budget exhausted'); void stop(); }, (freight ? freightBudget.maximumWallMinutes : GOAL.maximumWallMinutes) * 60000);

async function baselinePlay() {
  const call = (name: ToolName, args: any = {}) => passenger.execute(name, args);
  const state = await passenger.status();
  const town = state.company.towns[0];
  const survey = await call('survey', {...town.position, radius: 16});
  const sites = survey.sites.filter((s: any) => s.town === town.id);
  let pair: any[] | undefined, score = -Infinity;
  for (const a of sites) for (const b of sites) {
    const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (distance < 10 || distance > 18 || Math.min(a.acceptance, b.acceptance) < 8 || Math.min(a.production, b.production) < 5) continue;
    const value = Math.min(a.production, b.production) * 10 + a.production + b.production + distance;
    if (value > score) { pair = [a, b]; score = value; }
  }
  if (!pair) throw new Error('Baseline could not find a route');
  const distance = (a: any, b: any) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const depot = sites.find((s: any) => distance(s, pair![0]) >= 3 && distance(s, pair![1]) >= 3);
  if (!depot) throw new Error('Baseline could not find a depot');
  const intent = {intention: 'Baseline feasibility action; not Claude commentary'};
  const checked = async (tool: ToolName, args: any) => {
    const result = await call(tool, {...args, ...intent});
    if (!result.ok && !String(result.error).includes('ALREADY_BUILT')) throw new Error(`${tool}: ${JSON.stringify(result)}`);
    return result;
  };
  for (const stop of pair) await checked('build_stop', stop);
  await checked('build_depot', depot);
  for (const site of [...pair, depot]) await checked('build_road', {x: site.x, y: site.y, end_x: site.front_x, end_y: site.front_y});
  const engines = await call('engines');
  for (let i = 0; i < 3; i++) {
    const bus = await checked('build_vehicle', {x: depot.x, y: depot.y, engine: engines.data[0].id});
    for (const stop of pair) await checked('append_order', {vehicle: bus.vehicle, x: stop.x, y: stop.y});
    await checked('toggle_vehicle', {vehicle: bus.vehicle});
  }
  while (true) {
    const status = await passenger.status();
    console.log(`Baseline day ${status.objective.days}: ${status.objective.delivered} delivered, cash ${status.objective.cash}, profit ${status.objective.operatingProfit}`);
    if (status.objective.achieved || status.objective.daysRemaining === 0) break;
    await checked('advance_days', {days: 15});
  }
  const result = await passenger.finish(undefined, 'baseline-complete');
  if (result.status !== 'success') throw new Error(`Feasibility baseline did not meet goal: ${JSON.stringify(result.objective)}`);
}

try {
  await writeFile(join(folder, 'goal.md'), await readFile(join(root, 'episodes', episode, 'goal.md')));
  await writeFile(join(folder, 'episode.json'), await readFile(join(root, 'episodes', episode, freight ? 'scenario.json' : 'episode.json')));
  await session.start();
  console.log(`OpenTTD ${baseline ? 'feasibility baseline' : 'Claude take'} ready: ${folder}`);
  if (baseline) await baselinePlay();
  else {
    const token = randomBytes(24).toString('hex');
    const server = createServer((request, response) => {
      if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return; }
      if (serial || stopping) { response.writeHead(409).end(); return; }
      let body = '';
      request.on('data', chunk => { body += chunk; if (body.length > 20000) request.destroy(); });
      request.on('end', () => {
        if (serial) { response.writeHead(409).end(); return; }
        serial = true;
        active = (async () => {
          try {
            const parsed = JSON.parse(body);
            if (!Object.hasOwn(definitions, parsed.tool)) throw new Error('Unknown tool');
            const result = freightSession ? await freightSession.execute(parsed.tool as FreightTool, parsed.args)
              : await passenger.execute(parsed.tool as ToolName, parsed.args);
            response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(result));
          } catch (error) {
            console.error(String(error));
            response.writeHead(500, {'content-type': 'application/json'}).end(JSON.stringify({ok: false, error: String(error)}));
          } finally { serial = false; }
        })();
      });
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as {port: number}).port;
    const config = join(folder, 'mcp-config.json');
    await writeFile(config, JSON.stringify({mcpServers: {'agent-world': {command: process.execPath,
      args: ['--import', 'tsx', join(root, 'src/mcp/openttd.ts')], cwd: root,
      env: {OPENTTD_SESSION_URL: `http://127.0.0.1:${port}`, OPENTTD_SESSION_TOKEN: token, OPENTTD_SCENARIO: freight ? 'freight' : 'passenger'}}}}, null, 2), {mode: 0o600});
    const goal = await readFile(join(folder, 'goal.md'), 'utf8');
    const prompt = freight ? goal + '\nPlay this live challenge now using the attached OpenTTD tools. Begin by observing the world. Aim for about twelve short public lines across meaningful decisions, including the initial plan, the first verified deliveries, any correction, and the measured outcome. Give a visual subject tile when talking about a specific site or truck. The calibration is separate. End with finish_session.\n' : goal;
    const args = ['--restricted', '--setting-sources', '', '--settings', '{"disableAllHooks":true,"autoMemoryEnabled":false,"claudeMdExcludes":["**"]}',
      '--disable-slash-commands', '--no-chrome', '--strict-mcp-config', '--print', '--no-session-persistence',
      '--permission-mode', 'dontAsk', '--tools', '', '--mcp-config', config, '--allowedTools', 'mcp__agent-world__*',
      '--output-format', 'stream-json', '--verbose', '--model', 'claude-opus-5-5', '--max-budget-usd', '15'];
    await writeFile(join(folder, 'player.json'), JSON.stringify({provider: 'Claude Code', requestedModel: 'claude-opus-5-5',
      maximumBudgetUSD: 15, toolBoundary: 'restricted MCP only', actor: 'claude', startedAt: new Date().toISOString()}, null, 2));
    child = spawn('claude', args, {cwd: folder, stdio: ['pipe', 'pipe', 'pipe']});
    child.stdin!.end(prompt);
    child.stdout!.pipe(createWriteStream(join(folder, 'transcript.jsonl')));
    child.stderr!.pipe(createWriteStream(join(folder, 'claude.stderr.log')));
    const heartbeat = setInterval(() => console.log(`Claude take: ${session.calls} calls, ${session.actions} actions, ${freightSession?.checkpoints.length ?? world.recording.captures.length} captured frames`), 30_000);
    const exit = await new Promise<number | null>((done, fail) => { child!.once('error', fail); child!.once('close', done); });
    clearInterval(heartbeat);
    await active;
    await new Promise<void>(done => server.close(() => done()));
    if (!session.finished) await session.finish(undefined, `claude-exit-${exit}`);
    console.log(`Claude exited ${exit}; ${join(folder, 'result.json')}`);
    if (exit !== 0) process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  await writeFile(join(folder, 'runner-error.json'), JSON.stringify({error: String(error), at: new Date().toISOString()}, null, 2));
  if (session.startDate && !session.finished) await session.finish(undefined, 'runner-error').catch(() => {});
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await world.close();
}
