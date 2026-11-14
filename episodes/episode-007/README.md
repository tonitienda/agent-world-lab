# Episode 007 — the first solo transport experiment

Claude Opus 5.5 plays OpenTTD through restricted MCP tools. The public goal is in
`goal.md`; the episode specification is in `episode.json`. Agent tool access is
limited to ordinary construction, vehicle orders, company observations and bounded
time advancement. The admin console and observer recorder belong to the trusted
runner. Public `narration` fields are recorded verbatim for synthesized agent speech;
technical summaries and private model deliberation are not voiceover sources.

The starting company has 20,000 cash and a 20,000 loan. It must deliver at least
200 passengers in at most 120 economy days, finish with at least 5,000 cash and
positive fleet operating profit, never borrow more than 20,000, and operate at most
three buses. The runner also enforces 200 tool calls, 80 action calls, a 25-minute
wall budget and a 15-dollar Claude budget. Game time advances only through tools.

The separate feasibility baseline, stored under
`data/openttd-sessions/episode-007-feasibility-01/`, met all targets at day 105:
454 passengers, 5,302 cash and 1,385 combined bus operating profit. It demonstrates
that the challenge is doable under the same rules; none of its footage or commentary
is attributed to Claude. Claude does not receive its route or strategy.

The first Claude take is `data/openttd-sessions/episode-007-claude-take-1/`.
Source selection, narration, editable camera and Motion Canvas timelines live under
`production/episode-007/`. Raw world states, captures, transcripts and credentials
remain in ignored runtime data.

## Run/resume

```sh
npm run episode:007
```

The complete pipeline plays only when the selected session does not exist. A
completed take is reused for narration, audio, measured camera timing, Motion Canvas
export, final checks and `youtube.md`. An unfinished existing take is preserved;
it is never silently restarted. The command uses the existing ElevenLabs voices
and content-addressed audio cache, so unchanged clips do not consume new requests.

Individual stages:

```sh
npm run openttd:play -- --out data/openttd-sessions/<new-take>
node production/episode-007/prepare.mjs
node scripts/elevenlabs-narration.mjs episode-007 --dry-run
node production/episode-007/prepare.mjs --generate-audio --render
```

For a different selected take, update `production/episode-007/source.json` explicitly.
Audio generation/rendering always reads that completed take and never replays it.
Edit `presenter-lines.json` for presenter copy and `editorial-selection.json` for
whole agent-utterance omissions; never write new agent speech as if it were recorded.
The master recording sheet distinguishes every speaker and exact output filename.

The new transport cameras are editorial crops of daily full-world frames with a
map inset and actual waiting counts. Export is 4K/60; the underlying gameplay is
sampled time-lapse with paused construction/decision holds, not continuous 60fps
footage. The final export uses the shared Motion Canvas scene and soundtrack.

Episode 006 remains a Minecraft production in its own worktree. Collaboration is
reserved for a later transport experiment, around episode 009.
