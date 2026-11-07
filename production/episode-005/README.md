# Episode 005 — Claude Opus 5.5 vs Stockfish 2000

Sequel to the first chess video, Episode 003. One fresh game, Claude playing White,
using the same public-commentary prompt and restricted chess MCP tools. The intended
experimental change is Stockfish's configured `UCI_Elo`: 1500 → 2000. The engine
receives 500 ms per move, as before. This is an engine strength setting, not a
measurement of Claude's Elo or a guarantee of human tournament strength.

Source: `data/chess-sessions/episode-005-opus55-sf2000-take-1/`. Its `prompt.txt`,
`match-config.json`, `mcp-config.json`, `transcript.jsonl`, and `session/` preserve
the experiment. `replay.json` is the recorder copy enriched only with public text
from the transcript. The earlier unsuffixed folder records a sandbox login failure;
it contains no played game and is not an alternate take.

## Audio handoff

- `recording-sheet.md`: all clips in timeline order, with speaker and filename.
- `narration.txt`: one master line per WAV, consecutively numbered.
- `narration-agent.txt` and `narration-presenter.txt`: speech-only speaker subsets.
- `narration-*-files.json`: subset row → master line → exact WAV filename.
- `narration-manifest.json`: text, speaker, source, placement and estimated slot.
- `expected-audio.txt`: the complete required WAV filename set.

Agent speech is selected recorded public commentary. Tactical claims in it are the
agent's claims at that point in the game; they are not presenter-certified analysis.
Presenter copy is editorial and grounded in the replay. No private thinking blocks
are used. Review the script and speaker mapping before generating audio.

The silent `production/public/episode-005/video/board.mp4` contains the board visuals;
the complete rehearsal is `production/output/episode-005-rehearsal.mp4`.
Its timing fits the temporary narration, and will change with the ElevenLabs files. Supply one whole WAV per manifest entry under
`production/public/episode-005/audio/`, named exactly `N_Chapter_1.wav` using the
master IDs. Do not renumber speaker subsets from 1 or trim recordings to fit draft
slots. The rehearsal uses temporary macOS voices: Samantha for AGENT and Daniel for PRESENTER.
Their WAVs are archived under `placeholder-audio/`; `placeholder-audio.json` records
voice settings, measured durations and hashes. Replace only the active WAVs in the
public audio directory with your ElevenLabs files, keeping the master filenames.

## Resume from the saved game

### Automatic ElevenLabs narration

The shared `production/voices.json` sets Eleven V4 (`eleven_v4`), Bella
(`hpp4J3VqNfWAUOO0d1Us`) for PRESENTER, and Larry (`pgXLagTlUQcy1LT68JCe`) for AGENT.
The official SDK reads `ELEVENLABS_API_KEY` from the shell, then `.env.local`, then
`.env` (earlier values win). Both local secret files are ignored by Git.

Preview the clip count and new text-character total without making API calls:

```sh
node scripts/elevenlabs-narration.mjs episode-005 --dry-run
```

Generate all voices and rebuild, mix, export and validate the complete video:

```sh
node production/episode-005/prepare.mjs --generate-audio --render
```

To generate only the WAV set:

```sh
node scripts/elevenlabs-narration.mjs episode-005
```

Each manifest entry becomes one request with its exact text and assigned voice.
Responses are saved as MP3 and converted locally to 48 kHz mono PCM WAV; conversion
does not improve the original MP3 quality. This API output format avoids requiring
an account tier with access to lossless API output. No script or model substitution
is made. No unsupported V4 style/speed settings are sent.

Content-addressed `elevenlabs-cache/` retains completed responses and WAVs: unchanged
reruns make no new generation requests, and changed text, voice or model gets a new
cache entry. `elevenlabs-audio.json` records exact requests, measured durations and
file hashes. Failures leave the active WAV set intact until every new clip is ready.
Before activation, previous recordings are preserved under `audio-backups/`. The
rehearsal MP4 and `placeholder-audio/` also remain available. Requests are sequential
and have no automatic retries, to avoid silently repeating a potentially charged
request. If a process is forcibly killed, confirm it has stopped before removing
its `.elevenlabs-lock/` directory and resuming. A failed request with no completed
local response may have consumed credits remotely; inspect account history before
rerunning it.

Implementation follows the official [Text to Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
and [Eleven V4 model example](https://elevenlabs.io/v4).

### Existing audio or draft only

From the repository root, regenerate the draft and handoff:

```sh
node production/episode-005/prepare.mjs
```

After all WAVs arrive, measure them, rebuild the board timing, refresh the edit plan,
and validate the complete audio/video edit:

```sh
node production/episode-005/prepare.mjs --with-audio --render
```

The resume command exports the complete video directly: this edit is one full-frame
board shot, so it can mux the board MP4 with the validated mixed soundtrack without
re-encoding its visuals. It checks the final video streams, frame count, full decode,
black frames and all narration windows. For a changed edit layout, use Motion Canvas:

```sh
EPISODE_ID=episode-005 npm run episode:render
EPISODE_ID=episode-005 npm run episode:check-render
```

These commands reuse the saved match; they do not start another game. The licensed
music and its attribution are copied from Episode 003. The rehearsal and its timing/validation snapshots are preserved separately as
`rehearsal-*.json`; the replacement-audio export updates `episode-005.mp4`.
`presenter-lines.json` keeps the editorial card speech stable during regeneration.

## YouTube upload copy

Every successful `prepare.mjs --with-audio --render` (including `--generate-audio
--render`) now finishes by generating `youtube.md`: recommended and alternative
titles, description, chapters, verified result, tags, exact music credit and
end-screen timing. It reads the final narration timeline and validated export.
It does not generate speech again or modify YouTube.

Edit `youtube-config.json` for the title, alternatives, context, tags and chapter
labels. Chapter anchors refer to recorded plies/cues, not handwritten seconds;
audio replacements therefore move their timestamps automatically. Rejected-move
chapters begin at the actual rejection card. The generator checks chapter spacing
and rejects missing anchors or stale timing. Without a config it uses a basic
matchup template and move labels; it performs no keyword research or title scoring.

Regenerate only the upload file for an already validated final video:

```sh
npm run chess:youtube -- episode-005
```
