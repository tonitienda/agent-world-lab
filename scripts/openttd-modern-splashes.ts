import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {copyFile, mkdtemp, readFile, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {project} from '../packages/openttd/src/camera.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const production = join(root, 'production');
const episode = join(production, 'episode-009');
const assets = join(production, 'public', 'episode-009');
const output = join(production, 'output', 'episode-009-modern-skin.mp4');
const source = output.replace('.mp4', '-pre-splash.mp4');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const {session} = await json(join(episode, 'source.json'));
const take = join(root, session);
const {objective: result} = await json(join(take, 'result.json'));
const plan = await json(join(episode, 'edit-plan.json'));
const beats = await json(join(episode, 'camera-plan.json'));
const timing = await json(join(episode, 'narration-timing.json'));
const fps = plan.fps;
const openingFrames = 5 * fps;
const bodyEnd = beats.slice(0, -1).reduce((sum: number, beat: {frames: number}) => sum + beat.frames, 0);
const endHold = 20;
const duration = bodyEnd / fps + endHold;
const oldDuration = plan.segments[0].duration;
assert.equal(beats.at(-1).card, 'end');
assert.ok(timing.at(-1).at >= bodyEnd / fps);
assert.ok(timing.at(-1).at + timing.at(-1).duration < oldDuration);

const accent = '#5FD3C4';
const panel = '#0E131B';
const border = '#1E2633';
const muted = '#8B95A5';
const white = '#E9EDF2';
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const num = (value: number) => value.toLocaleString('en-US');
const rect = (x: number, y: number, w: number, h: number, fill = panel, r = 0, stroke = 'none') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${r}" stroke="${stroke}"/>`;
const copy = (x: number, y: number, value: string, size: number, fill = white, weight = 400) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escape(value)}</text>`;
const label = (x: number, y: number, value: string, fill = muted) =>
  `<g font-family="JetBrains Mono, Menlo, monospace" letter-spacing="2">${copy(x, y, value.toUpperCase(), 15, fill, 600)}</g>`;
const fact = (x: number, y: number, w: number, name: string, value: string) =>
  rect(x, y, w, 112, panel, 12, border) + label(x + 22, y + 32, name, accent) +
  copy(x + 22, y + 75, value, 30, white, 700);

const shell = (body: string, footer: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"
  viewBox="0 0 1920 1080" font-family="Space Grotesk, Arial, sans-serif">
  ${rect(0, 0, 1920, 1080, '#090C12')}
  <path d="M119 98V87a10 10 0 0 1 20 0v11m-24 3h28" fill="none" stroke="${accent}" stroke-width="2"/>
  ${label(163, 97, 'The Agent Terrarium', white)}
  <g text-anchor="end">${label(1808, 97, 'Tycoon', accent)}</g>
  ${body}
  ${rect(112, 962, 1696, 1, border)}
  ${footer}
</svg>`;

const footerFact = (x: number, name: string, value: string) => label(x, 1000, name) + copy(x, 1030, value, 20);

const ffmpeg = (args: string[]) => execFileSync('ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-y', ...args], {stdio: 'inherit'});
const streams = (path: string) => JSON.parse(execFileSync('ffprobe',
  ['-v', 'error', '-show_streams', '-of', 'json', path], {encoding: 'utf8'})).streams;
const work = await mkdtemp(join(production, 'output', '.splash-'));
try {
  // Keep an unchanged input so repeated runs always start from the same cut.
  try {
    await copyFile(output, source, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const originalVideo = streams(source).find((stream: {codec_type: string}) => stream.codec_type === 'video');
  assert.equal(Number(originalVideo.nb_frames), Math.round(oldDuration * fps));

  const skin = await readFile(join(root, 'packages/openttd/graphics/terrarium_skin.grf'));
  const skinHash = createHash('sha256').update(skin).digest('hex').slice(0, 12);
  const native = join(take, `native-skin-${skinHash}`, 'frame-0000.png');
  const center = project(beats[0].focus, 128, 1);
  const windowWidth = 740;
  const windowHeight = 680;
  const cropWidth = beats[0].width;
  const cropHeight = Math.round(cropWidth * windowHeight / windowWidth);
  const crop = join(work, 'observation.png');
  ffmpeg(['-i', native, '-vf',
    `crop=${cropWidth}:${cropHeight}:${Math.round(center.x - cropWidth / 2)}:${Math.round(center.y - cropHeight / 2)},scale=1480:1360`,
    '-frames:v', '1', crop]);
  const observation = (await readFile(crop)).toString('base64');
  const startCash = (await json(join(take, 'checkpoints.json')))[0].state.balance;
  const {targets} = result;
  const opening = shell(`
    ${label(112, 234, 'Specimen · OpenTTD solo run', accent)}
    ${copy(112, 353, 'Forest to Market', 104, white, 700)}
    ${copy(112, 436, 'Cross the river and turn timber into a profitable freight route.', 29, '#C4CAD5')}
    ${fact(112, 555, 420, 'Wood to sawmill', `${num(targets.woodDeliveredToSawmill)} tonnes`)}
    ${fact(551, 555, 420, 'Goods to Eastmere', `${num(targets.goodsFromSawmillDeliveredToTown)} crates`)}
    ${fact(112, 681, 420, 'Starting cash', num(startCash))}
    ${fact(551, 681, 420, 'Cash reserve', `≥ ${num(targets.minimumEndingCash)}`)}
    ${rect(1068, 179, windowWidth, windowHeight, panel, 38, border)}
    <defs><clipPath id="window">${rect(1069, 180, 738, 678, panel, 37)}</clipPath></defs>
    <image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/png;base64,${observation}"
      x="1068" y="179" width="${windowWidth}" height="${windowHeight}" opacity=".30" clip-path="url(#window)"/>
    ${label(1100, 226, 'Observation window', white)}
    <g text-anchor="end">${label(1776, 226, `Day 0 / ${targets.maximumDays}`, accent)}</g>
  `, footerFact(112, 'Agent', 'Claude Opus 5.5') + footerFact(537, 'World', 'OpenTTD') +
    footerFact(962, 'Deadline', `${targets.maximumDays} game days`) + footerFact(1387, 'Constraints', 'Fleet profit · No new loans'));

  const ending = shell(`
    ${label(112, 234, `Result · Day ${result.days} / ${targets.maximumDays}`, accent)}
    ${copy(112, 346, result.achieved ? 'Objective achieved.' : 'Final results', 87, white, 700)}
    ${fact(112, 507, 260, 'Wood delivered', `${num(result.wood)} / ${num(targets.woodDeliveredToSawmill)} t`)}
    ${fact(390, 507, 260, 'Goods delivered', `${num(result.goods)} / ${num(targets.goodsFromSawmillDeliveredToTown)} crates`)}
    ${fact(668, 507, 260, 'Cash remaining', num(result.cash))}
    ${rect(112, 658, 816, 1, border)}
    ${copy(112, 746, 'What should Claude try next?', 41, white, 700)}
    ${copy(112, 809, 'Leave your challenges in the comments.', 27, '#C4CAD5')}
    ${rect(1048, 194, 760, 428, panel, 18)}
    ${rect(1048, 652, 400, 225, panel, 18)}
    <circle cx="1638" cy="763" r="99" fill="${panel}"/>
  `, footerFact(112, 'The Agent Terrarium', 'Thanks for watching') +
    footerFact(537, 'Fleet operating profit', num(result.operatingProfit)));

  for (const [name, svg] of [['opening', opening], ['ending', ending]]) {
    execFileSync('rsvg-convert', ['-w', '3840', '-h', '2160', '-o', join(work, `${name}.png`)], {input: svg});
  }

  // Restore the tail of the existing music fade, then continue the same track
  // from that point under the end screen. All speech and gameplay cues stay in place.
  const music = plan.music;
  const fadeStart = oldDuration - music.fadeOut;
  const startSample = Math.round(fadeStart * 48000);
  const audio = join(work, 'audio.m4a');
  ffmpeg(['-i', join(assets, 'generated', 'soundtrack.wav'), '-i', join(assets, 'music', music.file),
    '-filter_complex', `[1:a]aresample=48000,atrim=start_sample=${startSample},asetpts=PTS-STARTPTS,` +
    `volume=${music.volume},afade=t=in:d=${music.fadeOut},adelay=${startSample}S:all=1,` +
    `afade=t=out:st=${duration - music.fadeOut}:d=${music.fadeOut}[tail];` +
    `[0:a][tail]amix=inputs=2:normalize=0:dropout_transition=0,atrim=duration=${duration}[mix]`,
    '-map', '[mix]', '-c:a', 'aac', '-b:a', '320k', audio]);

  const rendered = join(work, 'master.mp4');
  ffmpeg(['-loop', '1', '-framerate', String(fps), '-i', join(work, 'opening.png'), '-i', source,
    '-loop', '1', '-framerate', String(fps), '-i', join(work, 'ending.png'), '-i', audio,
    '-filter_complex_threads', '2', '-filter_complex',
    `[0:v]trim=end_frame=${openingFrames},format=yuv420p[intro];` +
    `[1:v]trim=start_frame=${openingFrames}:end_frame=${bodyEnd},setpts=PTS-STARTPTS[body];` +
    `[2:v]trim=end_frame=${endHold * fps},format=yuv420p[outro];` +
    '[intro][body][outro]concat=n=3:v=1:a=0[video]',
    '-map', '[video]', '-map', '3:a', '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '17', '-c:a', 'copy', '-movflags', '+faststart', rendered]);
  const [video, sound] = streams(rendered);
  assert.equal(Number(video.nb_frames), Math.round(duration * fps));
  assert.equal(video.width, originalVideo.width);
  assert.equal(video.height, originalVideo.height);
  assert.equal(video.avg_frame_rate, originalVideo.avg_frame_rate);
  assert.equal(Number(sound.duration), duration);
  ffmpeg(['-xerror', '-i', rendered, '-f', 'null', '-']);
  await rename(rendered, output);
  for (const name of ['opening', 'ending']) {
    await copyFile(join(work, `${name}.png`), join(episode, 'review', `modern-skin-${name}.png`));
  }
  console.log(`${output}\nEnd screen: ${bodyEnd / fps}–${duration}s`);
} finally {
  await rm(work, {recursive: true, force: true});
}
