import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = join(root, 'production/episode-007');
const load = async (name: string) => JSON.parse(await readFile(join(folder, name), 'utf8'));
const [plan, validation, render, source, build, camera] = await Promise.all([
  load('edit-plan.json'), load('validation.json'), load('render-validation.json'), load('source.json'),
  load('production-build.json'), load('camera-plan.json'),
]);
if (!render.decoded || render.blackIntervals.length || Math.abs(render.duration - validation.duration) > 0.08)
  throw new Error('YouTube copy requires a validated final export');
const result = JSON.parse(await readFile(join(root, source.session, 'result.json'), 'utf8'));
const actions = JSON.parse(await readFile(join(root, source.session, 'actions.json'), 'utf8'));
const introDuration = plan.segments.find((s: any) => s.id === 'opening').duration;
const cameraTimes: number[] = [];
let cameraTime = introDuration;
for (const shot of camera.shots) { cameraTimes.push(cameraTime); cameraTime += shot.duration; }
const candidates = [{time: 0, title: 'The commuter challenge'}, {time: introDuration, title: "Claude's route and spending plan"}];
const firstBus = actions.find((a: any) => a.tool === 'build_vehicle' && a.result?.ok);
if (firstBus) candidates.push({time: cameraTimes[firstBus.beforeCapture]!, title: 'Buying and routing the buses'});
for (const [kind, title] of [['queue', 'The passenger backlog'], ['boarding', 'The first passengers board'], ['delivery', 'Deliveries and operating profit']]) {
  const index = camera.shots.findIndex((shot: any) => shot.camera === kind);
  if (index >= 0) candidates.push({time: cameraTimes[index]!, title: title!});
}
const resultStart = plan.segments.slice(0, 2).reduce((sum: number, segment: any) => sum + segment.duration, 0);
candidates.push({time: resultStart, title: 'The verified result'});
const chapters: {time: number; title: string}[] = [];
for (const chapter of candidates.sort((a, b) => a.time - b.time)) {
  const time = Math.floor(chapter.time);
  if (render.duration - time < 10 || (chapters.length && time - chapters.at(-1)!.time < 10)) continue;
  chapters.push({time, title: chapter.title});
}
if (chapters.length < 3 || chapters[0]!.time !== 0) throw new Error('Need at least three correctly spaced chapters');
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const goal = result.objective;
const tags = ['Claude', 'Claude Opus 5.5', 'OpenTTD', 'AI plays OpenTTD', 'Transport Tycoon', 'AI agent', 'MCP',
  'AI simulation', 'AI gaming', 'The Agent Terrarium', 'autonomous agents', 'bus company', 'transport simulation'];
const content = [
  '# Episode 007 — YouTube upload copy', '',
  '## Recommended title', '', 'Can Claude Run a Bus Company in OpenTTD?', '',
  '## Alternatives', '', '- Claude Builds a Bus Company With a 20,000 Budget',
  '- 200 Passengers. 120 Days. One AI Bus Company.', '',
  'These are editorial candidates, not scored CTR predictions.', '',
  '## Description', '',
  "We gave Claude Opus 5.5 a transport company, a 20,000 budget, and a deadline. Its job: deliver 200 passengers within 120 OpenTTD game days and finish with at least 5,000 cash and a profitable bus fleet — without extra borrowing.", '',
  'Claude chooses the stops, depot, buses, orders and spending decisions through restricted game tools. The simulation runs in the real OpenTTD engine. We follow construction, passenger queues, boarding and deliveries as the plan meets the actual game.', '',
  'This is our first single-agent transport experiment. A later terrarium will test collaboration.', '',
  'CHAPTERS', ...chapters.map(chapter => `${clock(chapter.time)} ${chapter.title}`), '',
  'EXPERIMENT NOTES',
  '- Agent: Claude Opus 5.5, using game-only MCP tools.',
  '- Game: OpenTTD 15.3 with OpenGFX 8.0; one seeded trial.',
  '- Goal: 200 delivered passengers, at least 5,000 ending cash, positive fleet operating profit, 120-day deadline.',
  '- Limits: no borrowing above the starting 20,000 loan; at most three buses.',
  '- Gameplay is shown as a daily time-lapse, with paused decision and construction footage.',
  '- Agent narration is synthesized from its recorded public commentary. Presenter narration is editorial. Both use ElevenLabs voices.',
  '- One experiment does not establish general ability or a model ranking.', '',
  'OpenTTD: https://www.openttd.org/', '', 'MUSIC', plan.music.attribution.text, '',
  '#OpenTTD #Claude #AIAgents', '',
  '## Verified outcome — internal upload notes', '',
  `${goal.achieved ? 'All targets met' : 'Not all targets met'}. ${goal.delivered} passengers delivered in ${goal.days} economy days. Ending cash: ${goal.cash}. Loan: ${goal.loan}. Combined bus operating profit: ${goal.operatingProfit}.`, '',
  'Operating profit is a vehicle figure and excludes construction investment; ending cash is checked separately.', '',
  '## Tags', '', tags.join(', '), '',
  '## Thumbnail direction', '',
  'Use an actual frame of the bus stops with their measured waiting queues. Pair the game image with the goal “200 PASSENGERS” and a small Claude label. Show the budget/deadline as stakes; do not invent a breakdown or fake a delivery count.', '',
  '## End screen and upload checks', '',
  `- Final duration: ${clock(render.duration)} (${render.duration.toFixed(3)} seconds).`,
  `- Reserve ${clock(render.duration - 10)}–${clock(render.duration)} for the end-screen elements.`,
  '- Language: English. Category: Gaming. Game: OpenTTD.',
  '- Review synthetic-voice disclosure and the platform upload fields before publishing.',
  '- This file does not upload, publish or change any YouTube metadata.', '',
  `Source: ${source.session}. Final export: production/output/episode-007.mp4. Narration clips: ${build.narrationClips}.`, '',
].join('\n');
await writeFile(join(folder, 'youtube.md'), content);
console.log(`YouTube copy generated from the validated ${render.duration.toFixed(2)}-second export.`);
