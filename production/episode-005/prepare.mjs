// Resume the edit from the saved game. Never starts or replays the experiment.
// node production/episode-005/prepare.mjs [--with-audio]
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const episode = 'episode-005';
const production = `production/${episode}`;
const session = 'data/chess-sessions/episode-005-opus55-sf2000-take-1';
const generateAudio = process.argv.includes('--generate-audio');
const withAudio = generateAudio || process.argv.includes('--with-audio');
const render = process.argv.includes('--render');
if (render && !withAudio) throw Error('--render requires --with-audio.');
const replay = JSON.parse(readFileSync(resolve(root, session, 'replay.json'), 'utf8'));
if (!replay.result || !replay.moves.length) throw Error('The saved game must be complete before preparing the episode.');
if (generateAudio) {
  // Refresh editorial card copy before hashing/generating the final spoken text.
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/chess-narration.ts', session, production], {cwd: root, stdio: 'inherit'});
  execFileSync(process.execPath, ['scripts/elevenlabs-narration.mjs', episode], {cwd: root, stdio: 'inherit'});
}
if (withAudio) {
  const manifest = JSON.parse(readFileSync(resolve(root, production, 'narration-manifest.json'), 'utf8'));
  const missing = manifest.filter(l => !existsSync(resolve(root, `production/public/${episode}/audio`, l.audio)));
  if (missing.length) throw Error('Missing narration WAVs: ' + missing.map(l => l.audio).join(', '));
}
const env = {...process.env, CHESS_TITLE: 'Episode 005 · Chess', CHESS_NEXT: 'What should Claude face next?',
  CHESS_ANALYSIS_DEPTH: '18', ...(withAudio ? {CHESS_VOICE: production} : {})};
if (!withAudio) delete env.CHESS_VOICE;
const run = (args) => execFileSync(process.execPath, args, {cwd: root, env, stdio: 'inherit'});
run(['--import', 'tsx', 'packages/chess/examples/record.ts', session, `${session}/replay.json`]);
run(['--import', 'tsx', 'scripts/chess-narration.ts', session, production]);
if (withAudio) {
  execFileSync(process.execPath, ['production/tools/episode.mjs'], {cwd: root, env: {...env, EPISODE_ID: episode}, stdio: 'inherit'});
  if (render) {
    // This chess edit is exactly one full-frame, uninterrupted board shot. Its cards,
    // motion and overlays are already rendered; mux the validated mixed soundtrack.
    const plan = JSON.parse(readFileSync(resolve(root, production, 'edit-plan.json'), 'utf8'));
    const [segment] = plan.segments;
    if (plan.segments.length !== 1 || segment.shot?.kind !== 'full' || segment.shot.start !== 0 || segment.transition || segment.shot.label)
      throw Error('Direct export requires the original single full-board shot; use Motion Canvas for a different edit.');
    mkdirSync(resolve(root, 'production/output'), {recursive: true});
    const output = resolve(root, `production/output/${episode}.mp4`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', resolve(root, `production/public/${episode}/video/board.mp4`),
      '-i', resolve(root, `production/public/${episode}/generated/soundtrack.wav`),
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-t', String(segment.duration), '-movflags', '+faststart', output], {stdio: 'inherit'});
    execFileSync(process.execPath, ['production/tools/check-render.mjs'], {cwd: root, env: {...env, EPISODE_ID: episode}, stdio: 'inherit'});
    run(['--import', 'tsx', 'scripts/chess-youtube.ts', episode]);
    if (process.argv.includes('--rehearsal')) {
      copyFileSync(output, resolve(root, `production/output/${episode}-rehearsal.mp4`));
      for (const file of ['narration-manifest.json', 'edit-plan.json', 'validation.json', 'render-validation.json'])
        copyFileSync(resolve(root, production, file), resolve(root, production, `rehearsal-${file}`));
    }
    console.log(output);
  }
} else {
  console.log(`Audio-ready script: ${production}/recording-sheet.md. Timings are provisional until WAVs arrive.`);
}
