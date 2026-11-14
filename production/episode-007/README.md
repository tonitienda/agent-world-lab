# Episode 007 — Claude Transit

Source: `data/openttd-sessions/episode-007-claude-take-1`.

Run `node production/episode-007/prepare.mjs --generate-audio --render` to resume production from the saved take. This never starts another game.

The master manifest preserves exact agent speech, filenames and separate AGENT/PRESENTER voice mapping. The camera study is daily sampled time-lapse; construction/decision holds are explicitly editorial. Game time is paused while Claude thinks.

The game objective is 200 delivered passengers within 120 economy days, at least 5,000 ending cash, positive fleet operating profit, no borrowing above 20,000 and at most three buses. A scripted baseline established feasibility separately. It is not used as Claude footage.

## Narration-driven cameras

Edit narration-cameras.json to choose a primary subject and optional top-right detail inset for each recorded spoken action. Subjects use actual town, stop or bus IDs, or a recorded construction position. The renderer updates their positions and queue/load counts from each synchronized capture. narration-camera-audit.json records the mapping.

Camera-only updates with unchanged audio/timing can use `node production/episode-007/prepare.mjs --with-audio --refresh-render`. This reuses the validated Motion Canvas master’s unchanged cards, fades and audio. It refuses timeline, composition, soundtrack or boundary-image changes; use `--render` for a full Motion Canvas export after those edits. Raw captures and the completed first master remain preserved.
