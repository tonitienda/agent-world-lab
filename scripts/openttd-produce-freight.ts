import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {freightChime, freightFrame, freightReceipt, type FreightTarget} from '../packages/openttd/src/freight-presentation.js';
import type {FreightAction, FreightCheckpoint} from '../packages/openttd/src/freight-session.js';
import type {Position} from '../packages/openttd/src/camera.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const episode = 'episode-009';
const folder = join(root, 'production', episode);
const pub = join(root, 'production/public', episode);
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const write = (name: string, data: unknown) => writeFile(join(folder, name), JSON.stringify(data, null, 2) + '\n');
const source = await json(join(folder, 'source.json'));
const take = join(root, source.session);
const actions: FreightAction[] = await json(join(take, 'actions.json'));
const checkpoints: FreightCheckpoint[] = await json(join(take, 'checkpoints.json'));
const fixture = await json(join(take, 'fixture.json'));
const result = await json(join(take, 'result.json'));
const player = await json(join(take, 'player.json'));
assert.equal(result.actor, 'claude');
assert.ok(checkpoints.length > 1, 'Claude take has no recorded world progression');
const objective = result.objective;
const target: FreightTarget = objective.targets;
const selectionFile = join(folder, 'editorial-selection.json');
const selection: {events?: number[]; headings?: Record<string, string>; retrospective?: number[]} =
  existsSync(selectionFile) ? await json(selectionFile) : {};
const chosen = actions.filter(event => event.args.narration?.trim() && (!selection.events || selection.events.includes(event.id)));
assert.ok(chosen.length > 0, 'No public Claude narration to edit');
const voicedFinish = chosen.at(-1)?.tool === 'finish_session';
type Line = {line: number; audio: string; voice: 'agent' | 'presenter'; text: string; eventId?: number};
const money = (value: number) => value.toLocaleString('en-US');
const manifest: Line[] = [
  {voice: 'presenter' as const, text: 'Claude has 240 days to turn timber into profit. First, it has to cross this river.'},
  ...chosen.map(event => ({voice: 'agent' as const, text: event.args.narration, eventId: event.id})),
  ...(!voicedFinish ? [{voice: 'presenter' as const, text: `By day ${objective.days}, Claude had delivered ${objective.wood} tonnes of wood and ${objective.goods} crates of goods. It ended with ${money(objective.cash)} cash and ${money(objective.operatingProfit)} in fleet operating profit. ${objective.achieved ? 'Every condition was met.' : 'The challenge was incomplete.'}`}] : []),
  {voice: 'presenter' as const, text: 'Thanks for watching The Agent Terrarium. See you next time.'},
].map((line, index) => ({...line, line: index + 1, audio: `${index + 1}_Chapter_1.wav`}));
await write('narration-manifest.json', manifest);
await writeFile(join(folder, 'recording-sheet.md'), ['# Forest to Market narration', '',
  'Claude lines are public commentary from the live session. Presenter lines use the measured result.', '',
  ...manifest.flatMap(line => [`## ${line.audio} · ${line.voice}`, '', line.text, ''])].join('\n'));
if (process.argv.includes('--manifest-only')) {
  console.log(`Prepared ${manifest.length} clips with ${chosen.length} public Claude lines`);
  process.exit(0);
}

const probe = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'}));
const durations = manifest.map(line => probe(join(pub, 'audio', line.audio)));
assert.ok(durations.every(value => Number.isFinite(value) && value > 0));
const fps = 60;
type Beat = {checkpoint: number; frames: number; heading: string; focus: Position; width: number;
  voice?: number; card?: 'outro' | 'end'; receipt?: ReturnType<typeof freightReceipt>; receiptAt?: Position; expense?: {amount: number; label: string}; detail?: string};
const beats: Beat[] = [];
const add = (beat: Omit<Beat, 'frames'>, seconds: number) => beats.push({...beat, frames: Math.max(1, Math.ceil(seconds * fps))});
const chain = {x: 70, y: 76};
const building = new Set(['build_road', 'build_bridge', 'build_freight_stop', 'build_depot', 'build_vehicle']);
const shortHeading = (event: FreightAction) => selection.headings?.[event.id] ?? ({
  build_road: 'Connecting the route', build_bridge: 'Crossing the river', build_freight_stop: 'Building a freight stop',
  build_depot: 'A depot for the fleet', build_vehicle: 'Buying a truck', advance_days: 'Running the freight network',
  report_narration: 'Checking the plan', finish_session: 'The final check',
} as Partial<Record<FreightAction['tool'], string>>)[event.tool] ?? 'Managing the fleet';
const midpoint = (a: Record<string, any>): Position => typeof a.end_x === 'number'
  ? {x: (a.x + a.end_x) / 2, y: (a.y + a.end_y) / 2} : {x: a.x, y: a.y};
const planFocus = (event: FreightAction, frame: FreightCheckpoint): Position => event.args.visual_subject
  ?? (typeof event.args.x === 'number' ? midpoint(event.args) : frame.state.trucks.find(t => t.id === event.args.vehicle)?.position
    ?? frame.state.trucks.find(t => t.goods > 0 || t.wood > 0)?.position ?? chain);
const closest = (frame: FreightCheckpoint, p: Position) => [...frame.stations].sort((a, b) =>
  Math.abs(a.position.x - p.x) + Math.abs(a.position.y - p.y) - Math.abs(b.position.x - p.x) - Math.abs(b.position.y - p.y))[0];
const expenseFor = (event: FreightAction, before: FreightCheckpoint, after: FreightCheckpoint) => {
  if (!event.result?.ok || before.state.day !== after.state.day) return undefined;
  if (event.tool !== 'build_vehicle' && event.tool !== 'build_bridge') return undefined;
  const amount = before.state.balance - after.state.balance;
  return amount > 0 ? {amount, label: event.tool === 'build_bridge' ? 'BRIDGE CONSTRUCTION' : 'TRUCK PURCHASE'} : undefined;
};
const eventLines = new Map(manifest.filter(line => line.eventId !== undefined).map(line => [line.eventId, line]));
const seen = new Set<number>();
const crossing = actions.find(event => event.tool === 'build_bridge' && event.result?.ok && event.after !== undefined);
const river = crossing ? midpoint(crossing.args) : chain;
const hookSeconds = durations[0]! + .45;
const reveal = Math.min(2.4, hookSeconds / 2);
add({checkpoint: 0, focus: river, width: 730, heading: 'One river. Two freight routes.', voice: 1,
  detail: '240 game days · 40,000 starting cash'}, reveal);
add({checkpoint: crossing?.after ?? 0, focus: river, width: 650, heading: 'Build a freight company',
  detail: '120 tonnes of wood · 28 crates of goods'}, hookSeconds - reveal);
let lastVehicle: number | undefined;
let heldFocus: Position | undefined;
function checkpoint(index: number, event: FreightAction) {
  if (seen.has(index)) return;
  seen.add(index);
  const frame = checkpoints[index]!;
  const previous = checkpoints[index - 1];
  const receipt = previous && freightReceipt(previous.state, frame.state);
  const expense = previous && expenseFor(event, previous, frame);
  const wood = previous && frame.state.wood > previous.state.wood;
  const goods = previous && frame.state.goods > previous.state.goods;
  let receiptWood = !!wood, receiptGoods = !!goods;
  if (receipt && !wood && !goods) {
    // Cargo monitors can increment a day before the payment lands in the ledger.
    // Look for a nearby unload within the still-unpaid interval.
    for (let earlier = index - 1; earlier > 0; earlier--) {
      const current = checkpoints[earlier]!.state, prior = checkpoints[earlier - 1]!.state;
      if (frame.state.day - current.day > 3 || current.income !== prior.income) break;
      receiptWood ||= current.wood > prior.wood;
      receiptGoods ||= current.goods > prior.goods;
    }
  }
  const place = goods || receiptGoods ? fixture.destination.position : fixture.sawmill.position;
  const station = (wood || goods || receiptWood || receiptGoods) && closest(frame, place);
  const queue = frame.phase === 'operation' && frame.stations.find(station => {
    const old = previous?.stations.find(value => value.id === station.id);
    return Math.floor(station.wood_waiting / 20) > Math.floor((old?.wood_waiting ?? 0) / 20)
      || Math.floor(station.goods_waiting / 14) > Math.floor((old?.goods_waiting ?? 0) / 14);
  });
  if (frame.phase === 'operation' && !receipt && !wood && !goods && !queue && frame.state.day % 2 && index !== event.after) return;
  const truck = frame.state.trucks.find(t => t.id === lastVehicle && t.speed > 0)
    ?? frame.state.trucks.find(t => (t.wood > 0 || t.goods > 0) && t.speed > 0)
    ?? frame.state.trucks.find(t => t.speed > 0);
  lastVehicle = truck?.id;
  let focus = planFocus(event, frame);
  let width = event.tool === 'build_bridge' ? 650 : event.tool === 'build_road' ? 840 : 520;
  if (frame.phase === 'operation' && truck) {
    if (!heldFocus || Math.abs(heldFocus.x - truck.position.x) + Math.abs(heldFocus.y - truck.position.y) > 4)
      heldFocus = truck.position;
    focus = heldFocus;
    width = 620;
  } else heldFocus = undefined;
  if (queue) { focus = queue.position; width = 530; }
  if (station || wood || goods) { focus = station ? station.position : place; width = 650; }
  const heading = goods ? 'Goods arrive in Eastmere' : wood ? 'Wood reaches the sawmill'
    : receipt ? 'Delivery payment arrives' : queue ? 'Freight waiting at a stop' : frame.phase === 'operation' && !truck ? 'Waiting for freight' : shortHeading(event);
  add({checkpoint: index, heading, focus, width, receipt, expense,
    receiptAt: expense ? focus : station && receiptWood !== receiptGoods ? station.position : undefined,
    detail: queue && !receipt ? `${queue.wood_waiting} t wood · ${queue.goods_waiting} crates waiting`
      : truck && !receipt ? `Truck ${truck.id + 1} · ${truck.goods ? `${truck.goods} crates` : truck.wood ? `${truck.wood} tonnes` : 'empty'}` : undefined},
  (receipt || expense) ? 1.65 : (wood || goods) ? 1.15 : queue ? .75 : frame.phase === 'operation' ? .22 : building.has(event.tool) ? .7 : .3);
}

for (const event of actions) {
  if (event.after === undefined || (voicedFinish && event.tool === 'finish_session')) continue;
  const line = eventLines.get(event.id);
  const retrospective = selection.retrospective?.includes(event.id);
  const speak = (index: number, seconds?: number) => {
    if (!line) return;
    const frame = checkpoints[index]!;
    const subject = planFocus(event, frame);
    const queue = event.args.visual_subject && closest(frame, subject);
    const nearQueue = queue && Math.abs(queue.position.x - subject.x) + Math.abs(queue.position.y - subject.y) <= 3;
    add({checkpoint: index, heading: shortHeading(event), focus: subject, width: event.args.visual_subject ? 650 : 1350,
      voice: line.line, detail: nearQueue && (queue.wood_waiting || queue.goods_waiting)
        ? `${queue.wood_waiting} t wood · ${queue.goods_waiting} crates waiting` : undefined}, seconds ?? durations[line.line - 1]! + .55);
  };
  if (line && !retrospective && building.has(event.tool) && event.result?.ok && event.after > event.before) {
    const seconds = durations[line.line - 1]! + .55;
    const lead = Math.min(2.5, seconds / 2);
    speak(event.before, lead);
    const frame = checkpoints[event.after]!;
    const focus = planFocus(event, frame);
    const expense = expenseFor(event, checkpoints[event.before]!, frame);
    add({checkpoint: event.after, heading: shortHeading(event), focus, expense, receiptAt: expense ? focus : undefined,
      width: event.tool === 'build_bridge' ? 650 : 800}, seconds - lead);
    seen.add(event.after);
  } else if (!retrospective) speak(event.before);
  for (let index = event.before + 1; index <= event.after; index++) {
    if (event.tool === 'advance_days' || building.has(event.tool)) checkpoint(index, event);
  }
  if (retrospective) speak(event.after);
}
const outro = manifest.at(-2)!;
const end = manifest.at(-1)!;
add({checkpoint: checkpoints.length - 1, focus: chain, width: 3200, heading: 'The result', voice: outro.line, card: 'outro'},
  durations[outro.line - 1]! + .55);
add({checkpoint: checkpoints.length - 1, focus: river, width: 850, heading: 'Thanks for watching', voice: end.line, card: 'end'},
  durations[end.line - 1]! + 1.2);
const totalFrames = beats.reduce((sum, beat) => sum + beat.frames, 0);
const duration = totalFrames / fps;
const visualFrames = join(take, 'freight-edit-frames');
const nativeFrames = join(take, 'native-png');
await mkdir(visualFrames, {recursive: true});
await mkdir(nativeFrames, {recursive: true});
for (const path of ['video', 'effects', 'music']) await mkdir(join(pub, path), {recursive: true});
const runtimeArchive = await readFile(join(root, 'data/openttd-runtime/OpenGFX2_Classic-0.8.1.tar'));
assert.equal(createHash('sha256').update(runtimeArchive).digest('hex'), source.graphicsSha256, 'Unexpected graphics archive');
const exec = (bin: string, args: string[], input?: string) =>
  execFileSync(bin, args, {cwd: root, input, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']});
const encode = (args: string[]) => exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const darkCard = (svg: string, kind: Beat['card']) => {
  if (!kind) return svg;
  const lines = kind === 'end' ? ['The Agent Terrarium', ''] :
    [`${objective.wood} tonnes of wood  ·  ${objective.goods} crates of goods`,
      `${objective.days} days  ·  ${money(objective.cash)} cash  ·  ${money(objective.operatingProfit)} fleet profit`];
  const title = kind === 'end' ? 'Thanks for watching' : objective.achieved ? 'Challenge complete' : 'The measured result';
  return svg.slice(0, svg.indexOf('<rect width="1920"')) + `
    <rect width="1920" height="1080" fill="#081813" opacity=".75"/>
    <rect x="115" y="363" width="8" height="289" rx="4" fill="#bbf98f"/>
    <text x="150" y="407" font-size="27" letter-spacing="6" fill="#bbf98f">THE AGENT TERRARIUM / OPENTTD</text>
    <text x="150" y="503" font-size="90" font-weight="700">${title}</text>
    <text x="150" y="585" font-size="36">${lines[0]}</text>
    <text x="150" y="638" font-size="34" fill="#d8e9df">${lines[1]}</text>
  </svg>`;
};
const concat: string[] = [];
const speech: {line: number; audio: string; at: number}[] = [];
const sounds: {id: string; at: number; amount: number; checkpoint: number}[] = [];
let tick = 0;
let lastCue = -Infinity;
for (const [index, beat] of beats.entries()) {
  const frame = checkpoints[beat.checkpoint]!;
  const native = join(nativeFrames, frame.save.replace('.sav', '.png'));
  if (!existsSync(native)) exec(process.execPath, ['--import', 'tsx', 'scripts/openttd-native-screenshot.ts', join(take, frame.save), native, 'classic']);
  const png = await readFile(native);
  const svg = freightFrame(png, frame.state, target, {focus: beat.focus, cropWidth: beat.width, heading: beat.heading,
    skin: 'OpenGFX2 Classic', attribution: 'CLAUDE · SAMPLED GAMEPLAY', detail: beat.detail ?? 'Forest → Sawmill → Eastmere',
    receipt: beat.receipt, receiptAt: beat.receiptAt, expense: beat.expense});
  const out = join(visualFrames, `${String(index).padStart(4, '0')}.png`);
  exec('rsvg-convert', ['-w', '3840', '-h', '2160', '-o', out], darkCard(svg, beat.card));
  concat.push(`file '${relative(take, out)}'`, 'option framerate 60', `duration ${(beat.frames / fps).toFixed(9)}`);
  if (beat.voice) speech.push({line: beat.voice, audio: manifest[beat.voice - 1]!.audio, at: tick / fps + .27});
  if (beat.receipt && tick - lastCue >= 2 * fps) {
    sounds.push({id: beat.receipt.id, at: tick / fps + .03, amount: beat.receipt.amount, checkpoint: beat.checkpoint});
    lastCue = tick;
  }
  tick += beat.frames;
  if (index % 12 === 0) console.log(`Composed frame ${index + 1}/${beats.length}`);
}
assert.equal(speech.length, manifest.length, 'Each voiced line needs exactly one scheduled beat');
concat.push(`file 'freight-edit-frames/${String(beats.length - 1).padStart(4, '0')}.png'`, 'option framerate 60');
await writeFile(join(take, 'freight-edit.ffconcat'), concat.join('\n') + '\n');
const directed = join(pub, 'video/directed.mp4');
const partial = join(pub, 'video/directed.rendering.mp4');
encode(['-f', 'concat', '-safe', '0', '-i', join(take, 'freight-edit.ffconcat'), '-vf', 'fps=60,format=yuv420p',
  '-frames:v', String(totalFrames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-movflags', '+faststart', partial]);
await rename(partial, directed);

const chime = join(pub, 'effects/cash-chime.wav');
await writeFile(chime, freightChime());
const effectTrack = join(pub, 'effects/cash-events.wav');
if (sounds.length) {
  const split = sounds.length > 1 ? `[0:a]asplit=${sounds.length}${sounds.map((_, i) => `[s${i}]`).join('')};` : '';
  const delays = sounds.map((cue, i) =>
    `[${sounds.length > 1 ? `s${i}` : '0:a'}]adelay=${Math.round(cue.at * 1000)}:all=1[c${i}]`).join(';');
  encode(['-i', chime, '-filter_complex', `${split}${delays};${sounds.map((_, i) => `[c${i}]`).join('')}amix=inputs=${sounds.length}:normalize=0,apad[out]`,
    '-map', '[out]', '-t', String(duration), '-ar', '48000', '-c:a', 'pcm_s16le', effectTrack]);
}
const previousMusic = (await json(join(root, 'production/episode-007/edit-plan.json'))).music;
const masteredMusic = 'clean-soul-audible.mp3';
encode(['-i', join(root, 'production/public/episode-007/music', previousMusic.file),
  '-af', 'loudnorm=I=-20:TP=-4:LRA=8', '-ar', '48000', '-b:a', '192k', join(pub, 'music', masteredMusic)]);
const plan = {version: 2, title: 'Forest to Market', fps, resolution: {width: 3840, height: 2160},
  music: {...previousMusic, file: masteredMusic, volume: .40, duck: false, fadeIn: .35, fadeOut: 1.1},
  ...(sounds.length ? {effects: {file: 'cash-events.wav', volume: .65, duck: true}} : {}),
  cameras: [{id: 'directed', file: 'directed.mp4', offsetSeconds: 0}],
  segments: [{id: 'forest-to-market', kind: 'shot', duration, shot: {kind: 'full', cameras: ['directed'], start: 0, duration}, narration: speech}]};
await write('edit-plan.json', plan);
await write('camera-plan.json', beats);
await write('cash-cue-audit.json', sounds);
await write('narration-timing.json', speech.map(clip => ({...clip, duration: durations[clip.line - 1]})));
await writeFile(join(folder, 'project.ts'), "import {makeProject} from '@motion-canvas/core';\nimport scene from './scene?scene';\nimport {episodeExporter} from '../src/exporter';\nexport default makeProject({scenes:[scene], audio:'/episode-009/generated/soundtrack.wav', plugins:[episodeExporter]});\n");
await writeFile(join(folder, 'scene.tsx'), "import plan from './edit-plan.json';\nimport {createEpisodeScene, type EpisodePlan} from '../src/scenes/episode';\nexport default createEpisodeScene(plan as EpisodePlan, 'episode-009');\n");
await write('production-build.json', {source: source.session, duration, frames: totalFrames, speechClips: manifest.length,
  cues: sounds.length, model: player.requestedModel, video: 'Native OpenTTD screenshots from synchronized saved checkpoints; cut and encoded with FFmpeg'});
console.log(`Prepared ${duration.toFixed(2)} seconds of directed gameplay at 4K/60`);
