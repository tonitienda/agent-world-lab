import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {freightChime, freightFrame, freightReceipt, type FreightSample, type FreightTarget} from '../packages/openttd/src/freight-presentation.js';

const [run, dayArgument, source, output, skin] = process.argv.slice(2);
if (!run || !dayArgument || !source || !output || !skin)
  throw new Error('Usage: node --import tsx scripts/openttd-freight-preview.ts RUN DAY NATIVE.png OUTPUT.png SKIN [bridge|mill|market|truck] [local-cue]');
const scene = process.argv[7] ?? 'market';
const {samples, target}: {samples: FreightSample[]; target: FreightTarget} =
  JSON.parse(await readFile(join(run, 'calibration.json'), 'utf8'));
const index = samples.findIndex(sample => sample.day === Number(dayArgument));
const sample = samples[index];
if (!sample) throw new Error('Requested day was not sampled by the freight baseline');
const previous = samples[index - 1];
const receipt = previous && freightReceipt(previous, sample);
const localCue = process.argv[8] === 'local-cue';
const receiptAt = localCue && previous && (
  (scene === 'mill' && sample.wood > previous.wood && sample.goods === previous.goods) ||
  (scene === 'market' && sample.goods > previous.goods && sample.wood === previous.wood))
  ? scene === 'mill' ? {x: 82, y: 62} : {x: 100, y: 86}
  : undefined;
const movingTruck = sample.trucks.find(truck => truck.speed > 0 && truck.wood > 0)
  ?? sample.trucks.find(truck => truck.speed > 0)
  ?? sample.trucks.find(truck => truck.position.x === 42 && truck.position.y === 63);
if (scene === 'truck' && !movingTruck) throw new Error('The sample has no truck in transit or at the forest pickup');
const options = scene === 'truck' ? {focus: movingTruck!.position, heading: movingTruck!.speed > 0 ? 'Truck in transit' : 'Waiting for wood', cropWidth: 310}
  : scene === 'bridge' ? {focus: {x: 63, y: 62}, heading: 'The river crossing', cropWidth: 650}
  : scene === 'mill' ? {focus: {x: 83, y: 64}, heading: 'Wood arrives at the sawmill', cropWidth: 540}
  : {focus: {x: 100, y: 86}, heading: 'Goods arrive in Eastmere'};
const svg = freightFrame(await readFile(resolve(source)), sample, target, {...options, receipt, receiptAt, skin});
const png = execFileSync('rsvg-convert', [], {input: svg, maxBuffer: 24 * 1024 * 1024});
await writeFile(resolve(output), png, {flag: 'wx'});

if (receipt) {
  const cuePath = join(dirname(resolve(output)), `${receipt.id}.wav`);
  const chime = freightChime();
  await writeFile(cuePath, chime, {flag: 'wx'}).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST' || !(await readFile(cuePath)).equals(chime)) throw error;
  });
}
