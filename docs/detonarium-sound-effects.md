# Detonarium sound effects

Implemented as an original procedural arcade sound set, a replay-event cue planner,
and an optional effects bus in the shared production soundtrack. No downloaded
samples, paid services or music are used. Bot logic and gameplay rules are unchanged.

## Sounds and synchronization

Seven cues: placement, explosion, elimination, pickup, collapse, slow-motion entry
and slow-motion release. Sound design lives in `src/detonarium/sfx.ts`; the small
WAV previews and provenance manifest live in `production/public/detonarium-sfx/`.
The WAVs are generated from that code, not independently editable source recordings.

The recorder feeds its exact fractional-tick/frame clock to the planner. Sounds
start at the first visible placement/blast/death/pickup frame; the collapse thud
waits until the block is nearly on the floor (98% of its tick animation). It does
not use `event tick / tps`. Holds never replay the same event. Near-simultaneous
same-type events share one controlled cue while retaining all event IDs. Death
remains a separate cue even when its explosion is grouped.

Slow-motion whooshes follow playback-rate changes with hysteresis, a short dwell
and a cooldown. Short holds don't create entry/release pairs. No ticking loop
continues during pauses. Effect transients keep their natural sound duration;
narration is never slowed or pitch-shifted.

The renderer writes `.timing.json` with per-frame cue times, source event IDs,
replay hash, speech anchors and a hash of the complete fractional source clock.
`--timing-only` computes this without rasterizing frames. The SFX builder verifies
that its clock matches the recorded cut before creating the effects stem. Older
cuts without a clock hash are checked against frame count, FPS and every saved
speech anchor. A mismatch fails and requires rebuilding the board; it isn't guessed.

## Use in a new production

In the production take's `source.json`, set:

```json
"soundEffects": true
```

Then build with measured narration:

```sh
node --import tsx scripts/detonarium-episode.ts --episode <episode-id> --audio-dir production/public/<episode-id>/audio
EPISODE_ID=<episode-id> npm run episode:validate
EPISODE_ID=<episode-id> npm run episode:render
EPISODE_ID=<episode-id> npm run episode:check-render
```

The episode builder regenerates game/card timing and invokes
`scripts/detonarium-sfx.ts`. Replacing a voice file and rebuilding moves the sounds
with the new visible timing. The resulting edit plan includes:

```json
"effects": {"file": "detonarium-effects.wav", "volume": 1, "duck": true}
```

The effects stem is in `public/<episode-id>/effects/`. Its duration must match the
complete edited timeline. `generated/sound-effects-cues.json` is the inspectable
cue sheet (kind, game, source tick/event IDs, video frame/time and gain). The shared
soundtrack pipeline mixes this stem, ducks effects beneath the narration bus,
limits the final mix and fingerprints the effects asset for cache invalidation.
The editor preview and Motion Canvas export use the same soundtrack.

## Separate audio-only review of an existing render

To preserve a published edit, create a fresh review ID:

```sh
node --import tsx scripts/detonarium-sfx.ts --episode episode-004-sfx-review --review-of episode-004-take-2
```

The destination must not exist. The command copies the production metadata and
source audio/video, reconstructs the exact clock from each saved game cut, generates
the effects/mix, and remuxes the existing Motion Canvas picture stream into the new
review MP4. It does not rerender or modify the published pictures, source WAVs or
original edit. This is an audio-only revision of an already-rendered MC scene.
Video format, frame count and duration must match before the remux is accepted.

To adjust sound design or gains afterward, edit the generator or effect bus volume
and rebuild with `--episode <review-id>`. A project with `reviewOf` metadata also
remuxes the original completed MC pictures after validating the timeline. A normal
production without that metadata uses the shared MC export.
A full project rebuild is needed when voice lengths or game timing change.

## Verification

Tests cover hold deduplication, changed-narration retiming, grouped chains with
provenance, separate deaths, slow-motion transitions, bounded deterministic WAV
synthesis, overlap headroom, missing/mismatched effect assets, narration-bus
preservation, ducking and soundtrack-cache invalidation. Existing music behavior
is also regression-tested.

Automated levels and cue checks do not replace a listening review. The first sound
pass is deliberately a separate review: listen to explosion/voice balance, death
legibility, collapse impact timing and transition whooshes before adopting its mix
for the next published episode. The supplied review's original pictures are compared
at the compressed-video packet level to confirm this pass only changed audio.
