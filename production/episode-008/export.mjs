// Export the exact Motion Canvas edit while retaining the encoded board frames.
// Refuse any edit that needs transitions, overlays, retiming or compositing.
import {execFileSync} from 'node:child_process';
import {renameSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepare} from '../tools/pipeline.mjs';

const production = fileURLToPath(new URL('../', import.meta.url));
const episode = 'episode-008';
const {plan, duration, soundtrack} = prepare(production, episode);
const [camera] = plan.cameras;
if (plan.cameras.length !== 1 || camera.offsetSeconds !== 0) throw Error('Export requires one unshifted source.');
let frames = 0;
for (const segment of plan.segments) {
  const shot = segment.shot;
  const end = frames + Math.round(segment.duration * plan.fps);
  if (segment.kind !== 'shot' || segment.transition !== 0 || shot?.kind !== 'full' ||
      shot.cameras[0] !== camera.id || shot.hold || shot.label || segment.background || segment.titleCard ||
      Math.abs(shot.start * plan.fps - frames) > 1e-6 || Math.abs(segment.duration * plan.fps - (end - frames)) > 1e-6) {
    throw Error('This edit needs a frame-by-frame Motion Canvas export.');
  }
  frames = end;
}
const input = join(production, 'public', episode, 'video', camera.file);
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames', '-of', 'json', input], {encoding: 'utf8'})).streams[0];
if (probe?.width !== plan.resolution.width || probe.height !== plan.resolution.height ||
    probe.avg_frame_rate !== `${plan.fps}/1` || Number(probe.nb_frames) !== frames) {
  throw Error('Encoded source dimensions or clock differ from the edit.');
}
const output = join(production, 'output', episode + '.mp4');
const partial = output.replace(/\.mp4$/, '.muxing.mp4');
try {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', input, '-i', soundtrack, '-map', '0:v:0', '-map', '1:a:0',
    '-t', String(duration), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', partial], {stdio: 'inherit'});
  renameSync(partial, output);
} finally {
  rmSync(partial, {force: true});
}
console.log(output);
