// Cuts a recorded Hedgewars match down to its shots and captions each one with
// the line the model gave for it. With --episode it also voices the cut:
//   node scripts/hedgewars-cut.mjs <session dir> --episode=<id> --manifest-only   writes the narration manifest
//   node scripts/elevenlabs-narration.mjs <id>                                    generates the voices
//   node scripts/hedgewars-cut.mjs <session dir> --episode=<id>                   renders the voiced cut
// Optional --offset=<seconds>: game time already passed when the recording began (default 3.2).
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';

const flags = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
const session = resolve(process.argv.slice(2).find(a => !a.startsWith('--')) ?? '');
const episode = flags.episode;
const LEAD = 1.3, TAIL = 2.2, GAP = 0.25, TEMPO = 1.12, W = 1920, H = 1080, FPS = 30;
const COLORS = {Claude: '#d97757', Codex: '#10a37f'};
const probe = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'}));

const facts = JSON.parse(readFileSync(join(session, 'facts.json'), 'utf8'));
const events = readFileSync(join(session, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const source = join(session, 'match.mp4');
const gameAudio = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', source], {encoding: 'utf8'}).trim() !== '';
const length = probe(source);
const hogs = new Map(facts.filter(f => f.kind === 'hog').map(f => [f.id, {name: f.name, clan: Number(f.clan)}]));
const teams = [...new Set(events.map(e => e.seat))].sort().map(seat => events.find(e => e.seat === seat).team);

// Game seconds already passed when the recording began. With game audio it is
// measured: the offset that lines the explosion sounds up with the impact facts.
const offset = flags.offset !== undefined ? Number(flags.offset) : gameAudio ? (() => {
  const run = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${source}" -af astats=metadata=1:reset=2,ametadata=print:key=lavfi.astats.Overall.Peak_level -vn -f null - 2>&1`],
    {encoding: 'utf8', maxBuffer: 1 << 28});
  const onsets = [];
  let time, before = -99;
  for (const line of run.split('\n')) {
    const at = line.match(/pts_time:([0-9.]+)/);
    if (at) time = Number(at[1]);
    const peak = line.match(/Peak_level=(-?[0-9.]+)\s*$/);
    if (peak && time !== undefined) { const level = Number(peak[1]); if (level > -3 && before <= -3) onsets.push(time); before = level; }
  }
  const impacts = facts.filter(f => f.kind === 'impact').map(f => Number(f.t) / 1000);
  let best = {error: Infinity, offset: 0};
  for (let o = 0; o < 15; o += 0.01) {
    const error = impacts.reduce((sum, i) => sum + Math.min(1, ...onsets.map(s => Math.abs(i - o - s))), 0);
    if (error < best.error) best = {error, offset: o};
  }
  console.log(`measured offset ${best.offset.toFixed(2)} s from ${onsets.length} loud onsets and ${impacts.length} impacts`);
  return best.offset;
})() : 3.2;
const video = t => Number(t) / 1000 - offset;

// One beat per turn: every action of that turn, with what it did.
const spoken = events.filter(e => e.narration);
const acks = facts.filter(f => f.kind === 'ack');
if (spoken.length !== acks.length) throw Error(`${spoken.length} narrated actions but ${acks.length} acknowledged ones`);
const beats = [], dead = new Set(), beatOfAck = new Map();
let beat, winner;
for (const fact of facts) {
  if (fact.kind === 'turn') beat = undefined;
  if (fact.kind === 'ack') {
    const hog = hogs.get(fact.hog), line = spoken[acks.indexOf(fact)].narration.replace(new RegExp(`^${hog.name}:\\s*`), '');
    if (!beat) beats.push(beat = {hog, team: teams[hog.clan], start: video(fact.t) - LEAD, lines: [], results: [], end: 0});
    beat.lines.push({at: video(fact.t) - LEAD, ack: video(fact.t), text: line.charAt(0).toUpperCase() + line.slice(1)});
    beatOfAck.set(acks.indexOf(fact), beat);
    beat.end = video(fact.t) + TAIL;
  }
  if (fact.kind === 'dead') dead.add(fact.id);
  if (fact.kind === 'over') winner = fact.winner === undefined ? undefined : teams[Number(fact.winner)];
  if (!beat) continue;
  if (fact.kind === 'impact') { beat.hit ??= video(fact.t); beat.end = Math.max(beat.end, video(fact.t) + TAIL); }
  if (fact.kind === 'damage') {
    const name = hogs.get(fact.id).name, old = beat.results.find(r => r.name === name);
    if (old) old.damage += Number(fact.dmg); else beat.results.push({name, damage: Number(fact.dmg)});
  }
  if (fact.kind === 'dead') { beat.results.push({name: hogs.get(fact.id).name, dead: true}); beat.end = Math.max(beat.end, video(fact.t) + TAIL); }
}

// A reaction is given with the first wait_for_turn after a shot: it belongs to that seat's last beat.
{
  const last = new Map();
  for (const event of events) {
    if (event.narration) last.set(event.seat, beatOfAck.get(spoken.indexOf(event)));
    const b = last.get(event.seat);
    if (event.reaction && b && !b.reaction) b.reaction = {text: event.reaction.replace(new RegExp(`^${b.hog.name}:\\s*`), '')};
  }
}
for (const b of beats) {
  b.selfHarm = b.results.some(r => hogs.get([...hogs].find(([, h]) => h.name === r.name)[0]).clan === b.hog.clan);
  b.kill = b.results.some(r => r.dead && [...hogs.values()].find(h => h.name === r.name).clan !== b.hog.clan);
}

const names = clan => [...hogs.values()].filter(h => h.clan === clan).map(h => h.name);
const and = list => list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] ?? '';
const survivors = [...hogs].filter(([id, h]) => !dead.has(id) && teams[h.clan] === winner).map(([, h]) => h.name);
const intro = `Hedgewars. ${teams[0]}'s ${and(names(0))} against ${teams[1]}'s ${and(names(1))}. Last team standing wins.`;
const outro = winner ? `${winner} wins. ${and(survivors)} ${survivors.length > 1 ? 'are' : 'is'} the last standing.` : 'A draw.';

// Narration: presenter opening, every agent line, presenter ending.
let voices;
if (episode) {
  const folder = join('production', episode);
  // Delivery tags only steer the voice; captions keep the agent's own words.
  const lively = {stability: 0.3, similarityBoost: 0.75};
  const agent = (b, text, tag) => ({speaker: b.hog.name.toLowerCase(), voice: 'agent', text: `[${tag}] ${text}`, voiceSettings: lively, source: `${session} · ${b.hog.name}`});
  const mood = b => b.selfHarm ? 'embarrassed' : b.kill ? 'laughs' : b.results.length ? 'excited' : 'frustrated';
  const manifest = [{card: 'opening', voice: 'presenter', text: `[excited] ${intro}`, voiceSettings: {stability: 0.4, similarityBoost: 0.75}},
    ...beats.flatMap(b => [...b.lines.map(l => agent(b, l.text, /!/.test(l.text) ? 'excited' : 'playful')),
      ...(b.reaction ? [agent(b, b.reaction.text, mood(b))] : [])]),
    {card: 'ending', voice: 'presenter', text: `[excited] ${outro}`, voiceSettings: {stability: 0.4, similarityBoost: 0.75}}]
    .map((line, i) => ({...line, line: i + 1, audio: `${i + 1}_Chapter_1.wav`}));
  mkdirSync(folder, {recursive: true});
  const file = join(folder, 'narration-manifest.json'), text = JSON.stringify(manifest, null, 2) + '\n';
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
  if ('manifest-only' in flags) { console.log(`${manifest.length} lines → ${file}`); process.exit(0); }
  const generated = JSON.parse(readFileSync(join(folder, 'elevenlabs-audio.json'), 'utf8')).clips;
  if (generated.length !== manifest.length || generated.some((c, i) => c.text !== manifest[i].text))
    throw Error(`The voices in ${folder} are out of date; run node scripts/elevenlabs-narration.mjs ${episode}`);
  // Agents talk a touch faster than ElevenLabs reads them, so the show keeps pace with the game.
  voices = generated.map((c, i) => {
    const tempo = i === 0 || i === generated.length - 1 ? 1 : TEMPO;
    return {file: resolve('production/public', episode, 'audio', c.audio), duration: c.duration / tempo, tempo};
  });
}

// Fit the beats together. Each agent line is said while its hedgehog lines up the
// shot and ends as it fires; the reaction follows the impact. Footage never repeats:
// when a turn's voices outlast its footage, the last frame holds until they finish.
let next = 1;
for (const b of beats) {
  if (!voices) continue;
  for (const l of b.lines) l.voice = voices[next++];
  if (b.reaction) b.reaction.voice = voices[next++];
  let ends = Infinity;
  for (const l of [...b.lines].reverse()) { l.at = Math.min(l.ack + 0.5, ends - GAP) - l.voice.duration; ends = l.at; }
  b.start = Math.min(b.start, b.lines[0].at);
}
let floor = 0;
beats.forEach((b, i) => {
  b.start = Math.max(0, b.start, floor);
  // A reaction may run on over the next turn's opening footage, until that turn's first line.
  if (b.spill) b.carry = {from: beats[i - 1], until: b.start + b.spill};
  let said = b.start + (b.spill ?? 0);
  for (const l of b.lines) { l.at = Math.max(l.at, said); if (l.voice) said = l.at + l.voice.duration + GAP; }
  const linesDone = said;
  if (b.reaction) {
    b.reaction.at = Math.max((b.hit ?? b.lines.at(-1).ack) + 0.3, said);
    said = b.reaction.at + (b.reaction.voice?.duration ?? 2.5) + GAP;
  }
  const next = beats[i + 1];
  if (!next) { b.footageEnd = Math.min(b.end, length - 0.05); b.end = Math.max(b.end, voices ? said : 0); return; }
  b.footageEnd = Math.min(Math.max(next.start, b.hit ?? 0, b.start + 0.5), length - 0.05);
  const nextStart = Math.max(next.start, b.footageEnd);
  const room = voices ? Math.max(0, next.lines[0].at - nextStart) : 0;
  const hold = voices ? Math.max(0, linesDone - b.footageEnd, said - b.footageEnd - room) : 0;
  b.end = b.footageEnd + hold;
  if (b.reaction && said - GAP > b.end) next.spill = said - b.end;
  floor = b.footageEnd;
});

const esc = s => String(s).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const resultText = b => b.results.length
  ? b.results.map(r => r.dead ? `${r.name} is out` : `${r.name} −${r.damage}`).join(' · ')
  : 'Miss';
const page = body => `<html><body style="margin:0;width:${W}px;height:${H}px;background:transparent;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">${body}</body></html>`;
const bar = (b, text, result, reaction) => page(`
  <div style="position:absolute;left:60px;right:60px;top:36px;display:flex;align-items:stretch;background:rgba(14,16,22,.86);border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.45)">
    <div style="background:${COLORS[b.team] ?? '#888'};color:#fff;padding:18px 28px;min-width:150px;display:flex;flex-direction:column;justify-content:center">
      <div style="font-size:40px;font-weight:800;line-height:1">${esc(b.hog.name)}</div>
      <div style="font-size:22px;font-weight:600;opacity:.9;margin-top:6px;letter-spacing:.06em;text-transform:uppercase">${esc(b.team)}</div>
    </div>
    <div style="flex:1;color:#f4f1ea;font-size:36px;line-height:1.25;padding:18px 28px;display:flex;align-items:center">“${esc(text)}”</div>
    ${result ? `<div style="color:${b.results.length ? '#ffd166' : '#9aa3b2'};font-size:34px;font-weight:800;padding:18px 30px;display:flex;align-items:center;white-space:nowrap;border-left:2px solid rgba(255,255,255,.12)">${esc(result)}</div>` : ''}
  </div>
  ${reaction ? pillHtml(b, reaction) : ''}`);
const pillHtml = (b, reaction) => `<div style="position:absolute;left:60px;right:60px;bottom:110px;display:flex;justify-content:center">
    <div style="max-width:1500px;background:${COLORS[b.team] ?? '#888'};color:#fff;font-size:40px;font-weight:700;line-height:1.25;padding:18px 34px;border-radius:40px;box-shadow:0 6px 24px rgba(0,0,0,.45)">
      ${esc(b.hog.name)}: “${esc(reaction)}”</div></div>`;
const card = (title, sub, color = '#f4f1ea') => page(`
  <div style="position:absolute;inset:0;background:rgba(10,12,18,.62);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f4f1ea;text-align:center">
    <div style="font-size:120px;font-weight:800;color:${color}">${title}</div>
    <div style="font-size:46px;margin-top:22px;opacity:.92">${sub}</div>
  </div>`);

const work = join(session, 'cut');
rmSync(work, {recursive: true, force: true});
mkdirSync(work, {recursive: true});
const require = createRequire(resolve('packages/minecraft-recorder/package.json'));
const browser = await require('playwright').chromium.launch();
const tab = await browser.newPage({viewport: {width: W, height: H}});
const png = async (name, html) => {
  await tab.setContent(html);
  await tab.screenshot({path: join(work, name), omitBackground: true});
  return join(work, name);
};

/** Each clip with the voice lines it carries (seconds into the clip). */
const clips = [];
const encode = (name, input, overlays, duration, sounds = []) => {
  const out = join(work, name);
  const chain = overlays.map((o, i) => `[${i ? 'v' + i : 'base'}][${i + 1}:v]overlay=enable='${o.when}'[v${i + 1}]`).join(';');
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...input, ...overlays.flatMap(o => ['-loop', '1', '-i', o.file]),
    // Clone the last frame in case the clip runs past the end of the recording.
    '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=30,scale=${W}:${H}:flags=lanczos,fps=${FPS}[base];${chain}`
      + (gameAudio ? `;[0:a]aresample=48000,apad[aout]` : ''),
    '-map', `[v${overlays.length}]`, ...(gameAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : []),
    '-t', duration.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', out]);
  clips.push({file: out, sounds});
};

const vs = teams.map(t => `<span style="color:${COLORS[t]}">${esc(t)}</span>`).join(' vs ');
const first = beats[0].start;
const openFor = Math.max(3.5, voices ? voices[0].duration + 1 : 0);
encode('000-opening.mp4', ['-ss', Math.max(0, first - openFor).toFixed(3), '-i', source],
  [{file: await png('opening.png', card(`Hedgewars`, `${vs}<br><span style="font-size:34px;opacity:.8">${esc(and(names(0)))} against ${esc(and(names(1)))} · last team standing wins</span>`)), when: '1'}],
  openFor, voices ? [{at: 0.4, ...voices[0]}] : []);
for (const [i, b] of beats.entries()) {
  const id = String(i + 1).padStart(3, '0'), overlays = [];
  if (b.carry) overlays.push({file: await png(`${id}-carry.png`, page(pillHtml(b.carry.from, b.carry.from.reaction.text))), when: `lt(t,${(b.carry.until - b.start).toFixed(3)})`});
  for (const [j, line] of b.lines.entries()) {
    const from = Math.max(0, line.at - b.start), last = j === b.lines.length - 1;
    // The result chip appears at impact, but never before the line is finished.
    const until = last ? (b.hit === undefined ? 1e6 : Math.max(b.hit, voices ? line.at + line.voice.duration : 0) - b.start) : b.lines[j + 1].at - b.start;
    overlays.push({file: await png(`${id}-${j}.png`, bar(b, line.text)), when: `between(t,${from.toFixed(3)},${until.toFixed(3)})`});
    if (last && b.hit !== undefined) {
      const react = b.reaction ? b.reaction.at - b.start : 1e6;
      overlays.push({file: await png(`${id}-hit.png`, bar(b, line.text, resultText(b))), when: `between(t,${until.toFixed(3)},${react.toFixed(3)})`});
      if (b.reaction) overlays.push({file: await png(`${id}-react.png`, bar(b, line.text, resultText(b), b.reaction.text)), when: `gte(t,${react.toFixed(3)})`});
    }
  }
  encode(`${id}.mp4`, ['-ss', b.start.toFixed(3), '-t', (b.footageEnd - b.start).toFixed(3), '-i', source], overlays, b.end - b.start,
    [...b.lines, ...(b.reaction ? [b.reaction] : [])].filter(l => l.voice).map(l => ({at: l.at - b.start, ...l.voice})));
}
const endFor = Math.max(5, voices ? voices.at(-1).duration + 1.5 : 0);
encode('999-ending.mp4', ['-ss', (length - 0.2).toFixed(3), '-i', source],
  [{file: await png('ending.png', card(winner ? `${esc(winner)} wins` : 'Draw', `${beats.length} turns`, COLORS[winner])), when: '1'}],
  endFor, voices ? [{at: 0.5, ...voices.at(-1)}] : []);
await browser.close();

writeFileSync(join(work, 'list.txt'), clips.map(c => `file '${c.file}'`).join('\n') + '\n');
const out = join(session, voices ? 'cut-voiced.mp4' : 'cut.mp4');
const silent = voices ? join(work, 'video.mp4') : out;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', silent]);
if (voices) {
  // Place every line by the real length of the clips before it, so rounding never drifts.
  let t = 0;
  const placed = [];
  for (const clip of clips) {
    for (const s of clip.sounds) placed.push({file: s.file, tempo: s.tempo, at: t + s.at});
    t += probe(clip.file);
  }
  // Voices on top; the game's own sound sits underneath and ducks while someone speaks.
  const voicesMix = placed.map((p, i) => `[${i + 1}:a]${p.tempo > 1 ? `atempo=${p.tempo},` : ''}adelay=${Math.round(p.at * 1000)}:all=1[a${i}]`).join(';')
    + `;${placed.map((_, i) => `[a${i}]`).join('')}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,apad`;
  const mix = gameAudio
    ? `${voicesMix},asplit[vox][key];[0:a]volume=0.55[game];[game][key]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[ducked];`
      + `[ducked][vox]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[mix]`
    : `${voicesMix}[mix]`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', silent, ...placed.flatMap(p => ['-i', p.file]),
    '-filter_complex', mix, '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', t.toFixed(3), '-movflags', '+faststart', out]);
}
writeFileSync(join(session, 'cut.json'), JSON.stringify(beats, null, 1));
console.log(`${beats.length} beats, ${clips.length} clips${voices ? `, ${voices.length} voice lines` : ''} → ${out}`);
