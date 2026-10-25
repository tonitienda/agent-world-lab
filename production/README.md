# Emergent episode composer — prototype v1

This is a **separate production package**, not part of the Minecraft simulation or video recorder.

## Workflow

1. Record a session with `events.json`, `agent-pov.mp4` and `observer.mp4`.
2. From repo root: `npm run episode:plan -- /absolute/path/to/session`.
3. This copies video files into `production/public/media/`, writes `production/generated/edit-plan.json` and individual narration text files.
4. `cd production && npm install && npm run dev`; open the Motion Canvas editor to preview, inspect, and render the montage. Install an exporter if needed for final video, e.g. `@motion-canvas/ffmpeg` and enable it in Vite configuration. See Motion Canvas rendering documentation.
5. Edit the generated plan, then preview again. Generate **one MP3 per narration text file** in ElevenLabs and keep filenames matching the manifest. Narration audio placement and music mixing are **not implemented in this PR**.

The current scene supports `full`, `pip`, and `split` shots, fade transitions, and common intro/outro cards. All cameras are referenced by ID rather than hard-coded to two streams, allowing new cameras in future manifests.

## Limitations and caveats

- The edit-plan generator uses simple rules; it does **not** infer model intentions. Its commentary is deliberately generic and must be reviewed for factual accuracy.
- **Synchronization is approximate**: the two cameras start sequentially and metadata currently lacks reliable per-stream media-zero timestamps. The `offsetSeconds` is reserved in the plan, not yet applied. Do not use simultaneous multi-agent scenes to claim frame-accurate timing.
- The timeline treats source times as seconds into the recorded MP4; event timestamps from `events.json` are only approximate relative to capture start. Visual review is mandatory.
- The current Moton Canvas scene is a prototype **not verified by CI**. Use the editor to inspect layouts and video playback before publishing.
- Scene rendering and audio assembly remain manual. The planner does not call ElevenLabs or access keys; video files in `production/public/media` are local working files and should not be committed.
- Retain the unedited experiment footage alongside any edited output.

## Example edit plan excerpt

```json
{
  "kind": "shot",
  "duration": 5,
  "shot": {
    "kind": "pip",
    "cameras": ["agent-pov", "observer"],
    "start": 10,
    "duration": 5,
    "label": "mine"
  }
}
```

For experiments with multiple agents, register extra cameras under `cameras` and refer to any two in a split layout. More complex multi-view grids will be added after visual verification.
