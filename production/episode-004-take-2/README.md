# Episode 004 — take 2 (two completed games)

This take uses the 13:14 UTC session on 4 November 2026, not the morning recording.
Games 1 and 2 both ended in a Claude win. Game 3 stopped at tick 102 on Claude's
usage limit and is excluded. The earlier take and its audio files are preserved.

## Audio generation

**35 clips: 27 AGENT and 8 PRESENTER. Generate both speakers.**

Use the current `narration.txt`. **Master line N = clip N = `N_Chapter_1.wav`.**
Generate all 35 lines consecutively; there are no skipped file numbers.

Presenter lines: **1, 2, 3, 18, 19, 25, 34, 35**. Every other line is AGENT.
For example, line 20 (“Rivals on both sides…”) is Claude and saves as
`20_Chapter_1.wav`. Line 29 (“They've gone south…”) is also Claude and saves as
`29_Chapter_1.wav`.

- `recording-sheet.md` and `narration-index.md`: exact current speaker/file/text mapping.
- `narration.txt` and `audio-files.txt`: all 35 lines and filenames in the same order.
- `narration-agent.txt` and `audio-files-agent.txt`: the agent subset and its filenames.
- `narration-presenter.txt` and `audio-files-presenter.txt`: the presenter subset and its filenames.
- `narration-manifest.json`: authoritative current mapping and original call provenance.

Save the WAVs in `production/public/episode-004-take-2/audio/` as
`1_Chapter_1.wav` through `35_Chapter_1.wav`. Speaker-only text files are subsets:
use their matching filename lists rather than numbering each speaker from 1.
Use the current files only; `before-flow` and `archive/` are historical backups.

The audio folder was empty when this numbering was corrected. No supplied audio
was renamed or replaced. Original clip IDs survive as provenance only; they do
not determine current filenames. No recorded agent words were changed.

## Video

The edit contains an opening splash, a Game 1 card, Game 1, a Game 2 transition
card, Game 2, and an ending card. Cards use darkened, truthful board states. Card
speech is presenter copy. The revised silent draft fits estimated speech over moving, slowed gameplay and
uses the same encoded card/game sources as the final Motion Canvas scene.
Only brief (about 0.65-second) lead-ins remain before plans. Rules and result
summaries have moved onto splash cards. Repeated pickup/bump commentary was
omitted from game 2, and the second “Very thrifty” line is gone. Game 2 also has
explicit slow-motion focus windows around the body-block contest and
final escape. They are editorial emphasis, not claims of bomb-kill credit.

The previous take's 1080p/30 format is preserved. This is another take of Episode
004, not an upscale of footage or a new 4K template. No sound effects or music
have been added.

Rebuild the silent draft from the repository root:

```sh
node --import tsx scripts/detonarium-episode.ts --episode episode-004-take-2
```

After all audio files are ready:

```sh
node --import tsx scripts/detonarium-episode.ts --episode episode-004-take-2 --audio-dir production/public/episode-004-take-2/audio
EPISODE_ID=episode-004-take-2 npm run episode:validate
EPISODE_ID=episode-004-take-2 npm run episode:render
EPISODE_ID=episode-004-take-2 npm run episode:check-render
```

The rebuild measures whole WAVs and adjusts all game playback speeds and cards. Final output:
`production/output/episode-004-take-2.mp4`. Until then, review
`production/output/episode-004-take-2-silent-draft.mp4`.
