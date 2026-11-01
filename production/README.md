# The Agent Terrarium episode production

New automatic drafts default to **3840×2160 at 60 fps**, independent of the agent
provider. Their edit plans include `"fps":60` and
`"resolution":{"width":3840,"height":2160}`. Existing v2 plans retain their saved
frame rate; plans without a resolution retain 1920×1080 output. The renderer uses
the same logical layout at twice the pixel density for 4K, and validates the final
MP4 against the plan's dimensions and frame rate. Lower-resolution or lower-frame-
rate existing footage cannot gain genuine detail or motion by exporting at 4K/60.
For a manual editor export of a 4K plan, use the 1920×1080 logical scene size at
200% resolution scale and 60 fps. The guided CLI sets these values automatically.

For the complete editorial workflow and learned preferences, use [The Agent Terrarium production skill](../skills/emergence-episode-production/SKILL.md). It preserves the original brief and later steering. This README describes the current pipeline.

The Motion Canvas scene, editor and headless MP4 exporter read the same manually editable episode timeline. The simple renderer remains a separate legacy command.

From the repository root:

```sh
npm run episode:validate
npm run episode:render
npm run episode:check-render
cd production && npm run dev
```

Use `npm run episode:render -- --preview-check` for an editor smoke check without exporting. Unmute the editor speaker control when reviewing speech.

The MP4 is written to `production/output/<episode>.mp4`. Run commands with `EPISODE_ID=episode-002` to select another episode. Required dependencies are Node 22+, the root and production npm packages, FFmpeg/ffprobe, and Playwright with Chromium. The render command uses the existing recorder's Playwright installation if a production-local installation is unavailable. It never starts Minecraft. To install the standalone browser dependency if needed: `cd production && npm install --save-dev playwright && npx playwright install chromium`.

Frame export uses sequential PNG byte uploads, waits for FFmpeg backpressure, and
consumes every HTTP response. Avoid Blob-backed frame requests: long Chromium
exports can exhaust Blob storage (`ERR_BLOB_OUT_OF_MEMORY`). The PNG data URL is
decoded to bytes for transport; this retains lossless frames and the plan's output
format. After an interrupted export, rerun the same render command from the start.
The isolated browser/FFmpeg regression is
`node --test production/tools/test-exporter.mjs` (6,000 frames plus a 4K check).
The render CLI explicitly prebundles its Motion Canvas dependencies and disables
late dependency discovery and HMR so Vite cannot reload an active export. Normal
editor preview retains its interactive reload behavior. Check startup with an
empty dependency cache using
`node --test production/tools/test-render-startup.mjs`.

The shared scene uses `EpisodeVideo` to unload retired camera players after a
transition. Keep this cleanup when changing cuts: Motion Canvas's stock video
pool retains players after their nodes leave the scene. The startup regression
also renders 9,060 frames through 60 full/PIP/split cuts and checks that no more
than four video players are active.

The CLI prints a render heartbeat every 15 seconds. Video loading/seeking and
FFmpeg input backpressure have 30-second timeouts; frame requests and the Node
progress watchdog have 120-second timeouts. A stalled render reports its frame
and available media state rather than waiting indefinitely. Error-path checks:
`node --test production/tools/test-render-watchdog.mjs production/tools/test-encoder-drain.mjs`
and `node --import tsx --test tests/media-wait.test.ts`.

Vite validates and assembles audio before starting. Open its local URL to review the timeline with synchronized sound. Choose **The Agent Terrarium MP4** in Render Settings and match the edit plan's frame rate and resolution (the original Episode 001 edit uses 25 fps and 1080p). The CLI invokes Motion Canvas's `Renderer` with the same scene, camera layouts, titles and transitions; FFmpeg receives the rendered PNG frames and muxes the soundtrack. There is no single-camera substitution. An incomplete export never replaces the completed MP4.

## Editing an episode

### Opening objective and scenario background

The opening shows The Agent Terrarium title plus a short objective excerpt, over
a darkened frame from the initial recorded scenario. Keep only the situation,
destination and freedom to choose a strategy; leave detailed coordinates,
resource lists and tool instructions in the recorded goal metadata. The shared
scene reserves separate title/body space and uses smaller, wrapped body text.
New extraction uses the same short excerpt for opening narration; changing the
screen text of an existing edit does not modify its original voice clip.

An intro can set `background: {"camera":"observer","time":0.25}`. Time is in the
common source clock, with the camera's signed offset applied. The frame is held
behind the dark overlay. Validation rejects missing cameras and invalid source
times. Prefer an initial observer frame that communicates the challenge without
showing a later result. Review readability in the actual preview/export.

### Keep gameplay visible

During the main narration, show the recorded Minecraft world. Do not replace
individual intentions with full-screen text/branded cards. Brief intentional
opening/ending titles are separate choices. Preserve complete voice clips.

First select earlier or longer appropriate footage. If speech still needs time,
the user authorizes deliberate holds or slower playback. Hold at the relevant
moment, change between synchronized cameras, or use a restrained crop/pan/zoom
within recorded frames, then resume the action. Preserve chronology, keep the
character/action readable, and avoid looping actions or implying that editorial
camera movement happened in the world. Planning speech should lead its action;
observations/results should follow their evidence.

Current v2 shots support `hold`, an initial frozen source frame before normal
playback resumes. The helper uses holds when speech outruns source coverage and
delays game audio until the picture resumes. Slower playback is not yet supported;
adding it requires shared schema, renderer, validator and audio support. Track
output duration separately from consumed source time and preserve signed camera
offsets. Narration cards in older drafts remain unfinished editorial work.
See the [production playbook](../skills/emergence-episode-production/references/production-playbook.md#gameplay-during-narration-and-intentional-retiming).

### Iterate after generation

Use the generated production ID, for example `episode-002-claude-006`, rather than
assuming it equals the scenario's ID. Edit its existing `edit-plan.json` in place
and keep the editorial report current. The guided runner preserves manual v2 edits.
Do not regenerate the episode, overwrite it with `episode:plan --force`, or create
another take merely to revise narration timing or camera cuts.

```sh
# From the repository root; substitute the actual production ID.
EPISODE_ID=episode-002-claude-006 npm --prefix production run dev
EPISODE_ID=episode-002-claude-006 npm run episode:validate
EPISODE_ID=episode-002-claude-006 npm run episode:render
EPISODE_ID=episode-002-claude-006 npm run episode:check-render
```

Restart the preview after JSON/audio changes and play/unmute the affected passages.
In the guided edit preview, `r` refreshes/revalidates after edits and `q` preserves
the project for later. Review all replacement holds, camera cuts and resumed actions
in the encoded output; record intentional time edits in `editorial-report.md`.
Documentation-only changes do not require a render.

Inputs:

- `production/<episode>/edit-plan.json`: v2 editorial source of truth.
- `production/<episode>/narration-manifest.json`: original narration text, event references and exact WAV filename catalogue. Legacy `segmentIndex` is ignored by this pipeline.
- `production/public/<episode>/audio/<line>_Chapter_1.wav`: untouched original voice clips.
- `production/public/<episode>/video/<camera>.mp4`: untouched recordings.
- Local log and metadata: `data/<episode>/` or `data/mcp-sessions/<episode>/`. The validator does not require logs for subsequent rerenders; they inform the editorial review.

The old `episode:plan` command produces a **v1 editorial draft**, not a finished episode. Review the full log and footage, select clips, then author v2. Set fps, camera offsets and explicit narration references. Use the episode-001 project/scene wrappers as a model for a new episode; update their episode ID. The shared scene, soundtrack builder, validator and exporter require no changes.

```json
{
  "version": 2,
  "fps": 25,
  "cameras": [
    {"id": "agent-pov", "file": "agent-pov.mp4", "offsetSeconds": 0},
    {"id": "observer", "file": "observer.mp4", "offsetSeconds": -3.318}
  ],
  "segments": [{
    "id": "first-step", "kind": "shot", "duration": 7, "transition": 0.2,
    "narration": [{"line": 33, "audio": "33_Chapter_1.wav", "at": 0.35}],
    "shot": {"kind": "full", "cameras": ["agent-pov"], "start": 264, "duration": 7,
      "label": "The bottom step"}
  }]
}
```

`shot.start` is in the common capture timebase, not session elapsed time. Each selected source starts at `shot.start + camera.offsetSeconds`. Derive offsets from captureOpenedAt metadata and verify with visible changes; do not imply greater precision than the recorder supports. Full uses one camera; PIP and split use two. PIP's first camera is full size. Split fits each view without distortion. Intro/outro cards use `text` in place of `shot`.

### Background music

A plan may add a quiet music bed. The file lives in `production/public/<episode>/music/`
(like audio, it is committed alongside the episode). The track loops to cover the episode,
fades in and out, and dips under narration (a sidechain compressor keyed on the voices)
unless `duck` is `false`. `volume` defaults to 0.12, `fadeIn` to 2 s and `fadeOut` to 4 s;
`start` skips into the track.

```json
"music": {
  "file": "clean-soul.mp3", "volume": 0.12,
  "attribution": {
    "title": "Clean Soul", "artist": "Kevin MacLeod",
    "source": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300033",
    "license": "Creative Commons: By Attribution 4.0 License",
    "licenseUrl": "http://creativecommons.org/licenses/by/4.0/",
    "text": "\"Clean Soul\" Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/"
  }
}
```

Validation refuses music without an attribution `title`, `artist` and `text`. Copy `text`
verbatim from the licensor (incompetech's "Attribution Code"). `episode:validate` writes the
credits to `validation.json` (`credits`), and `credits(plan)` in `tools/pipeline.mjs` returns
them for the video description.

All segment durations must be integral frame counts. A dissolve consumes the first `transition` seconds of the incoming segment; it never shifts narration or adds time. Narration `at` is segment-relative. Every selected clip must fit, including 0.3 seconds at the end, and start at least 0.25 seconds after a previous clip ends. Clips must follow manifest line order. Missing assets, duration overruns and invalid camera bounds fail before rendering.

After timeline or source changes, restart Vite or rerun the CLI. It automatically rebuilds the derived soundtrack; unchanged inputs reuse the cached mix. Do not edit the JSON while an export is running. `public/<episode>/generated/` and `output/` contain derived local media, not source assets. `validation.json` records measured durations and the absolute audio schedule. Original audio/video files are never renamed or replaced.

No music is synthesized or fetched. If original cameras contain sound, only the primary contributes at reduced gain under the normalized voice track. Episode 001 has no source audio streams. Capture defects and timing precision are documented in its editorial report.

New recorder sessions also include `follow.mp4`. The planner registers all three cameras,
uses follow for movement and POV for interactions, and preserves the agent's intention
narration. Full, PIP, and split shots may select follow just like any other source; PIP
and split still show two sources at a time. Legacy two-camera sessions remain supported.
Optically aligned MP4s share `metadata.startedAt` and have zero relative offsets;
raw WebMs require their recorded `rawTrimSeconds` before using that timeline.

Review all three angles: observer for geography, construction and progress, POV
for hand-level detail, follow for movement. Include meaningful observer coverage
and selective PIP/split combinations where they clarify the same event. Keep inset
views readable and synchronized; document unusable or deliberately omitted angles.
The automatic helper selects observer establishment, construction/mixed-beat PIP
and an ending split when suitable cameras exist; inspect the footage before
accepting those draft choices.

## Guided drafting and review

`./pipeline.sh --design codex --player claude episodes/<id>/episode.yaml` runs the
[guided workflow](../docs/guided-pipeline.md), including scenario observation,
recording, extraction, a pause for complete narration WAVs, and a browser edit
preview before export. You can resume at the audio/edit stage with the same command.

Its `automatic-edit.mjs` authoring helper measures actual audio/camera lengths,
preserves the v1 source draft, and writes a valid v2 draft for human review. It
keeps all voices whole and ordered. Insufficient continuous footage is covered by
an initial real-frame hold, reported in `automatic-edit-report.md`, rather than a
full-screen narration card. The helper does not implement slow playback. Manually edited v2 plans
are preserved. Preview and final export continue to use the shared scene, audio
builder and renderer documented above.
