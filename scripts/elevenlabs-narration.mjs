import {ElevenLabsClient} from '@elevenlabs/elevenlabs-js';
import {createHash} from 'node:crypto';
import {createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const digest = data => createHash('sha256').update(data).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => {
  writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
  renameSync(file + '.tmp', file);
};
function duration(file) {
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'}));
  if (!Number.isFinite(seconds) || seconds <= 0) throw Error('Generated audio is empty or invalid.');
  return seconds;
}

export function audioRequests(manifest, config) {
  if (!Array.isArray(manifest) || !manifest.length || !config.modelId || !/^mp3_\d+_\d+$/.test(config.outputFormat))
    throw Error('A narration manifest, model and MP3 output format are required.');
  return manifest.map((line, i) => {
    // A named character (`speaker`, e.g. "ada") wins over its role (`voice`), so
    // two agents in one episode can sound different.
    const speaker = config.speakers[line.speaker] ?? config.speakers[line.voice];
    if (line.line !== i + 1 || line.audio !== `${i + 1}_Chapter_1.wav` || !line.text?.trim() || !speaker?.voiceId)
      throw Error(`Invalid narration line or speaker at row ${i + 1}.`);
    const request = {voiceId: speaker.voiceId, text: line.text, modelId: config.modelId, outputFormat: config.outputFormat};
    return {...line, speakerName: speaker.name, request, fingerprint: digest(JSON.stringify(request))};
  });
}

export async function generateEpisodeAudio({root, episode, dryRun = false, client, log = console.log}) {
  if (!/^episode-[a-zA-Z0-9-]+$/.test(episode)) throw Error('Invalid episode ID.');
  const folder = join(root, 'production', episode);
  const manifestFile = join(folder, 'narration-manifest.json');
  const originalManifest = readFileSync(manifestFile);
  const config = json(join(root, 'production/voices.json'));
  const requests = audioRequests(JSON.parse(originalManifest), config);
  const cache = join(folder, 'elevenlabs-cache');
  const active = join(root, 'production/public', episode, 'audio');
  const fresh = requests.filter(l => !existsSync(join(cache, l.fingerprint + '.mp3')));
  log(`${episode}: ${requests.length} clips; ${fresh.length} API requests, ${fresh.reduce((n, l) => n + l.text.length, 0)} text characters; model ${config.modelId}.`);
  for (const [voice, setting] of Object.entries(config.speakers)) log(`${voice}: ${setting.name} (${setting.voiceId})`);
  if (dryRun) return {clips: requests.length, pending: fresh.length};
  if (!client && !process.env.ELEVENLABS_API_KEY?.trim()) throw Error('Set ELEVENLABS_API_KEY in .env.local or .env before generating narration.');
  client ??= new ElevenLabsClient();
  const lock = join(folder, '.elevenlabs-lock');
  try { mkdirSync(lock); } catch { throw Error('Another narration run is active (or left .elevenlabs-lock after interruption).'); }
  try {
    mkdirSync(cache, {recursive: true});
    const clips = [];
    // Stage every clip before replacing any active audio. Completed API output is
    // cached immediately, so a later conversion or clip failure can resume locally.
    for (const line of requests) {
      const stem = join(cache, line.fingerprint);
      const mp3 = stem + '.mp3', wav = stem + '.wav';
      if (!existsSync(mp3)) {
        log(`Generating ${line.audio}: ${line.speakerName}`);
        try {
          const {voiceId, ...body} = line.request;
          const audio = await client.textToSpeech.convert(voiceId, body, {maxRetries: 0, timeoutInSeconds: 180});
          await pipeline(Readable.fromWeb(audio), createWriteStream(mp3 + '.tmp'));
          duration(mp3 + '.tmp');
          renameSync(mp3 + '.tmp', mp3);
        } catch (error) {
          rmSync(mp3 + '.tmp', {force: true});
          throw Error(`ElevenLabs generation failed for ${line.audio} (HTTP ${error.statusCode ?? 'unknown'}). Check key permissions, voice access, model and quota. Completed clips are cached; no automatic retry or model fallback was made.`);
        }
      } else log(`Reusing ${line.audio}: ${line.speakerName}`);
      if (!existsSync(wav)) {
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', mp3, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', wav + '.tmp']);
        duration(wav + '.tmp');
        renameSync(wav + '.tmp', wav);
      }
      const seconds = duration(wav);
      clips.push({line: line.line, audio: line.audio, speaker: line.voice, name: line.speakerName,
        ...line.request, fingerprint: line.fingerprint, duration: seconds, sha256: digest(readFileSync(wav))});
    }
    if (digest(readFileSync(manifestFile)) !== digest(originalManifest)) throw Error('Narration changed during generation. Active audio was not replaced; rerun with the current script.');
    mkdirSync(active, {recursive: true});
    // Content-addressed backups preserve manual recordings and earlier generations.
    for (const clip of clips) {
      const target = join(active, clip.audio);
      if (existsSync(target) && digest(readFileSync(target)) !== clip.sha256) {
        const backup = join(folder, 'audio-backups', digest(readFileSync(target)));
        mkdirSync(backup, {recursive: true});
        copyFileSync(target, join(backup, clip.audio));
      }
    }
    for (const clip of clips) {
      const target = join(active, clip.audio);
      if (existsSync(target) && digest(readFileSync(target)) === clip.sha256) continue;
      copyFileSync(join(cache, clip.fingerprint + '.wav'), target + '.tmp');
      renameSync(target + '.tmp', target);
    }
    save(join(folder, 'elevenlabs-audio.json'), {provider: 'ElevenLabs', modelId: config.modelId, clips});
    log(`Activated ${clips.length} WAVs. Rebuild the edit to use their measured durations.`);
    return {clips: clips.length, pending: fresh.length};
  } finally {
    rmSync(lock, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  // Shell environment wins, then .env.local, then .env. Never print env contents.
  for (const name of ['.env.local', '.env']) if (existsSync(join(root, name))) process.loadEnvFile(join(root, name));
  const episode = process.argv[2];
  try { await generateEpisodeAudio({root, episode, dryRun: process.argv.includes('--dry-run')}); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
