# Episode 007 — editorial report

Source: data/openttd-sessions/episode-007-claude-take-1. Claude Opus 5.5 played through restricted MCP tools. The scripted feasibility run is excluded from episode footage.

Measured result: 220 delivered passengers after 104 days; cash 5627; combined bus operating profit 1710; objective achieved.

16 narration clips: 12 recorded public AGENT statements and 4 editorial PRESENTER lines. No private thinking blocks or fabricated agent speech are used.

The cut follows every captured action and operating day chronologically. Short routine tool captures are compressed; whole selected narration clips are retained. Plans start over their real pre-action capture, normally at least two seconds before the recorded action result. Observations and the ending use state captured after the evidence exists.

The camera director uses construction sites, measured passenger queues, vehicle load changes, actual operating income/deliveries and bus-follow views. Close-ups include a map inset. Buildings are transparent only in the observer render. Cameras are crops of one isometric world capture, not physically separate 3D views.

Gameplay is daily sampled time-lapse with intentional paused construction/decision holds. Export is 3840×2160 at 60 fps; daily samples do not acquire continuous motion or additional sprite detail. No game audio was captured. The existing licensed Clean Soul music bed is ducked under the complete ElevenLabs voice clips.

Both preview and final export use the shared Motion Canvas scene, edit plan and mixed soundtrack. Source PNGs, action logs and voice files are preserved. camera-plan.json and narration-timing.json describe the derived camera cut and voice-to-action mapping.

Agent events omitted from speech: none. Omitted speech is not rewritten or reassigned.

Validation: run the shared episode validator, production type check, export checker, full decode and sample opening, construction, queue, boarding, delivery and ending frames. Frame samples and volume measurements are not a claim of a full perceptual watch/listen.

## Narration-led camera revision

All 12 recorded Claude utterances have explicit subjects in narration-cameras.json, with station/bus IDs verified against the captures. A north-stop reference shows the north stop even when another queue is larger. Both-stop commentary shows the north stop with a synchronized south-stop detail inset. The third-bus decision shows the depot with the actual south-stop queue (124 waiting at its start) in the top-right. Cash/fleet commentary uses a network view and the measured financial HUD. Original speech, audio and game chronology are unchanged.

The completed first Motion Canvas master is preserved in the take’s first-master directory. This picture-only revision reuses its unchanged opening, ending, transitions and original audio stream, replacing the interior of the one untransformed full-frame gameplay source. An incremental eligibility check verifies identical timeline, narration, mixed soundtrack, composition and boundary images. camera-refresh.json records exact frames and provenance. The same updated directed.mp4 is used by the functional Motion Canvas preview.

## Completed verification

Root and production type checks pass; 204 repository tests pass. The final 3840×2160/60fps export is 170.466667 seconds and 10,228 frames. Full decoding found no black intervals, and all 16 narration windows contain audio. The updated Motion Canvas preview opens with its canvas and soundtrack, without page errors. The audio packet stream is bit-identical to the first master. Seven encoded frames were visually reviewed: opening, depot correction, both queues, the third-bus/south-stop inset, cash recovery, verified result and ending. This is sampled visual review and automated audio validation, not a full real-time watch/listen. See quality-review.json and render-validation.json.
