# Episode 001: decisions and steering that shaped this workflow

This is a reference case, not the objective, duration, offsets or story to impose on future episodes. The current episode report and JSON files in the repository contain the detailed evidence.

## Original assignment

Produce a complete, watchable episode from existing Minecraft recordings, the entire event log and already-generated ElevenLabs WAVs. Own editorial and technical decisions. Use the actual Motion Canvas project for both preview and MP4 export; no new experiment, source-media regeneration or silent single-camera fallback. Deliver an editable timeline, report, functional project, rendered MP4 and meaningful tests.

The complete user-supplied assignment is preserved in [original-brief.md](original-brief.md). Later corrections below supersede its possible opening-hook suggestion and any incorrect narration in the initial assets.

## What the experiment established

The agent mined dirt, initially failed to collect the dropped item by walking nearby, entered the hole and verified pickup, gathered more material, built stairs and an elevated 3×3 floor, then climbed onto it. One spare-block mining request failed as out of reach. All 14 placements succeeded. Inventory checks and observed positions, not intentions or completion chat alone, established the outcome.

The generic opening initially said the goal was exploration and collection and named Claude. The user corrected it to:

> We challenged an AI agent to build a three-by-three platform, three blocks above the ground, and climb onto it.

Do not reuse the earlier goal or infer model identity from that old generated sentence.

## Explicit user steering

1. The user supplied a replacement `1_Chapter_1.wav` and changed line 1 of `narration.txt`. The manifest was reconciled to that supplied text. The replacement measured 7.314286 seconds; the 8.60-second title card still accommodated it. Future replacements may be longer and must be measured again.
2. Start directly on the title while narrating the goal. Remove the three-second teaser of the eventual result. The opening narration starts 0.35 seconds into the title; the payoff is revealed later.
3. Hear the agent's plan before the character starts the corresponding action. Earlier continuous footage created roughly two-second leads for individual actions and approximately 0.8-second minimum leads within the rapid paired placement narrations. Earlier narration in those paired segments can begin around 5.7 seconds before the burst. These values were tuned for this recording, not specified as universal delays.
4. Keep full voice clips, correct synchronization and the rest of the story while making these revisions. No words or original camera files were changed, and no freeze frames were inserted.

## Technical and editorial lessons

- The original generated plan used only the early intentions and stopped before construction/climbing. Reviewing the complete 194-event log was essential.
- Events live at `data/mcp-sessions/episode-001/`, not the originally suggested shorter path.
- Common capture origin: `2026-10-26T16:57:30.173Z`. POV offset 0; observer offset -3.318 seconds. This is approximate capture alignment, not certified frame accuracy.
- Observer footage is wide; POV helps with close interaction. Magenta dropped-item placeholders and terrain seams are capture defects, not evidence of new world behavior.
- Neither original MP4 has an audio stream. There was no Minecraft sound to retain, and no identified licensed music was added.
- Missing audio placement/export functionality was implemented in the shared Motion Canvas pipeline. Later revisions only needed editorial JSON changes and validation updates.
- Earlier footage must retain the action's completion and preserve camera offsets. Do not just advance all voices, which can overlap speech or announce observations before they occur.

## Reference result

At the time this skill was created: 19 segments, 21 whole narration clips, 163.92 seconds (2:43.92), 4,098 frames at 25 fps, 1920×1080 H.264 with AAC stereo. The output decoded completely, had no detected black intervals and audio in every selected narration window. Twenty tests and both TypeScript checks passed. Changed action leads were inspected in rendered mining, pickup and climb samples; this was sampled visual review plus automated media checks, not a claimed full perceptual watch/listen.

The current detailed files are `production/episode-001/edit-plan.json`, `editorial-report.md`, `narration-timing.json`, `validation.json` and `render-validation.json`. These values can change with later authorized edits.
