# Emergence episode production

For the complete editorial workflow and learned preferences, use [the Emergence production skill](../skills/emergence-episode-production/SKILL.md). It preserves the original brief and later steering. This README describes the current pipeline.

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

Vite validates and assembles audio before starting. Open its local URL to review the timeline with synchronized sound. Choose **Emergence MP4** in Render Settings, 25 fps for this edit, to export directly from the editor. The CLI invokes Motion Canvas's `Renderer` with the same scene, camera layouts, titles and transitions; FFmpeg receives the rendered PNG frames and muxes the soundtrack. There is no single-camera substitution. An incomplete export never replaces the completed MP4.

## Editing an episode

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

All segment durations must be integral frame counts. A dissolve consumes the first `transition` seconds of the incoming segment; it never shifts narration or adds time. Narration `at` is segment-relative. Every selected clip must fit, including 0.3 seconds at the end, and start at least 0.25 seconds after a previous clip ends. Clips must follow manifest line order. Missing assets, duration overruns and invalid camera bounds fail before rendering.

After timeline or source changes, restart Vite or rerun the CLI. It automatically rebuilds the derived soundtrack; unchanged inputs reuse the cached mix. Do not edit the JSON while an export is running. `public/<episode>/generated/` and `output/` contain derived local media, not source assets. `validation.json` records measured durations and the absolute audio schedule. Original audio/video files are never renamed or replaced.

No music is synthesized or fetched. If original cameras contain sound, only the primary contributes at reduced gain under the normalized voice track. Episode 001 has no source audio streams. Capture defects and timing precision are documented in its editorial report.

New recorder sessions also include `follow.mp4`. The planner registers all three cameras,
uses follow for movement and POV for interactions, and preserves the agent's intention
narration. Full, PIP, and split shots may select follow just like any other source; PIP
and split still show two sources at a time. Legacy two-camera sessions remain supported.
Optically aligned MP4s share `metadata.startedAt` and have zero relative offsets;
raw WebMs require their recorded `rawTrimSeconds` before using that timeline.
