// Build local upload copy after final video validation. No account/API access.
// node --import tsx scripts/chess-youtube.ts episode-005
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {DEFAULT_PACING, type ChessReplay} from '../packages/chess/src/index.js';
import {presenterLines, type Narration, type ScriptLine} from './chess-narration.js';

type Chapter = {kind: 'intro' | 'cue' | 'illegal' | 'outro'; ply?: number; title: string};
type Config = {title?: string; alternatives?: string[]; tags?: string[]; context?: string; chapters?: Chapter[]};
type Validation = {duration: number; schedule: {line: number; start: number; duration: number}[]; credits: {text: string}[]};
export const timestamp = (seconds: number) => {
  const s = Math.floor(seconds + 1e-6), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function youtubeCopy({episode, replay, narration, manifest, validation, config = {}, elo, depth}: {
  episode: string; replay: ChessReplay; narration: Narration; manifest: ScriptLine[];
  validation: Validation; config?: Config; elo?: number | string; depth?: number;
}) {
  if (!replay.result || !replay.moves.length) throw Error('YouTube copy requires a completed game.');
  if (Math.abs(narration.duration - validation.duration) > 1 / 30 + .001) throw Error('Narration and final video durations differ.');
  if (manifest.length !== validation.schedule.length || manifest.some((l, i) =>
    l.line !== validation.schedule[i].line || Math.abs(l.at - validation.schedule[i].start) > .002))
    throw Error('Narration placement differs from the validated edit.');
  if (narration.cues.some(c => !manifest.some(l => l.ply === c.ply && Math.abs(l.at - c.start) < .002 && l.text === c.text)))
    throw Error('Chapter cues differ from the narration manifest.');
  const side = (['white', 'black'] as const).find(s => replay.players[s].kind === 'agent');
  if (!side) throw Error('This upload template requires an agent-versus-engine game.');
  const agent = replay.players[side].label, rival = replay.players[side === 'white' ? 'black' : 'white'].label;
  const title = config.title ?? `Can ${agent} beat ${rival}?`;
  const alternatives = config.alternatives ?? [`${agent} vs ${rival}: no legal-move hints`, `${agent} plays chess against ${rival}`];
  if ([title, ...alternatives].some(t => !t.trim() || t.length > 100 || /[\r\n]/.test(t))) throw Error('Titles must be single lines of 1–100 characters.');
  const tags = config.tags ?? [agent, 'Claude', 'AI chess', 'LLM chess', rival, 'Stockfish', 'AI vs Stockfish', 'The Agent Terrarium'];
  if (tags.join(', ').length > 500) throw Error('Tags exceed 500 characters.');
  const requested = config.chapters ?? [
    {kind: 'intro', title: `${agent} vs ${rival}`} as Chapter,
    ...narration.cues.map(c => ({kind: 'cue', ply: c.ply, title: `Move ${Math.ceil(c.ply / 2)}: ${replay.moves[c.ply - 1].san}`} as Chapter)),
    {kind: 'outro', title: 'Final result and stats'} as Chapter,
  ];
  const chapters = requested.map(c => {
    if (!c.title?.trim() || /[\r\n]/.test(c.title)) throw Error('Chapter titles must be nonempty single lines.');
    let at: number;
    if (c.kind === 'intro') at = 0;
    else if (c.kind === 'outro') at = narration.outro.start;
    else {
      const cue = narration.cues.find(q => q.ply === c.ply);
      if (!cue) throw Error(`Chapter references missing cue at ply ${c.ply}.`);
      const rejected = replay.illegal.filter(a => a.ply === c.ply).length;
      if (c.kind === 'illegal' && !rejected) throw Error(`No rejected move at ply ${c.ply}.`);
      at = cue.start - (c.kind === 'illegal' ? rejected * DEFAULT_PACING.illegal : 0);
    }
    return {at: Math.floor(at + 1e-6), title: c.title};
  });
  // Default chapters may be dense; curated config must meet the rules as authored.
  const selected = config.chapters ? chapters : chapters.reduce<typeof chapters>((kept, c) => {
    if ((!kept.length || c.at - kept.at(-1)!.at >= 10) && validation.duration - c.at >= 10) kept.push(c);
    return kept;
  }, []);
  if (selected.length < 3 || selected[0].at !== 0 || selected.some((c, i) =>
    (selected[i + 1]?.at ?? validation.duration) - c.at < 10))
    throw Error('Chapters must start at 0:00, contain at least 3 entries, and last at least 10 seconds each.');
  const last = replay.moves.at(-1)!;
  const finalMove = `${Math.ceil(last.ply / 2)}${last.side === 'white' ? '.' : '...'} ${last.san}`;
  const result = replay.result.winner === 'white' ? '1-0' : replay.result.winner === 'black' ? '0-1' : '1/2-1/2';
  const chapterText = selected.map(c => `${timestamp(c.at)} ${c.title}`).join('\n');
  const description = [
    `${agent} plays ${side} against ${rival}${elo !== undefined && elo !== 'full' ? `, with Stockfish's UCI_Elo setting at ${elo}` : ''}. Claude gets the board and move history, with no legal-move list, engine evaluation or hints. Illegal attempts are rejected and counted. Hear the agent's public commentary in its own words.`,
    ...(config.context ? [config.context] : []),
    `The evaluation bar and move grades come from full-strength Stockfish analysis${depth ? ` at depth ${depth}` : ''} after the game. They were never shown to Claude during play. An engine's configured Elo is not a measurement of Claude's rating.`,
    'Chapters\n' + chapterText,
    `Final move: ${finalMove}. ${result}. ${presenterLines(replay).outro.replace('Along the way, it tried', `${agent} tried`)}`,
    ...(validation.credits.length ? ['Music\n' + validation.credits.map(c => c.text).join('\n\n')] : []),
    '#chess #AI #Claude',
  ].join('\n\n');
  if (description.length > 5000) throw Error('Description exceeds 5,000 characters.');
  const end = narration.end;
  return `# ${episode} — YouTube packaging\n\nVideo: \`production/output/${episode}.mp4\` (${timestamp(validation.duration)}, 1080p30).\nGenerated from the validated final timeline. Edit youtube-config.json to preserve editorial changes on regeneration.\n\n## Title\n\nRecommended:\n\n**${title}**\n\nAlternatives:\n\n${alternatives.map(t => '- ' + t).join('\n')}\n\n## Description\n\n\`\`\`\n${description}\n\`\`\`\n\n## Tags\n\n\`\`\`\n${tags.join(', ')}\n\`\`\`\n\n## Notes\n\n- Chapter times follow the current audio and final edit; no estimated reading durations are used.\n- Chapters start at 0:00, with at least three entries and at least 10 seconds each. [YouTube chapter requirements](https://support.google.com/youtube/answer/9884579?hl=en).\n${end ? `- Place end-screen elements over ${timestamp(end.start)}–${timestamp(validation.duration)}. Keep the final stats chapter through the end card.\n` : ''}- Music credits are copied verbatim from validation.json.\n- This file is local upload copy; generation makes no YouTube changes.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const episode = process.argv[2];
  if (!/^episode-[a-zA-Z0-9-]+$/.test(episode ?? '')) throw Error('Usage: chess-youtube.ts episode-005');
  const root = resolve(import.meta.dirname, '..'), folder = join(root, 'production', episode);
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  const source = read(join(folder, 'source.json'));
  const session = resolve(root, source.session);
  const validation = read(join(folder, 'validation.json'));
  const rendered = read(join(folder, 'render-validation.json'));
  const output = join(root, 'production/output', `${episode}.mp4`);
  const actual = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output], {encoding: 'utf8'}));
  if (!rendered.decoded || rendered.blackIntervals.length || !Number.isFinite(actual) || Math.abs(actual - validation.duration) > .08 || Math.abs(rendered.duration - actual) > .08)
    throw Error('A matching, validated final video is required before generating youtube.md.');
  const configPath = join(folder, 'youtube-config.json');
  const text = youtubeCopy({episode, replay: read(join(session, 'replay.json')), narration: read(join(session, 'narration.json')),
    manifest: read(join(folder, 'narration-manifest.json')), validation,
    config: existsSync(configPath) ? read(configPath) : {}, elo: source.match?.elo, depth: source.analysis?.depth});
  writeFileSync(join(folder, 'youtube.md'), text);
  console.log(`YouTube upload copy → production/${episode}/youtube.md`);
}
