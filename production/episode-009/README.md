# Forest to Market

The selected source is the solo Claude Opus 5.5 take in `source.json`.
The clean feasibility run was separate. The take recovered from disconnected
road joins and completed all conditions on day 199.

```sh
node production/episode-009/run.mjs
```

The runner resumes production from the preserved take. If the selected take
does not exist, it first requires a matching successful clean calibration.
Use `--take-only` to stop after the recording and review public commentary.
Use `--finalize-only` to validate and mux the already composed video and audio.

`editorial-selection.json` selects public commentary by action ID. The
narration manifest and timing record retain the exact audio filenames. The
camera plan identifies each native saved checkpoint and crop. The cash audit
records the actual income interval and the time of its chime.

The native still compositor renders OpenGFX2 Classic views with cropped game
footage and a cargo HUD. FFmpeg assembles the visual beats at 4K and 60 fps.
The shared episode pipeline validates and mixes narration, the music bed and
delivery chimes. Motion Canvas reads the same directed footage and mix for
preview. The video uses sampled time-lapse footage.

## Design comparison

Run `node --import tsx scripts/openttd-hud-comparison.ts` for a separate
`episode-009-design-comparison.mp4` export. It uses the floating cards,
supply-chain meters and cash history from the [Claude Design reference](https://claude.ai/artifact/SdRVUsNCVn9niVGPvBvREH#page-dcb81aee8d83).
The data comes from the recorded run, and the script checks the original frame
count, resolution, frame rate and encoded audio. For the full design, run:

```sh
node --import tsx scripts/openttd-hud-comparison.ts --skin packages/openttd/graphics/terrarium_skin.grf
```

This produces `episode-009-modern-skin.mp4`. OpenTTD draws the supplied static
NewGRF over OpenGFX2 Classic using the 32bpp blitter and the same saved checkpoints.

### Intro and end screen

After exporting the modern skin cut, run
`node --import tsx scripts/openttd-modern-splashes.ts`. It saves the source
as `episode-009-modern-skin-pre-splash.mp4` and replaces the modern skin cut
after validating the export. If you rebuild the source cut, move the saved
copy aside before applying the cards again.

The intro runs from 0:00 to 0:05. The end screen runs from **3:25.250 to
3:45.250**, with the presenter's thank-you followed by music. Existing
chapter times still apply. In YouTube Studio, use the
[placement guide](../templates/end-screen-guides.svg) to add two suggested
videos and a subscribe element at the start of the end screen.
