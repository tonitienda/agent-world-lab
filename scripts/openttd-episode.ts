import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile, writeFile, mkdir, copyFile, rename} from 'node:fs/promises';
import {join, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {direct, renderCamera, type Capture, type Recording, type CameraPlan} from '../packages/openttd/src/camera.js';
import type {ActionRecord} from '../packages/openttd/src/session.js';
import {applyNarrationCameras, type NarrationCue} from '../packages/openttd/src/narration-camera.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const episode = 'episode-007';
const folder = join(root, 'production', episode);
const publicFolder = join(root, 'production/public', episode);
const options = process.argv.slice(2);
const source = JSON.parse(await readFile(join(folder, 'source.json'), 'utf8'));
const run = resolve(root, source.session);
const actions: ActionRecord[] = JSON.parse(await readFile(join(run, 'actions.json'), 'utf8'));
const result = JSON.parse(await readFile(join(run, 'result.json'), 'utf8'));
const recording: Recording = JSON.parse(await readFile(join(run, 'captures.json'), 'utf8'));
if (result.actor !== 'claude') throw new Error('Episode 007 requires an actual Claude take, never a scripted baseline');
recording.actorLabel = 'Claude Opus 5.5 · solo experiment';
recording.episode = episode;
recording.goal = {passengers: 200, days: 120, minimumCash: 5000};
const write = async (name: string, value: any) => writeFile(join(folder, name), JSON.stringify(value, null, 2) + '\n');
const money = (n: number) => n.toLocaleString('en-US');

type Line = {line: number; audio: string; voice: 'agent' | 'presenter'; text: string; kind: string; eventId?: number; source: any};
const selectionFile = join(folder, 'editorial-selection.json');
const selection: {omitEvents?: number[]; notes?: Record<string, string>} = existsSync(selectionFile)
  ? JSON.parse(await readFile(selectionFile, 'utf8')) : {};
const omitted = new Set(selection.omitEvents ?? []);
const chosen = actions.filter(event => event.args.narration?.trim() && !omitted.has(event.id));
const verified = {kind: 'editorial-presenter', verifiedAgainst: relative(folder, join(run, 'result.json'))};
const rawLines: Omit<Line, 'line' | 'audio'>[] = [
  {voice: 'presenter', kind: 'intro', text: 'Today, Claude is starting a bus company in OpenTTD. Two hundred passengers, one hundred and twenty game days, and no extra borrowing.', source: verified},
  {voice: 'presenter', kind: 'intro', text: 'It starts with twenty thousand. By the end, it needs at least five thousand cash and a profitable fleet. Claude makes every decision.', source: verified},
  ...chosen.map(event => ({voice: 'agent' as const, kind: event.tool === 'finish_session' ? 'result' : 'commentary',
    eventId: event.id, text: event.args.narration.trim(), source: {kind: 'recorded-public-commentary',
      file: relative(folder, join(run, 'actions.json')), eventId: event.id, field: 'args.narration', tool: event.tool}})),
  {voice: 'presenter', kind: 'outro', text: result.objective.achieved
    ? `Claude met every target. ${result.objective.delivered} passengers delivered in ${result.objective.days} game days, with ${money(result.objective.cash)} cash left and a profitable bus fleet.`
    : `The experiment ended after ${result.objective.days} game days. Claude delivered ${result.objective.delivered} passengers and finished with ${money(result.objective.cash)} cash. It did not meet every target.`, source: verified},
  {voice: 'presenter', kind: 'end', text: "Would this company work better with two agents? We'll test collaboration in a later terrarium. Thanks for watching.", source: verified},
];
const presenterFile = join(folder, 'presenter-lines.json');
const presenterDefaults = Object.fromEntries(rawLines.filter(line => line.voice === 'presenter')
  .map((line, index) => [`${line.kind}-${index + 1}`, line.text]));
if (!existsSync(presenterFile)) await write('presenter-lines.json', presenterDefaults);
const presenter = JSON.parse(await readFile(presenterFile, 'utf8'));
let presenterIndex = 0;
for (const line of rawLines) if (line.voice === 'presenter') {
  const key = `${line.kind}-${++presenterIndex}`;
  if (typeof presenter[key] !== 'string' || !presenter[key].trim()) throw new Error(`Missing presenter copy ${key}`);
  line.text = presenter[key];
  line.source = {...line.source, generator: 'presenter-lines.json'};
}
const manifest: Line[] = rawLines.map((line, i) => ({...line, line: i + 1, audio: `${i + 1}_Chapter_1.wav`}));
await write('narration-manifest.json', manifest);
await writeFile(join(folder, 'narration.txt'), manifest.map(line => line.text).join('\n') + '\n');
await writeFile(join(folder, 'expected-audio.txt'), manifest.map(line => line.audio).join('\n') + '\n');
for (const speaker of ['agent', 'presenter'] as const) {
  const lines = manifest.filter(line => line.voice === speaker);
  await writeFile(join(folder, `narration-${speaker}.txt`), lines.map(line => line.text).join('\n') + '\n');
  await write(`narration-${speaker}-files.json`, lines.map((line, i) => ({row: i + 1, line: line.line, audio: line.audio, text: line.text})));
}
await writeFile(join(folder, 'recording-sheet.md'), [
  '# Episode 007 — narration recording sheet', '',
  `${manifest.length} clips: ${chosen.length} AGENT and ${manifest.length - chosen.length} PRESENTER.`, '',
  'Agent speech is verbatim public commentary recorded during the game. Presenter speech is editorial and verified against the final game state.',
  'Generate one complete WAV per master line, with its exact filename. Speaker subsets retain the same master IDs.', '',
  ...manifest.flatMap(line => [`## ${line.line}. ${line.voice.toUpperCase()} — ${line.audio}`, '',
    line.eventId === undefined ? `Placement: ${line.kind}.` : `Source: recorded action ${line.eventId}, ${line.source.tool}.`, '', line.text, '']),
].join('\n'));
await writeFile(join(folder, 'README.md'), `# Episode 007 — Claude Transit\n\nSource: \`${source.session}\`.\n\nRun \`node production/episode-007/prepare.mjs --generate-audio --render\` to resume production from the saved take. This never starts another game.\n\nThe master manifest preserves exact agent speech, filenames and separate AGENT/PRESENTER voice mapping. The camera study is daily sampled time-lapse; construction/decision holds are explicitly editorial. Game time is paused while Claude thinks.\n\nThe game objective is 200 delivered passengers within 120 economy days, at least 5,000 ending cash, positive fleet operating profit, no borrowing above 20,000 and at most three buses. A scripted baseline established feasibility separately. It is not used as Claude footage.\n`);
console.log(`Prepared ${manifest.length} narration clips (${chosen.length} authentic Claude lines).`);
if (!options.includes('--with-audio')) process.exit(0);

const audioDuration = (name: string): number => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'csv=p=0', join(publicFolder, 'audio', name)], {encoding: 'utf8'}));
const durations = new Map(manifest.map(line => [line.line, audioDuration(line.audio)]));
if ([...durations.values()].some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Missing/invalid narration WAVs');
await write('source.json', {...source, audioStatus: 'Complete: ElevenLabs Eleven V4; Bella presenter and Larry agent; all master WAVs present and measured.',
  result: result.objective, audioManifest: 'elevenlabs-audio.json'});
const frame = (seconds: number) => Math.ceil(seconds * 60) / 60;

// Preserve all original captures. Only replace editorial headings in the derived view.
const copy: Recording = structuredClone(recording);
const labels: Record<string, [string, string]> = {
  build_stop: ['A site for the next passenger stop', 'Passenger stop built'],
  build_depot: ['A home for the fleet', 'Bus depot built'],
  build_road: ['Connecting the route', 'Road connection built'],
  build_vehicle: ['Adding a bus to the fleet', 'A new bus, ready for orders'],
};
for (const capture of copy.captures as (Capture & {eventId?: number; phase?: string})[]) {
  const event = actions.find(event => event.id === capture.eventId);
  if (event && labels[event.tool]) capture.label = event.result?.ok === false && capture.phase === 'after'
    ? 'Construction rejected' : labels[event.tool]![capture.phase === 'after' ? 1 : 0];
}
const cameraFile = join(folder, 'camera-plan.json');
const existing: CameraPlan | undefined = existsSync(cameraFile) ? JSON.parse(await readFile(cameraFile, 'utf8')) : undefined;
const camera = existing ?? direct(copy);
const narrationCameraFile = join(folder, 'narration-cameras.json');
if (existsSync(narrationCameraFile)) {
  const cues: NarrationCue[] = JSON.parse(await readFile(narrationCameraFile, 'utf8'));
  await write('narration-camera-audit.json', applyNarrationCameras(copy, camera, actions, cues));
}
if (camera.shots.length !== copy.captures.length || camera.shots.some((shot, i) => shot.capture !== i))
  throw new Error('Episode timing requires one chronological camera sample per capture');
// Base pacing: real operating days run fast; paused tool transactions are brief.
for (const [i, shot] of camera.shots.entries()) {
  const capture = copy.captures[i]!;
  shot.duration = frame(capture.kind === 'construction' ? 0.55 : capture.kind === 'outcome' ? 1.5 : 0.25);
}
for (const line of manifest.filter(line => line.voice === 'agent')) {
  const event = actions.find(event => event.id === line.eventId)!;
  const start = event.beforeCapture, end = event.afterCapture;
  if (start === undefined || end === undefined || end < start) throw new Error(`Missing capture range for action ${event.id}`);
  const need = durations.get(line.line)! + 0.9;
  if (start === end) camera.shots[start]!.duration = frame(Math.max(camera.shots[start]!.duration, need));
  else {
    camera.shots[start]!.duration = frame(Math.max(camera.shots[start]!.duration, 2.4));
    const span = camera.shots.slice(start, end + 1).reduce((sum, shot) => sum + shot.duration, 0);
    if (span < need) {
      // Spread extra coverage across chronological operating frames rather than looping the action.
      const extra = (need - span) / (end - start);
      for (let i = start + 1; i <= end; i++) camera.shots[i]!.duration = frame(camera.shots[i]!.duration + extra);
    }
  }
}
await write('camera-plan.json', camera);
const starts: number[] = [];
let gameDuration = 0;
for (const shot of camera.shots) { starts.push(gameDuration); gameDuration += shot.duration; }
gameDuration = frame(gameDuration);
const agentSchedule = manifest.filter(line => line.voice === 'agent').map(line => {
  const event = actions.find(event => event.id === line.eventId)!;
  return {line: line.line, audio: line.audio, at: starts[event.beforeCapture!]! + 0.35};
});
for (const [i, voice] of agentSchedule.entries()) {
  const end = voice.at + durations.get(voice.line)!;
  if (i && voice.at < agentSchedule[i - 1]!.at + durations.get(agentSchedule[i - 1]!.line)! + 0.25)
    throw new Error('Agent narration overlap');
  if (end + 0.3 > gameDuration) throw new Error('Narration outside source film');
}

await mkdir(join(publicFolder, 'video'), {recursive: true});
const frames = join(run, 'episode-camera-frames');
await mkdir(frames, {recursive: true});
const concat: string[] = [];
for (const [i, shot] of camera.shots.entries()) {
  const capture = copy.captures[i]!;
  const svg = renderCamera(capture, shot, copy, await readFile(join(run, capture.image)));
  const file = `${String(i).padStart(5, '0')}.png`;
  const fingerprint = createHash('sha256').update('3840x2160\n' + svg).digest('hex');
  const marker = join(frames, file + '.sha256');
  const cached = existsSync(marker) && existsSync(join(frames, file)) && (await readFile(marker, 'utf8')) === fingerprint;
  if (!cached) {
    const staging = join(frames, file + '.rendering.png');
    execFileSync('rsvg-convert', ['-w', '3840', '-h', '2160', '-o', staging], {input: svg});
    await rename(staging, join(frames, file));
    await writeFile(marker, fingerprint);
  }
  concat.push(`file 'episode-camera-frames/${file}'`, `duration ${shot.duration}`);
  if (i % 25 === 0) console.log(`Episode camera ${i + 1}/${camera.shots.length}`);
}
const lastFrame = `episode-camera-frames/${String(camera.shots.length - 1).padStart(5, '0')}.png`;
concat.push(`file '${lastFrame}'`, 'duration 0.6', `file '${lastFrame}'`);
const list = join(run, 'episode-camera.ffconcat');
await writeFile(list, concat.join('\n') + '\n');
const video = join(publicFolder, 'video/directed.mp4');
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '1', '-i', list,
  '-vf', 'fps=60,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-t', String(gameDuration + 0.5),
  '-movflags', '+faststart', video]);
// Include half a second of tail coverage so source bounds remain strict.
const introLines = manifest.filter(line => line.kind === 'intro');
let introLength = 0.35;
const introVoices = introLines.map(line => {
  const voice = {line: line.line, audio: line.audio, at: introLength};
  introLength += durations.get(line.line)! + 0.45;
  return voice;
});
const introDuration = frame(introLength + 0.3);
const outro = manifest.find(line => line.kind === 'outro')!;
const end = manifest.find(line => line.kind === 'end')!;
const outroDuration = frame(durations.get(outro.line)! + 0.8);
const endDuration = frame(durations.get(end.line)! + 10.8);
const reference = JSON.parse(await readFile(join(root, 'production/episode-005/edit-plan.json'), 'utf8'));
await mkdir(join(publicFolder, 'music'), {recursive: true});
await copyFile(join(root, 'production/public/episode-005/music/clean-soul.mp3'), join(publicFolder, 'music/clean-soul.mp3'));
const plan = {
  version: 2, title: 'Episode 007 — Claude Transit', fps: 60, resolution: {width: 3840, height: 2160},
  music: {...reference.music, volume: 0.12, fadeIn: 2, fadeOut: 4},
  cameras: [{id: 'directed', file: 'directed.mp4', offsetSeconds: 0}],
  segments: [
    {id: 'opening', kind: 'intro', duration: introDuration, background: {camera: 'directed', time: 0},
      text: 'EPISODE 007 · CLAUDE TRANSIT\nSOLO RUN · GAME 1\n200 passengers · 120 days\nStart with 20,000 · Finish with at least 5,000 cash', narration: introVoices},
    {id: 'commuter-challenge', kind: 'shot', duration: gameDuration, transition: 0.2,
      narration: agentSchedule, shot: {kind: 'full', cameras: ['directed'], start: 0, duration: gameDuration}},
    {id: 'verified-result', kind: 'outro', duration: outroDuration, transition: 0.3,
      background: {camera: 'directed', time: Math.max(0, gameDuration - 0.1)},
      text: `${result.objective.achieved ? 'OBJECTIVE ACHIEVED' : 'THE MEASURED RESULT'}\n${result.objective.delivered} passengers · ${result.objective.days} days\nCash ${money(result.objective.cash)} · Fleet profit ${money(result.objective.operatingProfit)}`,
      narration: [{line: outro.line, audio: outro.audio, at: 0.35}]},
    {id: 'end-screen', kind: 'outro', duration: endDuration, transition: 0.3,
      background: {camera: 'directed', time: Math.max(0, gameDuration - 0.1)},
      text: 'One agent today. A team in a later terrarium.\nWhat should Claude try next?', narration: [{line: end.line, audio: end.audio, at: 0.35}]},
  ],
};
await write('edit-plan.json', plan);
await writeFile(join(folder, 'project.ts'), "import {makeProject} from '@motion-canvas/core';\nimport scene from './scene?scene';\nimport {episodeExporter} from '../src/exporter';\nexport default makeProject({scenes:[scene],audio:'/episode-007/generated/soundtrack.wav',plugins:[episodeExporter]});\n");
await writeFile(join(folder, 'scene.tsx'), "import plan from './edit-plan.json';\nimport {createEpisodeScene, type EpisodePlan} from '../src/scenes/episode';\nexport default createEpisodeScene(plan as EpisodePlan, 'episode-007');\n");
const timing = manifest.map(line => {
  const event = actions.find(event => event.id === line.eventId);
  const voice = agentSchedule.find(voice => voice.line === line.line);
  return {line: line.line, speaker: line.voice, eventId: line.eventId, duration: durations.get(line.line),
    audio: line.audio, source: line.source, narrationStartInGame: voice?.at,
    visualBeforeInGame: event?.beforeCapture === undefined ? undefined : starts[event.beforeCapture],
    visualAfterInGame: event?.afterCapture === undefined ? undefined : starts[event.afterCapture],
    planningLeadSeconds: voice && event?.afterCapture !== undefined ? starts[event.afterCapture]! - voice.at : undefined};
});
await write('narration-timing.json', timing);
await write('production-build.json', {session: source.session, captures: recording.captures.length, gameDuration,
  duration: plan.segments.reduce((sum, segment) => sum + segment.duration, 0), narrationClips: manifest.length,
  sourceHash: createHash('sha256').update(await readFile(join(run, 'actions.json'))).digest('hex'),
  audioHashes: Object.fromEntries(await Promise.all(manifest.map(async line => [line.audio,
    createHash('sha256').update(await readFile(join(publicFolder, 'audio', line.audio))).digest('hex')])))});
await writeFile(join(folder, 'editorial-report.md'), [
  '# Episode 007 — editorial report', '',
  `Source: ${source.session}. Claude Opus 5.5 played through restricted MCP tools. The scripted feasibility run is excluded from episode footage.`, '',
  `Measured result: ${result.objective.delivered} delivered passengers after ${result.objective.days} days; cash ${result.objective.cash}; combined bus operating profit ${result.objective.operatingProfit}; objective ${result.objective.achieved ? 'achieved' : 'not achieved'}.`, '',
  `${manifest.length} narration clips: ${chosen.length} recorded public AGENT statements and ${manifest.length - chosen.length} editorial PRESENTER lines. No private thinking blocks or fabricated agent speech are used.`, '',
  'The cut follows every captured action and operating day chronologically. Short routine tool captures are compressed; whole selected narration clips are retained. Plans start over their real pre-action capture, normally at least two seconds before the recorded action result. Observations and the ending use state captured after the evidence exists.', '',
  'The camera director uses construction sites, measured passenger queues, vehicle load changes, actual operating income/deliveries and bus-follow views. Close-ups include a map inset. Buildings are transparent only in the observer render. Cameras are crops of one isometric world capture, not physically separate 3D views.', '',
  'Narration-led coverage is defined in narration-cameras.json: each recorded spoken action names its actual town, stop, bus or position. These cues take priority during the corresponding utterance. A synchronized top-right detail inset shows the mentioned stop/bus where useful, including current measured waiting/load counts. narration-camera-audit.json records the source ranges and subjects. The subject mapping is an explicit editorial decision, not an automatic claim of language understanding.', '',
  'Gameplay is daily sampled time-lapse with intentional paused construction/decision holds. Export is 3840×2160 at 60 fps; daily samples do not acquire continuous motion or additional sprite detail. No game audio was captured. The existing licensed Clean Soul music bed is ducked under the complete ElevenLabs voice clips.', '',
  'Both preview and final export use the shared Motion Canvas scene, edit plan and mixed soundtrack. Source PNGs, action logs and voice files are preserved. camera-plan.json and narration-timing.json describe the derived camera cut and voice-to-action mapping.', '',
  'The first 4K master was fully rendered in Motion Canvas. Camera-only revisions may reuse its unchanged cards, fades and original audio stream while refreshing the one untransformed full-frame gameplay source. The incremental export refuses changed timelines, narration, soundtrack, composition or boundary images. camera-refresh.json records the reused master and exact replaced frame range. The project preview reads the same updated source video.', '',
  `Agent events omitted from speech: ${[...omitted].join(', ') || 'none'}. Omitted speech is not rewritten or reassigned.`, '',
  'Validation: run the shared episode validator, production type check, export checker, full decode and sample opening, construction, queue, boarding, delivery and ending frames. Frame samples and volume measurements are not a claim of a full perceptual watch/listen.', '',
].join('\n'));
console.log(`Prepared measured episode: ${(gameDuration + introDuration + outroDuration + endDuration).toFixed(2)} seconds, 4K/60.`);
