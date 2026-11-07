# Detonarium SFX review

This is a separate audio-only review of Episode 004 take 2. The published/original
`production/output/episode-004-take-2.mp4` is preserved. No games were rerun and no
new narration is needed. Copied narration files keep their exact contents and IDs.

- Quick sample: `production/output/detonarium-sfx-preview.mp4` (30 seconds).
- Full review: `production/output/episode-004-sfx-review.mp4` (4:23).
- Cue sheet: `production/public/episode-004-sfx-review/generated/sound-effects-cues.json`.
- Audit: `sound-effects-audit.json`; final stream checks: `render-validation.json`.
- Workflow and sound design: `docs/detonarium-sound-effects.md`.

The mix adds placement clicks, explosions, elimination tones, pickup chimes,
collapse impacts, and slow-motion entry/release whooshes. Closely timed same-type
blasts are grouped without discarding source-event identities. The effects bus is
lowered under narration; original voice audio is not pitch-shifted or sped up.

369 cues represent 435 source/event-transition identities. The completed review's
video packet SHA-256 matches the original MC render: the picture stream is unchanged.
Full decoding, frame count, dimensions and all 35 narration-window checks pass.
The mix measures -18.2 LUFS integrated and -1.5 dB true peak. All 181 tests and the
root/package and production TypeScript checks pass.

These are automated media/timing/signal checks and a first listening review asset,
not a claim of a full perceptual listening pass. Please audition explosion/voice
balance, collapse timing and whoosh strength before adopting the mix for publication.

To rebuild the effects and remux this review after sound/gain changes:

```sh
node --import tsx scripts/detonarium-sfx.ts --episode episode-004-sfx-review
EPISODE_ID=episode-004-sfx-review npm run episode:check-render
```

The rebuild uses the saved `reviewOf` source and verifies its timing before copying
pictures. If narration lengths or picture timing change, rebuild the board/project
and export through the shared MC pipeline instead of remuxing an old render.
