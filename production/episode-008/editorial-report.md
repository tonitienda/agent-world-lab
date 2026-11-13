# Detonarium · Ada, Bram & the Hunters

Episode 008 uses the fourth recorded take, a 15×15 free-for-all from seed 8. Ada played through Claude Sonnet 5.5 and Bram through the Codex CLI. Hunter 1 and Hunter 2 use the engine’s existing Hunter policy. The two model seats committed actions simultaneously from separate, equally redacted views. Each model could see its own upgrade totals and bomb range. The Hunter policy uses engine state, and the audience HUD shows all four players’ stats.

The first stone fell at tick 97 and the game ran for 228 ticks. The earlier two-player take ended at tick 39. This edit retains the four-player match in chronological order, with a base playback speed of four ticks per second and slower playback under narration and around key impacts.

## Cut

- The opening and victory screens use the supplied artboards with the recorded cast, arena size and result. The live board uses the design’s character sprites, palette, bomb badges, rounded tiles and player panels.
- Ada and Bram open with crate-clearing plans. Bram is eliminated by his own bomb at tick 10. Ada reacts after the blast.
- Ada and Hunter 1 exchange bombs in the northern corridors. Meanwhile, Hunter 2 collects six range upgrades by tick 91 and later reaches range nine.
- The first stone falls at tick 97. Hunter 2 survives until tick 195, when the collapse takes it out.
- Ada advances to the center and Hunter 1 is caught one tile away at tick 228. Both Hunter eliminations come from the collapse. Ada wins with zero credited knockouts.
- Elsa voices Ada, Larry voices Bram, and Bella voices the presenter. The recording sheet links each line to the exact source. The procedural sound cue sheet follows the retimed replay clock, with collapse elimination cues landing alongside their stones.

## Rebuild from the recorded take

The replay and calls are in `data/detonarium-sessions/episode-008/game-4/session`. From the repository root:

```sh
node production/episode-008/design.mjs production/episode-008/result-card.json
node --import tsx scripts/detonarium-episode.ts --episode episode-008 --audio-dir production/public/episode-008/audio
node production/episode-008/export.mjs
EPISODE_ID=episode-008 npm run episode:check-render
```

To synthesize a revised manifest, run `node scripts/elevenlabs-narration.mjs episode-008` with the configured ElevenLabs key before rebuilding the edit.

The export retains the encoded pictures for the three contiguous hard-cut sections and uses the same generated soundtrack as Motion Canvas. The export script checks for full-frame, unretimed playback at the original resolution and frame rate. For an edit with transitions or overlays, use the frame-by-frame Motion Canvas exporter.

## Export verification

The final MP4 runs 109.567 seconds at 3840×2160 and 60 fps. All 6,574 frames decoded with no black intervals, and all nine narration windows had audible signal. The AAC mix measured −18.3 LUFS integrated and −1.5 dBTP. The video packet hash matched the assembled board source. Sampled frames covered both cards, the opening bomb, Bram’s elimination, the collapse countdown, and the final impact. The Motion Canvas editor opened and served the mixed soundtrack. Audio verification used timing and level measurements.
