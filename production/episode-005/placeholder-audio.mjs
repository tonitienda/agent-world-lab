// Temporary local TTS for rehearsal only; never overwrites supplied WAVs.
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const folder = fileURLToPath(new URL('.', import.meta.url));
const audio = fileURLToPath(new URL('../public/episode-005/audio/', import.meta.url));
const archive = join(folder, 'placeholder-audio');
const manifest = JSON.parse(readFileSync(join(folder, 'narration-manifest.json'), 'utf8'));
if (manifest.some(l => existsSync(join(audio, l.audio)))) throw Error('Active WAV files already exist. Preserve supplied audio; this generator never overwrites it.');
mkdirSync(audio, {recursive: true});
mkdirSync(archive, {recursive: true});
const temp = mkdtempSync(join(tmpdir(), 'chess005-tts-'));
const clips = [];
try {
  for (const line of manifest) {
    const voice = line.voice === 'agent' ? 'Samantha' : 'Daniel';
    const aiff = join(temp, `${line.line}.aiff`);
    const wav = join(archive, line.audio);
    execFileSync('say', ['-v', voice, '-r', '165', '-o', aiff, line.text]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', aiff, '-af', 'loudnorm=I=-18:TP=-2:LRA=7', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], {encoding: 'utf8'}));
    if (!Number.isFinite(duration) || duration <= 0) throw Error(`Empty placeholder ${line.audio}`);
    copyFileSync(wav, join(audio, line.audio));
    clips.push({line: line.line, audio: line.audio, speaker: line.voice, text: line.text, engine: 'macOS say', voice, wordsPerMinute: 165, duration,
      sha256: createHash('sha256').update(readFileSync(wav)).digest('hex')});
    console.log(`${line.audio}: ${voice}, ${duration.toFixed(2)}s`);
  }
  writeFileSync(join(folder, 'placeholder-audio.json'), JSON.stringify({purpose: 'Temporary rehearsal narration; replace with ElevenLabs WAVs using the same filenames.', clips}, null, 2) + '\n');
} finally {
  rmSync(temp, {recursive: true, force: true});
}
