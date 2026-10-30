---
name: emergence-episode-production
description: Produce or revise The Agent Terrarium / agent-world-lab episodes from recorded Minecraft experiments using Motion Canvas, existing narration, and event logs. Use for editorial decisions, camera and narration timing, and MP4 delivery; not for running a new experiment or publishing a video.
---

# The Agent Terrarium episode production

Turn an existing experiment into a concise, coherent episode. Own both editorial judgment and implementation; an automatically generated montage is only a draft.

Locate the agent-world-lab repository and read its current `production/README.md`, episode JSON, scene, scripts and applicable repository instructions. This skill is project-specific; do not create or assume these paths in an unrelated repository.

Read [references/production-playbook.md](references/production-playbook.md) for the operational workflow, timing calculations and known integration pitfalls. For a new episode, consult [references/original-brief.md](references/original-brief.md) for the complete original production request, treating its episode ID and example narrative as episode-specific. For Episode 001 revisions or examples of the learned preferences, read [references/episode-001.md](references/episode-001.md). Current code/assets and newer user instructions take precedence over historical examples.

## Editorial preferences learned from the user

- **Start with the channel title and a short objective excerpt over a darkened scenario frame.** Keep only the situation, destination and freedom to choose a strategy; omit coordinates, resource catalogues and tool instructions. Reserve separate space for the title and a smaller, wrapped body. Reveal the result through the chronological story, without an unsolicited outcome teaser.
- Verify the experiment's prompt before describing its goal or identifying its model. An earlier generic exploration narration was wrong for Episode 001. When the user supplies corrected audio and text, use that replacement and reconcile the manifest.
- **Let viewers hear a plan before the character performs it.** Prefer earlier continuous source footage to artificial holds. About two seconds of lead is a useful starting point for individual actions; tune by listening and watching. Rapid placement bursts may need a different lead or shot structure. This is an editorial preference, not a fixed delay for every sentence.
- Separate planning speech from observations and outcome statements. Do not move an observation before the result it describes. Judge timing against the corresponding action, not just against the camera cut.
- Treat each replacement audio file as a new input: re-probe its actual duration and invalidate/rebuild derived audio. Never assume the new take matches the old duration or truncate speech to keep a previous cut length.
- **Keep gameplay visible during the episode's narration.** Do not replace agent commentary with full-screen text or branded cards such as “Another dirt block for my stairway.” Brief intentional opening/ending titles are separate editorial choices, not overflow containers for speech.
- When speech needs more time, first find earlier or longer appropriate footage. Intentional holds and slower playback are authorized: pause at the relevant moment, cut between synchronized cameras, or use restrained reframing to keep the visual alive. Preserve full speech, chronology and the distinction between editing and an agent action; do not loop actions or manufacture progress.
- Use **The Agent Terrarium** for visible channel branding. New episodes target 3840×2160 at 60 fps across providers. Preserve existing plans' formats unless a revision requests changing them; old footage does not acquire genuine detail or motion through export settings.

## Production invariants

Preserve original event logs and camera recordings. Do not rename, replace or regenerate source media, run Minecraft, reset the world, or call ElevenLabs as part of editing an already recorded episode. A user-supplied replacement recording is an authorized new source; preserve that file and update its text/manifest mapping without editing its spoken words.

Read the entire event log and distinguish intentions, attempted actions, tool responses and independently verified results. A successful mine does not prove pickup; a successful movement request does not prove the intended achievement. Keep meaningful mistakes and recovery. Cut repetition and long waits without inventing actions, dialogue or intelligence.

Use the existing Motion Canvas project and a human-editable declarative timeline. Preview and export must share the scene and audio schedule. Do not silently use the simplified single-camera renderer to bypass an integration issue, and do not regress its existing behavior.

Keep original narration clips whole, in semantic order, with exact filenames. Entire clips may be omitted. Measure WAV lengths with ffprobe, allow breathing room, and prevent overlap. Extend or select appropriate footage when speech needs time. No arbitrary segment-duration cap may truncate narration.

Iterate on the generated project in place: preserve manual v2 edits, inspect affected narration against the events/footage, update the timeline and report, restart the preview to refresh derived audio, then validate and render when an actual video revision is requested. Do not rerun the experiment or overwrite editorial work with `episode:plan --force`.

Current v2 shots support an initial `hold` before normal playback; slower playback is not yet implemented. Keep renderer, source-bound checks and audio schedule consistent when extending retiming. Do not add ignored fields or describe a proposed feature as working. Read the playbook's footage and retiming guidance before such an edit.

Derive camera alignment from actual recording metadata, apply the signed offset to every view, and inspect visible actions. Do not equate `startedAt`, page creation and media zero, or claim frame accuracy the recordings cannot support. Check all selected source intervals, including secondary cameras.

Use POV for close interaction, follow for character movement, and observer for geography, construction and overall progress. For usable three-camera recordings, include meaningful observer coverage and selective PIP/split combinations when they help relate hand actions to the wider scene. Do not let a full-screen-only edit ignore observer by default. Preserve aspect ratios, readable inset sizes and synchronization; omit an angle only for a documented footage/editorial reason. Keep transitions, readable titles and the ending restrained and observational.

Probe source audio streams. Retain useful Minecraft audio if present, mixing only one camera's audio for a simultaneous view. Add music only when a suitable licensed asset is already available; otherwise finish without it.

## Definition of done

Deliver the updated `production/<episode>/edit-plan.json`, factual `editorial-report.md`, functional Motion Canvas project, and `production/output/<episode>.mp4`. Keep transcript/manifest and any timing audit consistent with user corrections. Add or adjust meaningful tests for timing or integration changes.

Run relevant tests, both TypeScript checks when implementation changes, asset/timeline validation, render validation, and visual inspection of the encoded output. Check speech onset → action → completion samples when changing narration lead. Decode/audio checks complement visual review; do not describe sampled frames or level checks as a full perceptual watch/listen.

Do not stop after a plan. Complete the requested edit and render when the local environment permits it. For a genuine blocker, finish unaffected work, identify the exact failed dependency/operation, and give the command needed to finish. Do not rerender merely to create or edit documentation.

Report the final MP4 path, duration, checks and material remaining recording limitations. This skill does not authorize uploading, publishing, messaging others or starting another experiment.
