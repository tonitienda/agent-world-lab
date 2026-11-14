import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const id = 'episode-009';
const folder = join(root, 'production', id);
const pub = join(root, 'production/public', id);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const source = json(join(folder, 'source.json'));
const take = join(root, source.session);
const options = process.argv.slice(2);
const run = args => execFileSync(process.execPath, args, {cwd: root, stdio: 'inherit', env: {...process.env, EPISODE_ID: id}});

if (!existsSync(join(take, 'result.json'))) {
  if (existsSync(take)) throw Error('The selected take already exists without a result. Inspect its logs before choosing a new take.');
  const calibration = json(join(root, source.calibration));
  const scenario = json(join(root, 'episodes', id, 'scenario.json'));
  if (!calibration.passed || Object.entries(scenario.proposedGoal).some(([key, value]) => calibration.target[key] !== value))
    throw Error('The clean native freight calibration must pass the selected goal before recording.');
  run(['--import', 'tsx', 'scripts/openttd-session.ts', '--freight', '--out', take]);
}
if (options.includes('--take-only')) process.exit(0);
if (!options.includes('--finalize-only')) {
  run(['--import', 'tsx', 'scripts/openttd-produce-freight.ts', '--manifest-only']);
  run(['scripts/elevenlabs-narration.mjs', id]);
  run(['--import', 'tsx', 'scripts/openttd-produce-freight.ts']);
}
run(['production/tools/episode.mjs']);

const output = join(root, 'production/output', id + '.mp4');
mkdirSync(join(root, 'production/output'), {recursive: true});
// The native still compositor has already rendered each visual beat and title
// to the directed track. Keep those exact frames and attach the validated mix.
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(pub, 'video/directed.mp4'),
  '-i', join(pub, 'generated/soundtrack.wav'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output + '.rendering.mp4'], {stdio: 'inherit'});
renameSync(output + '.rendering.mp4', output);
run(['production/tools/check-render.mjs']);

const {objective} = json(join(take, 'result.json'));
const plan = json(join(folder, 'edit-plan.json'));
const camera = json(join(folder, 'camera-plan.json'));
const model = json(join(take, 'player.json')).requestedModel;
const narration = json(join(folder, 'narration-manifest.json'));
const cues = json(join(folder, 'cash-cue-audit.json'));
const transcript = readFileSync(join(take, 'transcript.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const usage = transcript.findLast(event => event.type === 'result');
const assistantModels = [...new Set(transcript.filter(e => e.type === 'assistant' && e.message?.model).map(e => e.message.model))];
writeFileSync(join(folder, 'player-usage.json'), JSON.stringify({requestedModel: model, assistantModels,
  totalCostUSD: usage?.total_cost_usd, turns: usage?.num_turns}, null, 2) + '\n');
const chapterCandidates = new Map([
  ['Crossing the river', 'Building the crossing'],
  ['Wood reaches the sawmill', 'First sawmill deliveries'],
  ['Goods arrive in Eastmere', 'The town gets its goods'],
  ['The result', 'The final result'],
]);
let at = 0;
const chapters = [{at: 0, title: 'The challenge'}];
const used = new Set();
for (const beat of camera) {
  const title = chapterCandidates.get(beat.heading);
  if (title && !used.has(title) && at - chapters.at(-1).at >= 10 && plan.segments[0].duration - at >= 10) {
    chapters.push({at, title});
    used.add(title);
  }
  at += beat.frames / plan.fps;
}
const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
writeFileSync(join(folder, 'youtube.md'), [
  '# Forest to Market', '', '## Title', '', 'Can Claude Run a Freight Company and become a Tycoon in OpenTTD?', '',
  '## Description', '', 'A forest and a sawmill sit on opposite banks of a river. Claude has 240 game days to build a crossing, deliver 120 tonnes of wood and get 28 crates of goods to Eastmere. It starts with 40,000 and needs to finish profitable with at least 8,000 cash and no extra borrowing.',
  '', 'Claude made the decisions through a restricted game interface. The video uses sampled native OpenTTD gameplay with original public commentary spoken using synthetic voices.',
  '', ...(chapters.length >= 3 ? ['CHAPTERS', ...chapters.map(chapter => `${time(chapter.at)} ${chapter.title}`), ''] : []),
  'Game: OpenTTD 15.3. Graphics: OpenGFX2 Classic 0.8.1.', '', plan.music.attribution.text,
  '', '## Tags', '', 'OpenTTD, Transport Tycoon, tycoon, Claude, AI agents, freight, transport simulation, The Agent Terrarium', '',
].join('\n'));
writeFileSync(join(folder, 'editorial-report.md'), [
  '# Forest to Market editorial report', '',
  `Source: ${source.session}. The live Claude run is separate from the clean calibration.`, '',
  `Day ${objective.days}. Wood ${objective.wood}. Goods ${objective.goods}. Cash ${objective.cash}. Fleet operating profit ${objective.operatingProfit}. Outcome ${objective.achieved ? 'achieved' : 'incomplete'}.`,
  '', `${narration.filter(line => line.voice === 'agent').length} public Claude clips and ${narration.filter(line => line.voice === 'presenter').length} presenter clips, with ${cues.length} income chimes from the native freight income ledger.`,
  '', 'The camera uses native OpenGFX2 Classic screenshots from the recorded saves. The crops follow the recorded construction sites, real trucks and any mapped public narration subjects. Vehicle movement is sampled time-lapse. Visible cash receipts are grouped by sample interval, and the shared soundtrack mixer ducks the chimes under speech and keeps the mastered music at a steady level. The opening reveals the crossing over game footage and the presenter signs off after Claude’s result.',
  '', 'The final export uses the already composed camera track and validated shared soundtrack. The Motion Canvas preview reads the same media and timeline.',
  '', 'Rebuild from the preserved take with `node production/episode-009/run.mjs`. An unfinished take is never silently replayed.', '',
].join('\n'));
