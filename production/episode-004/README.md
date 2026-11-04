# Episode 004 — two-game Detonarium edit

This folder preserves the existing two-game take and its original audio mapping.
For the next take, use the updated [narration/card requirements](../../docs/narration-and-rounds.md)
and [opponent-information specification](../../docs/detonarium-plan.md#next-recording-observation-fairness).
Use a new production directory for replacement recordings. This older take has no splash segments. The builder now supports splash metadata
for new takes, such as `episode-004-take-2`. New
LLM observations now hide opponent upgrades and enemy bomb ranges. CPU bots still
use full simulation state; the information restriction currently applies to the
LLM player, not to CPU planning.

For this take, **9 clips are presenter copy and 13 are recorded agent speech**.
Presenter lines: **1, 2, 7, 10, 11, 17, 20, 21, 22**.
Agent lines: **3, 4, 5, 6, 8, 9, 12, 13, 14, 15, 16, 18, 19**.
The [recording sheet](recording-sheet.md) lists every clip, speaker and exact filename.
Speech-only speaker bundles are `narration-presenter.txt` and `narration-agent.txt`;
their rows map to the filenames in that sheet, not newly numbered audio files.

`narration.txt` is the audio-generation input: **22 lines, one complete audio clip per line, in order.** Do not speak line numbers, filenames or metadata. There are no headings in that file.

Save the results as `1_Chapter_1.wav` through `22_Chapter_1.wav` in `production/public/episode-004/audio/`. `narration-manifest.json` identifies the voice and source for every line. Presenter lines are editorial; agent lines are verbatim selections from the recorded public intentions/rationales. A single voice is also fine.

The script is 564 words. Estimated pacing is only for the silent draft. Generate the whole clips naturally; do not rush or trim a take to fit a draft pause.

Once all 22 files are ready, from the repository root:

```sh
node --import tsx scripts/detonarium-episode.ts --audio-dir production/public/episode-004/audio
EPISODE_ID=episode-004 npm run episode:validate
EPISODE_ID=episode-004 npm run episode:render
EPISODE_ID=episode-004 npm run episode:check-render
```

The first command measures every clip and rebuilds the game footage's holds around actual speech lengths. It prepares the shared Motion Canvas scene and edit plan. The remaining commands validate, mix narration and export `production/output/episode-004.mp4`. Review speech and visible action together after this pass.

Before audio is available, recreate the silent draft with:

```sh
node --import tsx scripts/detonarium-episode.ts
```

Output: `production/output/episode-004-silent-draft.mp4`. This includes games 1 and 2 only, plus estimated narration holds. It is silent, not the final narrated export. The shared project's audio validation is expected to report missing WAVs until the clips exist.

`source.json` preserves the exact session selection. Original replays, calls and the previous Game 2 render are untouched. Per-game cuts and absolute narration timestamps live under `production/public/episode-004/generated/`. Game 3 is excluded because it stopped on a usage limit before the match ended.
