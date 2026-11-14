import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {project, type Position} from '../packages/openttd/src/camera.js';
import type {FreightCheckpoint} from '../packages/openttd/src/freight-session.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const production = join(root, 'production');
const episode = join(production, 'episode-009');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const source = await json(join(episode, 'source.json'));
const take = join(root, source.session);
const checkpoints: FreightCheckpoint[] = await json(join(take, 'checkpoints.json'));
const result = (await json(join(take, 'result.json'))).objective;
const target = result.targets;
const plan = await json(join(episode, 'edit-plan.json'));
const fps = plan.fps;
type Beat = {checkpoint: number; heading: string; focus: Position; width: number; frames: number;
  card?: 'outro' | 'end'; detail?: string; receiptAt?: Position; receipt?: {amount: number; days: number};
  expense?: {amount: number; label: string}};
const beats: Beat[] = await json(join(episode, 'camera-plan.json'));
const frameCount = beats.reduce((sum, beat) => sum + beat.frames, 0);
const original = join(production, 'output/episode-009.mp4');
const probe = (p: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', p], {encoding: 'utf8'})).streams;
const originalVideo = probe(original).find((s: any) => s.codec_type === 'video');
assert.equal(Number(originalVideo.nb_frames), frameCount, 'The comparison requires the exact original timeline');
const [option, asset] = process.argv.slice(2);
if (option && (option !== '--skin' || !asset)) throw Error('Usage: openttd-hud-comparison.ts [--skin FILE.grf]');
const skin = asset ? resolve(asset) : undefined;
const hash = skin && createHash('sha256').update(await readFile(skin)).digest('hex');
const frames = join(take, skin ? `modern-skin-${hash!.slice(0, 12)}-frames` : 'hud-comparison-frames');
const native = join(take, skin ? `native-skin-${hash!.slice(0, 12)}` : 'native-png');
await mkdir(frames, {recursive: true});
const num = (n: number) => n.toLocaleString('en-US');
const escape = (s: string) => s.replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[ch]!));
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const firstDay = (predicate: (c: FreightCheckpoint) => boolean) => checkpoints.find(predicate)?.state.day;
const milestones = [
  {label: 'Pickup', day: firstDay(c => c.state.trucks.some(t => t.wood > 0))},
  {label: 'First wood', day: firstDay(c => c.state.wood > 0)},
  {label: 'First goods', day: firstDay(c => c.state.goods > 0)},
];
const accent = '#d8ef8c', sub = '#cad7b9', timber = '#e5bb76', cargo = '#9ad5ff';
const panel = (x: number, y: number, w: number, h: number, r = 14) =>
  `<rect x="${x}" y="${y + 4}" width="${w}" height="${h}" rx="${r}" fill="#0a1208" fill-opacity=".22"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#panel)" stroke="#cbdca9" stroke-opacity=".22"/>`;
const label = (x: number, y: number, text: string, color = sub, size = 15) =>
  `<text x="${x}" y="${y}" font-size="${size}" letter-spacing="2" font-weight="600" fill="${color}">${escape(text)}</text>`;
const meter = (x: number, name: string, value: number, max: number, units: string, color: string) =>
  `<text x="${x}" y="959" font-size="17" fill="${sub}">${name}</text>
  <text x="${x + 275}" y="961" text-anchor="end" font-size="22" font-weight="700" fill="${color}">${num(value)}
  <tspan font-size="15" fill="#f6f8ec">/ ${num(max)} ${units}</tspan></text>
  <rect x="${x}" y="983" width="275" height="7" rx="3.5" fill="#e4f2cb" opacity=".15"/>
  <rect x="${x}" y="983" width="${275 * clamp(value / max, 0, 1)}" height="7" rx="3.5" fill="${color}"/>`;
const node = (x: number, name: string, tint: string, path: string) =>
  `<rect x="${x}" y="951" width="43" height="43" rx="9" fill="${tint}" fill-opacity=".15"/>
  <path transform="translate(${x + 10} 961)" d="${path}" fill="none" stroke="${tint}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="${x + 52}" y="978" font-size="20" font-weight="700">${name}</text>`;

function render(png: Buffer, b: Beat) {
  const frame = checkpoints[b.checkpoint]!;
  const s = frame.state;
  const imageWidth = png.readUInt32BE(16), imageHeight = png.readUInt32BE(20);
  const scale = 1920 / b.width;
  const centre = project(b.focus, 128, 1);
  const x = clamp(centre.x - b.width / 2, 0, imageWidth - b.width);
  const y = clamp(centre.y - 1080 / scale * .54, 0, imageHeight - 1080 / scale);
  const header = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1920" height="1080"
  font-family="Helvetica Neue, Arial, sans-serif" fill="#f6f8ec"><defs>
  <linearGradient id="panel" x2="0" y2="1"><stop stop-color="#15200e" stop-opacity=".96"/><stop offset="1" stop-color="#172412" stop-opacity=".91"/></linearGradient>
  </defs><image image-rendering="${skin ? 'optimizeQuality' : 'optimizeSpeed'}" x="${-x * scale}" y="${-y * scale}" width="${imageWidth * scale}"
  height="${imageHeight * scale}" xlink:href="data:image/png;base64,${png.toString('base64')}"/>`;
  if (b.card) {
    const closing = b.card === 'end';
    return header + `${panel(42, 685, 1080, 315, 24)}
      ${label(86, 745, 'AGENT TERRARIUM · OPENTTD', accent, 21)}
      <text x="86" y="841" font-size="71" font-weight="700">${closing ? 'Thanks for watching' : result.achieved ? 'Challenge complete' : 'The measured result'}</text>
      <text x="86" y="909" font-size="31" fill="${sub}">${closing ? 'Forest to Market' : `${num(s.wood)} tonnes of wood · ${num(s.goods)} crates of goods`}</text>
      ${closing ? '' : `<text x="86" y="953" font-size="29" fill="${sub}">${s.day} days · ${num(s.balance)} cash · ${num(result.operatingProfit)} fleet profit</text>`}
    </svg>`;
  }
  const recent = [...new Map(checkpoints.slice(0, b.checkpoint + 1).map(c => [c.state.day, c.state.balance])).entries()].slice(-36);
  const start = recent[0]![0];
  const min = Math.min(target.minimumEndingCash, ...recent.map(([, value]) => value)) - 450;
  const max = Math.max(target.minimumEndingCash, ...recent.map(([, value]) => value)) + 450;
  const chartX = (day: number) => 1543 + (day - start) * 300 / Math.max(1, s.day - start);
  const chartY = (balance: number) => 1010 - (balance - min) * 72 / (max - min);
  const reserve = chartY(target.minimumEndingCash);
  const cashColor = s.balance < target.minimumEndingCash ? '#ffbd83' : accent;
  const cashDiff = s.balance - target.minimumEndingCash;
  const mark = (day: number) => 1456 + day * 391 / target.maximumDays;
  const cue = b.receipt ?? b.expense;
  const cueColor = b.receipt ? accent : '#ffbd83';
  const p = b.receiptAt && project(b.receiptAt, 128, 1);
  const anchor = p && {x: clamp((p.x - x) * scale, 48, 1872), y: clamp((p.y - y) * scale, 135, 860)};
  const cueX = anchor ? clamp(anchor.x + 64, 46, 1552) : 1510;
  const cueY = anchor ? clamp(anchor.y - 145, 190, 638) : 194;
  return header + `
  ${panel(42, 34, 650, 98)}
  <rect x="61" y="58" width="46" height="46" rx="10" stroke="${accent}" fill="none"/>
  <path d="M84 65l-8 11h4l-8 10h10v10h4V86h10l-8-10h4z" fill="${accent}"/>
  ${label(125, 67, 'AGENT TERRARIUM · OPENTTD', accent)}
  <text x="125" y="107" font-size="37" font-weight="750">Forest to Market</text>
  <rect x="443" y="66" width="228" height="36" rx="18" fill="#acc468" fill-opacity=".17"/>
  <circle cx="463" cy="84" r="4" fill="${accent}"/>
  <text x="474" y="90" font-size="15" fill="#e8efcf">Claude · sampled gameplay</text>
  ${panel(1425, 34, 453, 145)}
  ${label(1456, 83, 'GAME DAY')}
  <text x="1847" y="84" text-anchor="end" font-size="38" font-weight="700">${s.day}<tspan font-size="19" fill="${sub}"> / ${target.maximumDays}</tspan></text>
  <path d="M1456 115H1847" stroke="#e7f1cc" stroke-opacity=".20" stroke-width="3"/>
  <path d="M1456 115H${mark(s.day)}" stroke="${accent}" stroke-width="3"/>
  <circle cx="${mark(s.day)}" cy="115" r="5" fill="${accent}"/>
  <text x="1456" y="153" font-size="14" fill="${sub}">Day 0</text>
  <text x="1847" y="153" text-anchor="end" font-size="14" fill="${sub}">${target.maximumDays}</text>
  ${milestones.map((m, index) => m.day === undefined || m.day > s.day ? '' :
    `<circle cx="${mark(m.day!)}" cy="115" r="4" fill="#f0f5d6"/>
    <text x="${1538 + index * 112}" y="153" text-anchor="middle" font-size="13" fill="${sub}">${m.label} · ${m.day}</text>`).join('')}
  ${cue ? `<g>${anchor ? `<path d="M${cueX + 34} ${cueY + 116} L${anchor.x} ${anchor.y}" stroke="${cueColor}" stroke-width="2.5" fill="none"/><circle cx="${anchor.x}" cy="${anchor.y}" r="4" fill="${cueColor}"/>` : ''}
    ${panel(cueX, cueY, 322, 118)}
    ${label(cueX + 22, cueY + 29, b.receipt ? 'DELIVERY INCOME' : b.expense!.label, cueColor)}
    <text x="${cueX + 22}" y="${cueY + 76}" font-size="45" font-weight="750" fill="${cueColor}">${b.receipt ? '+' : '−'}${num(cue.amount)}</text>
    <text x="${cueX + 22}" y="${cueY + 101}" font-size="16" fill="${sub}">${b.receipt ? `Last ${b.receipt.days === 1 ? 'game day' : b.receipt.days + ' game days'}` : 'Paid from company cash'}</text></g>` : ''}
  <rect x="42" y="746" width="91" height="30" rx="7" fill="${accent}"/>
  <text x="87" y="767" text-anchor="middle" font-size="15" font-weight="750" fill="#1b2710">DAY ${s.day}</text>
  ${panel(42, 785, Math.min(1150, Math.max(315, 52 + b.heading.length * 18)), 67)}
  <text x="64" y="829" font-size="34" font-weight="750">${escape(b.heading)}</text>
  ${panel(42, 877, 1180, 164)}
  ${label(64, 910, 'SUPPLY CHAIN')}
  <text x="1198" y="910" text-anchor="end" font-size="16" fill="${sub}">${escape(b.detail ?? 'Forest → Sawmill → Eastmere')}</text>
  ${node(66, 'Forest', accent, 'M12 0L4 11h5l-6 8h7v5h4v-5h7l-6-8h5z')}
  ${meter(217, 'Wood to sawmill', s.wood, target.woodDeliveredToSawmill, 't', timber)}
  ${node(537, 'Sawmill', timber, 'M1 23V12l7-5v5l7-5v5l8-4v15z M6 18h2m4 0h2m4 0h2')}
  ${meter(700, 'Goods to Eastmere', s.goods, target.goodsFromSawmillDeliveredToTown, 'crates', cargo)}
  ${node(1030, 'Eastmere', cargo, 'M0 23h24M2 23V12h6v11m2 0V2h6v21m2 0V9h5v14')}
  ${panel(1262, 877, 616, 164)}
  ${label(1285, 910, 'COMPANY CASH')}
  <text x="1285" y="981" font-size="52" font-weight="750" fill="${cashColor}">${num(s.balance)}</text>
  <circle cx="1290" cy="1015" r="4" fill="${cashColor}"/>
  <text x="1302" y="1020" font-size="16" fill="${cashColor}">${cashDiff === 0 ? 'At reserve' : `${cashDiff > 0 ? 'Above' : 'Below'} reserve by ${num(Math.abs(cashDiff))}`}</text>
  <text x="1543" y="910" font-size="15" fill="${sub}">Sampled days ${start}–${s.day}</text>
  <text x="1843" y="910" text-anchor="end" font-size="15" fill="${sub}">Reserve ${num(target.minimumEndingCash)}</text>
  <path d="M1543 ${reserve}H1843" stroke="${sub}" stroke-opacity=".55" stroke-dasharray="5 5"/>
  <polyline points="${recent.map(([day, value]) => `${chartX(day)},${chartY(value)}`).join(' ')}" fill="none" stroke="#f2f5dc" stroke-width="2.5"/>
  <circle cx="${chartX(s.day)}" cy="${chartY(s.balance)}" r="4.5" fill="${cashColor}"/>
  </svg>`;
}

const ffconcat: string[] = [];
for (const [index, beat] of beats.entries()) {
  const filename = `${String(index).padStart(4, '0')}.png`;
  const save = checkpoints[beat.checkpoint]!.save;
  const capture = join(native, save.replace(/\.sav$/, '.png'));
  if (skin && !existsSync(capture)) {
    execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/openttd-native-screenshot.ts'),
      join(take, save), capture, 'classic', skin], {stdio: 'inherit'});
  }
  const png = await readFile(capture);
  assert.equal(png.readUInt32BE(16), 8065, 'Unexpected native screenshot projection');
  assert.equal(png.readUInt32BE(20), 4183, 'Unexpected native screenshot projection');
  execFileSync('rsvg-convert', ['--unlimited', '-w', '3840', '-h', '2160', '-o', join(frames, filename)], {input: render(png, beat)});
  ffconcat.push(`file '${filename}'`, `option framerate ${fps}`, `duration ${(beat.frames / fps).toFixed(9)}`);
  if (index % 24 === 0) console.log(`Composed comparison frame ${index + 1}/${beats.length}`);
}
ffconcat.push(ffconcat.at(-3)!, `option framerate ${fps}`);
const list = join(frames, 'edit.ffconcat');
await writeFile(list, ffconcat.join('\n') + '\n');
const output = join(production, 'output', skin ? 'episode-009-modern-skin.mp4' : 'episode-009-design-comparison.mp4');
const partial = output.replace('.mp4', '.rendering.mp4');
const picture = join(frames, 'picture.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
  '-vf', `fps=${fps},format=yuv420p`, '-frames:v', String(frameCount),
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-an', picture], {stdio: 'inherit'});
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', picture, '-i', original,
  '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', partial], {stdio: 'inherit'});
const video = probe(partial).find((s: any) => s.codec_type === 'video');
assert.equal(Number(video.nb_frames), frameCount);
assert.equal(video.width, originalVideo.width);
assert.equal(video.height, originalVideo.height);
assert.equal(video.avg_frame_rate, originalVideo.avg_frame_rate);
const audioHash = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-'], {encoding: 'utf8'}).trim();
assert.equal(audioHash(partial), audioHash(original), 'Comparison audio must match the original bit for bit');
await rename(partial, output);
console.log(output);
