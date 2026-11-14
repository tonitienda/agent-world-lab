/** Incremental picture refresh for this already-rendered Motion Canvas master.
 * Reuses original MC titles, fades and audio. Refuses retiming or composition changes.
 */
import {execFileSync} from 'node:child_process';
import {readFile, writeFile, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = join(root, 'production/episode-007');
const load = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const source = await load(join(folder, 'source.json'));
const run = join(root, source.session), cache = join(run, 'first-master');
const plan = await load(join(folder, 'edit-plan.json'));
const originalPlan = await load(join(cache, 'edit-plan.json'));
assert.deepEqual(plan, originalPlan, 'Plan changed: use the full Motion Canvas exporter');
assert.deepEqual(await load(join(folder, 'narration-manifest.json')), await load(join(cache, 'narration-manifest.json')),
  'Spoken script changed: use the full Motion Canvas exporter');
const build = await load(join(folder, 'production-build.json'));
const originalBuild = await load(join(cache, 'production-build.json'));
assert.deepEqual(build.audioHashes, originalBuild.audioHashes, 'Narration audio changed');
assert.equal(build.sourceHash, originalBuild.sourceHash, 'Recorded take changed');
const segments = plan.segments;
assert.equal(segments.length, 4);
assert.equal(segments.filter((s: any) => s.kind === 'shot').length, 1);
const game = segments[1];
assert.equal(game.shot.kind, 'full'); assert.equal(game.shot.start, 0);
assert.equal(game.shot.cameras.length, 1); assert.ok(!game.shot.hold && !game.shot.label);
assert.equal(plan.cameras.length, 1); assert.equal(plan.cameras[0].offsetSeconds ?? 0, 0);
const previous = await load(join(cache, 'render-validation.json'));
assert.equal(previous.decoded, true); assert.equal(previous.blackIntervals.length, 0);
const camera = await load(join(folder, 'camera-plan.json'));
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
assert.equal(hash(await readFile(join(root, 'production/public/episode-007/generated/soundtrack.wav'))),
  await readFile(join(cache, 'soundtrack.sha256'), 'utf8'), 'Mixed soundtrack changed');
const compositions = await load(join(cache, 'composition-hashes.json'));
for (const [file, fingerprint] of Object.entries(compositions))
  assert.equal(hash(await readFile(join(root, file))), fingerprint, `Motion Canvas composition changed: ${file}`);
for (const file of ['00000.png', `${String(camera.shots.length - 1).padStart(5, '0')}.png`])
  assert.equal(hash(await readFile(join(run, 'episode-camera-frames', file))), hash(await readFile(join(cache, file))),
    'Opening/ending source image changed: cached Motion Canvas backgrounds are no longer reusable');
const fps = plan.fps;
const gameStart = Math.round(segments[0].duration * fps);
const first = Math.round(camera.shots[0].duration * fps);
const last = Math.round((game.duration - camera.shots.at(-1).duration) * fps);
assert.ok(first / fps > (game.transition ?? 0), 'The incoming Motion Canvas fade must remain in the cached master');
const frames = Math.round(build.duration * fps);
assert.equal(frames, previous.frames);
const master = join(cache, 'episode-007.mp4');
const directed = join(root, 'production/public/episode-007/video/directed.mp4');
const output = join(root, 'production/output/episode-007.mp4');
const temporary = output.replace('.mp4', '.camera-refresh.rendering.mp4');
const filter = `[0:v]split=2[head][tail];[head]trim=end_frame=${gameStart + first},setpts=PTS-STARTPTS[a];` +
  `[1:v]trim=start_frame=${first}:end_frame=${last},setpts=PTS-STARTPTS[b];` +
  `[tail]trim=start_frame=${gameStart + last}:end_frame=${frames},setpts=PTS-STARTPTS[c];` +
  `[a][b][c]concat=n=3:v=1:a=0,fps=${fps},format=yuv420p[v]`;
console.log(`Refreshing gameplay frames ${gameStart + first}–${gameStart + last}; preserving Motion Canvas cards/fades and the original audio stream.`);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master, '-i', directed,
  '-filter_complex', filter, '-map', '[v]', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19',
  '-c:a', 'copy', '-t', String(build.duration), '-movflags', '+faststart', temporary]);
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', temporary], {encoding: 'utf8'}));
const video = probe.streams.find((s: any) => s.codec_type === 'video');
assert.equal(video.width, 3840); assert.equal(video.height, 2160); assert.equal(video.avg_frame_rate, '60/1');
assert.equal(Number(video.nb_frames), frames); assert.ok(probe.streams.some((s: any) => s.codec_type === 'audio'));
assert.ok(Math.abs(Number(probe.format.duration) - build.duration) < 0.08);
await rename(temporary, output);
await writeFile(join(folder, 'camera-refresh.json'), JSON.stringify({method: 'incremental picture refresh of existing Motion Canvas master',
  originalMaster: master, originalMasterSha256: hash(await readFile(master)), directedSha256: hash(await readFile(directed)),
  preserved: ['all original audio packets', 'opening and ending cards', 'Motion Canvas transitions', 'narration timing', 'take and source chronology'],
  replacedFrames: {first: gameStart + first, endExclusive: gameStart + last}, totalFrames: frames,
  output, duration: build.duration, preview: 'same unchanged Motion Canvas scene and updated directed.mp4'}, null, 2));
console.log(output);
