# Recorded-episode production playbook

## Find the real inputs

Inspect the repository first; paths and scripts can evolve. Current layout:

| Input or output | Location |
| --- | --- |
| Events and capture metadata | `data/<episode>/` or `data/mcp-sessions/<episode>/` |
| Existing episode project and editorial files | `production/<episode>/` |
| Original camera MP4s | `production/public/<episode>/video/` |
| Original narration WAVs | `production/public/<episode>/audio/` |
| Derived soundtrack/cache | `production/public/<episode>/generated/` |
| Finished MP4 | `production/output/<episode>.mp4` |

Local event logs need not be committed to Git. Inspect existing work before modifying it. Never regenerate the experiment to recover missing editorial context. If the exact external goal is unavailable, do not infer it solely from an intention or an old generic narration; ask for the missing goal while continuing independent inspection.

The older `docs/episode-production-workflow.md` contains historical recording/rerun instructions, old generated paths and manual-audio guidance. It is not the post-production authority. Do not execute world-reset or recording commands while producing an existing episode.

## Reconstruct and select

Read all events, including the ending. Build a chronology with objective, initial plan, attempted actions, failures, observations, strategy changes, intermediate results and final verification. Use event indexes and source-clock timestamps as evidence. Reported intentions are deliberately public agent commentary, not hidden reasoning.

Inspect both recordings across their full span, then denser samples around candidate moments. Establish what the cameras actually show. Select a concise arc: title/verified goal, useful early interaction, a meaningful difficulty and recovery, progress, payoff and short viewer invitation. This is a flexible shape, not a requirement to manufacture those beats in every run. Avoid long repeated digging, walking and idle tool waits. Do not expose the payoff in an unsolicited opening teaser.

Write concrete editorial choices and limitations, then implement the selected edit. Keep the report current after revisions, including source/audio mappings and any timing uncertainty.

## Declarative timeline and source clock

The current renderer consumes v2 plans. `episode:plan` generates a v1 draft: review and author v2 before using the current production pipeline. Do not run it with `--force` over a reviewed episode merely to make a small revision.

Core fields:

- Plan: `version: 2`, integral `fps`, `cameras`, `segments`.
- Camera: `id`, original `file`, signed `offsetSeconds`.
- Segment: stable `id`, `kind` (`intro`, `shot`, `outro`), `duration`, optional `transition`, `narration`.
- Narration: `line`, exact `audio`, segment-relative `at`.
- Shot: `kind` (`full`, `pip`, `split`), `cameras`, common-clock `start`, matching `duration`, optional factual `label`.

```text
common origin = earliest relevant camera captureOpenedAt
camera offset = (common origin - that camera captureOpenedAt) / 1000
camera media time = shot.start + camera offset
```

Use metadata that actually exists; the formula does not establish exact media zero when capture starts after page creation. Confirm alignment with visible inventory changes, block placement and movement. Never copy Episode 001's offsets into another recording.

Full uses one camera; PIP and split use two. PIP's first camera is the main view. Fit split images without stretching. Bounds validation must cover every selected camera, from its signed source start through the segment's full duration. Keep anticipation footage and the action's completion in range. Avoid replaying meaningful actions across overlapping cuts without an editorial reason.

## Speech duration and anticipation

The manifest maps text/event references to exact filenames such as `1_Chapter_1.wav`, `10_Chapter_1.wav`. Never infer mapping by lexicographic directory order or renumber selected clips. The current pipeline ignores the old manifest's generated `segmentIndex`; the v2 segment's `narration` array schedules audio.

Probe each selected file, including user replacements. Keep all spoken words in a selected clip. Current validator rules:

- Narration starts at least 0.25 s into its segment; a typical offset is 0.35 s.
- Allow at least 0.25 s between clips and 0.30 s after speech; Episode 001 uses 0.40 s between its paired clips.
- Segment duration covers the latest `voice.at + measured WAV duration + trailing room`, rounded upward to a whole frame.
- Clips follow manifest line order and never overlap.

These are the current implementation's constraints, not a reason to force every episode into Episode 001's durations. If an authorized edit needs a different audio arrangement, fix and test the shared integration rather than silently truncating clips.

For planning narration, locate the corresponding `mine_start`, `move_to_start` or `place_start` after the intention. Compare the intended on-screen action to the recorded footage as well as the log:

```text
speech onset in source clock = shot.start + voice.at
planning lead = source action time - speech onset in source clock
latest shot.start for a desired lead = source action time - voice.at - desired lead
```

Selecting an earlier `shot.start` makes the action occur later in the segment, giving the narration a natural lead. Apply the same start to both cameras through their existing offsets. For several utterances in one burst, satisfy each utterance's cue; changing only the first clip can leave later plans behind their actions. Tune the lead so the edit still feels alive. If a shot becomes too idle or loses the completion, restructure the edit, use appropriate continuous coverage, or adjust its duration. Do not fabricate a pause by freezing the actor.

Observations and verified success claims usually belong after the result. Do not apply a blanket advance to every narration. Preserve semantic order and check for newly exposed action replays at adjacent cuts.

Episode 001's `narration-timing.json` is a useful audit format: narration line, segment, action/event index, common-clock action timestamp, source start, output narration/action times and actual/target lead. Use episode-specific values; do not turn its 2.0/0.8-second targets into universal constants.

When the user changes a source WAV, re-probe it, reconcile supplied transcript and manifest, rebuild derived audio and rerender. Do not reuse an old duration or stale mix. Preserve the replacement source file.

## Current implementation and lessons

Read these files before modifying integration:

| File | Responsibility |
| --- | --- |
| `production/src/timeline.ts` | Shared plan types and signed source-time calculation |
| `production/src/scenes/episode.tsx` | Video layouts, scene-clock video time, cards and transitions |
| `production/<episode>/project.ts` | Episode wrapper, shared exporter, derived project audio |
| `production/tools/pipeline.mjs` | ffprobe, validation, soundtrack, cache fingerprint |
| `production/src/exporter.ts` | Motion Canvas PNG-frame exporter |
| `production/tools/encoder.mjs` | Local frame receiver, FFmpeg encoding and final mux |
| `production/src/render-client.ts` | Actual Motion Canvas Renderer invocation |
| `production/tools/episode.mjs` | Prepare/render/editor-smoke CLI |
| `production/tools/check-render.mjs` | Encoded-stream, frame count, decode, black and narration-window checks |

Preview and final mux use the same derived soundtrack. The current mix normalizes whole narration clips toward -18 LUFS/-2 dBTP, then limits the mix; measure the result rather than assuming those targets are the actual output. Only the primary camera supplies game audio when available. Missing files fail visibly. A completed MP4 is replaced only after a successful export; partial output uses a `.rendering.mp4` suffix.

Known integration pitfalls from the initial implementation:

- Resolve the Vite project using the actual production directory. Relative resolution broke when the CLI ran from the repository root.
- Use Vite-resolved imports in the render client. Importing raw dependency paths caused module/export mismatches.
- Avoid calling video seek/play/pause paths that read media duration before metadata is ready. The scene now drives video `time` from the Motion Canvas scene clock; preserve deterministic preview/export behavior.
- The headless renderer uses `production/render.html` rather than starting the editor's extra player while exporting.
- An output needs actual Motion Canvas frames, not a silent switch to `episode:render-simple`. The simple renderer is a separate legacy tool; v1 compatibility and v2 narration mapping have regression coverage.
- Reopening/restarting Vite after JSON/audio changes is part of refreshing the preview. The derived-audio fingerprint includes the plan, manifest and source stat information. Do not modify these inputs during export.
- Local loopback/Chromium can require execution outside the sandbox. Use the permitted escalation mechanism when needed; do not claim an asset is missing because `listen` returned `EPERM`.

For another episode, inspect/copy only the thin episode wrapper pattern and update its ID/audio path. Shared scene/pipeline code should not need episode-specific rewrites. Generic export/check scripts support `EPISODE_ID`; some repository tests intentionally assert Episode 001's current editorial choices.

## Run and verify

From repository root, substituting the intended episode:

```sh
EPISODE_ID=episode-002 npm run episode:validate
EPISODE_ID=episode-002 npm run episode:render
EPISODE_ID=episode-002 npm run episode:check-render
EPISODE_ID=episode-002 npm run episode:render -- --preview-check
npm test
npm run check
npm --prefix production run check
git diff --check
```

For interactive review, run `EPISODE_ID=episode-002 npm run dev` from `production/`. Use the editor's play/unmute controls. Its Emergence MP4 exporter should agree with the CLI. Use the actual current scripts and dependencies; do not assume this example ID exists locally. Node 22+, root/production dependencies, FFmpeg/ffprobe and Playwright with Chromium are the current prerequisites; the CLI can use the recorder's existing Playwright installation.

Verify filename mapping, measured audio vs segment lengths, speech overlap, both camera offsets, all source bounds, missing-asset failures and v2 validity. For lead revisions, verify positive lead against the appropriate event and that the chosen coverage still includes completion. Add tests only for meaningful changed behavior.

After encoding, inspect title/ending, every changed layout, camera cuts and representative speech-onset → pre-action → completion samples. Decode the entire MP4 and confirm expected frames, duration and speech windows. Automated levels prove audio presence, not the spoken wording or perceptual synchronization; frame samples are not a claimed real-time full watch. State the limits of the review honestly.

Deliver the MP4, editable timeline, report and validation results. A genuine missing dependency should yield a precise blocker and exact finishing command, with all unaffected work completed. Do not rerender for documentation-only changes, run another experiment, or publish/upload as a side effect of this workflow.
