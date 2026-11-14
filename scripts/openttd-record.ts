import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {direct, renderCamera, type Recording, type CameraPlan} from '../packages/openttd/src/camera.js';

async function main() {
  const argument = process.argv[2];
  if (!argument) throw new Error('Usage: npm run openttd:record -- /path/to/recorded-spike');
  const run = resolve(argument);
  const recording: Recording = JSON.parse(await readFile(join(run, 'captures.json'), 'utf8'));
  if (recording.version !== 1 || !recording.captures.length) throw new Error('Unsupported/empty recording');
  // First recordings sampled the southeast void tile, for which GS returns -1.
  // The generated fixture is flat; later recordings sample the adjacent interior tile.
  if (recording.northHeight !== recording.southHeight && recording.southHeight !== -1)
    throw new Error('Camera projection supports the flat spike fixture only');
  const planPath = join(run, 'camera-plan.json');
  // Keep manual camera/duration edits when re-rendering.
  const plan: CameraPlan = existsSync(planPath) ? JSON.parse(await readFile(planPath, 'utf8')) : direct(recording);
  if (plan.version !== 1 || plan.width !== 1920 || plan.height !== 1080 || plan.fps !== 30 || !plan.shots.length)
    throw new Error('Expected a 1920x1080, 30fps camera plan, version 1');
  let previousCapture = -1;
  for (const shot of plan.shots) {
    if (!Number.isInteger(shot.capture) || !recording.captures[shot.capture] || !Number.isFinite(shot.duration) || shot.duration <= 0)
      throw new Error('Invalid camera shot');
    if (shot.capture < previousCapture) throw new Error('Camera plan must preserve capture chronology');
    previousCapture = shot.capture;
  }
  await writeFile(planPath, JSON.stringify(plan, null, 2));
  const frames = join(run, 'camera-frames');
  await mkdir(frames, {recursive: true});
  const concat = [];
  for (const [i, shot] of plan.shots.entries()) {
    const capture = recording.captures[shot.capture]!;
    const source = await readFile(join(run, capture.image));
    const svg = renderCamera(capture, shot, recording, source, plan.width, plan.height);
    const file = `${String(i).padStart(5, '0')}.png`;
    execFileSync('rsvg-convert', ['-o', join(frames, file)], {input: svg});
    concat.push(`file 'camera-frames/${file}'`, `duration ${shot.duration}`);
    if (i % 20 === 0) console.log(`Camera frame ${i + 1}/${plan.shots.length}: ${shot.camera}`);
  }
  const last = `${String(plan.shots.length - 1).padStart(5, '0')}.png`;
  concat.push(`file 'camera-frames/${last}'`);
  const list = join(run, 'camera-frames.ffconcat');
  await writeFile(list, concat.join('\n') + '\n');
  const output = join(run, 'camera-preview.mp4');
  const duration = plan.shots.reduce((sum, shot) => sum + shot.duration, 0);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '1', '-i', list,
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-t', String(duration),
    '-movflags', '+faststart', '-metadata', 'comment=OpenTTD spike; daily sampled time-lapse; scripted driver; no audio', output],
    {stdio: ['ignore', 'ignore', 'pipe']});
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output], {encoding: 'utf8'}));
  const video = probe.streams.find((s: any) => s.codec_type === 'video');
  if (video?.width !== plan.width || video?.height !== plan.height || Math.abs(Number(probe.format.duration) - duration) > 0.1)
    throw new Error('Encoded video failed dimensions/duration validation');
  const report = {output, duration: Number(probe.format.duration), sourceSamples: recording.captures.length,
    cameraCounts: Object.fromEntries(['wide', 'construction', 'queue', 'follow', 'delivery', 'boarding']
      .map(camera => [camera, plan.shots.filter(shot => shot.camera === camera).length])),
    capture: 'daily sampled game screenshots, captured while paused; editorial crops; no continuous source video or audio',
    plan: planPath};
  await writeFile(join(run, 'camera-render.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
