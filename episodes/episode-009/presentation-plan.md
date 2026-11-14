# OpenTTD presentation improvements for episode-009

Recorded 2026-11-07 from the episode-007 review. Episode-007 remains the completed
proof of concept; do not revise its finished media as part of these improvements.

## Required before recording

1. **Calibrate a real challenge.** Follow the freight baseline checks in README.md.
   The two-leg supply chain, crossing and shared capital should require decisions;
   do not manufacture mistakes or extend waiting to inflate the video.
2. **Show actual vehicles.** The current renderer draws a tracking ellipse around
   a tile-level vehicle location (`packages/openttd/src/camera.ts`). The capture
   path uses `screenshot giant` from a dedicated engine; operation footage samples
   once per economy day. This is a time-lapse, not continuous gameplay footage.
   The circle is not a rendered bus. Exact cause of missing/unreadable native
   vehicle sprites remains unverified; do not assume changing skins fixes it.
3. **Prove capture quality before the take.** Capture a short non-agent test with
   a moving native bus/truck, in both directions, boarding/loading, travelling and
   unloading. Inspect raw frames and the encoded close-up with tracking overlays
   disabled. Check native visibility, sprite scale, camera alignment and motion
   cadence. Compare dedicated screenshots with a graphical spectator-client
   recording if needed. Prefer continuous spectator footage or denser native
   captures for movement shots. Do not substitute a moving circle or invented
   sprite trajectory for missing gameplay. Keep sampled sections labelled as
   time-lapse and align camera subjects to their actual capture times.

## Audio and visual feedback

Use Transport Tycoon's readable action feedback as inspiration:

| Verified event | Visual cue | Sound direction |
| --- | --- | --- |
| Delivery revenue received | Brief +amount near destination and cash total pulse | Short cash register/chime |
| Infrastructure or vehicle purchase | Brief negative amount at the relevant build/purchase | Restrained construction/purchase cue |
| First production or delivery milestone | Cargo icon and short progress increment | Distinct soft success cue |
| Growing queue / cash below reserve | Persistent small warning with actual value | At most an initial warning, with cooldown |

Use actual event amounts where available. Net cash change is not delivery revenue:
interest, running costs, purchases, loans and sales can overlap. If only net change
is available, label it as cash change and do not claim a particular payment.
Deduplicate events across camera cuts/insets. Aggregate rapid deliveries during
fast-forward, apply cooldowns, and keep effects below/clear of narration. Let a
cue decay after the event rather than flashing every frame. Preserve speech and
avoid filling every quiet moment with effects.

Our null-audio dedicated runtime and PNG captures contain no native sound track.
Adding OpenSFX alone does not put audio into the exported video. Either record a
synchronised spectator audio stream or author an event-synchronised effects track.
Use licensed assets, record their provenance, and verify the mixed encoded clip.

## Graphics comparison

Compare the same saved scene, camera crop and export scale using:

- Current pinned OpenGFX 8.0 as the control.
- **OpenGFX2 Classic** as the first alternate: complete classic pixel-art base set.
- **OpenGFX2 High Def** as an exploratory option: its project documents incomplete
  high-zoom vehicle and house coverage; higher resolution alone is not acceptance.
- **zBase** if the above comparison does not deliver the desired look: a different
  open-source 32bpp visual style, to judge from actual close-ups.

Inspect road vehicles, loaded trucks, bridge, forest, mill, town and both wide and
close camera views. Choose based on recognisability and consistency on screen.
Pin the selected asset versions/hashes. A base graphics change can retain gameplay
rules; NewGRFs may alter vehicle prices, capacities, cargos and industry behaviour,
so evaluate those before calibration and revalidate affected mechanics.

Custom graphics are possible via a custom base set or NewGRF. Start by improving
our camera framing, overlay typography, cargo icons and event feedback; a full
bespoke world skin is a separate art project. Any custom vehicle art must reflect
real orientation, cargo and position and have clear asset provenance.

## Acceptance before production

- Recognisable native vehicles and loading/unloading are visible without circles.
- Motion is readable; time-lapse is distinguished from continuous capture.
- A short delivery sequence demonstrates synchronised revenue cues and sound.
- Narration remains intelligible and feedback does not repeat across cuts.
- The skin comparison uses actual renders, not claims based on screenshots online.
- Scenario title is visible; the internal episode number is not shown or spoken.

## Sources checked 2026-11-07

- OpenGFX2 variants, current completeness and local graphical parameters:
  https://github.com/OpenTTD/OpenGFX2
- Base graphics and sound sets:
  https://wiki.openttd.org/en/Basesets/
- zBase package:
  https://bananas.openttd.org/package/base-graphics/7a423332
- NewGRFs can change graphics and gameplay, and should be selected before a game:
  https://wiki.openttd.org/en/Manual/NewGRF
- OpenTTD 15.3 native screenshot path (giant capture uses viewport drawing):
  https://github.com/OpenTTD/OpenTTD/blob/15.3/src/screenshot.cpp

## Screenshot review, 2026-11-08

OpenTTD 15.3 skips vehicle viewport updates in dedicated mode. The new screenshot
command loads a copy of a paused save in a short-lived graphical OpenTTD process.
It disables native name banners, uses the chosen base graphics set and waits for a
complete native PNG. The scripted freight preview crops that PNG with nearest
neighbour scaling and adds the title, deadline, both delivery meters and cash.

The A/B frames use the same day-48 save, camera crop and overlay. OpenGFX 8.0 and
OpenGFX2 Classic 0.8.1 show the two loaded trucks in their actual positions. The
Classic archive comes from the [OpenGFX2 release](https://github.com/OpenTTD/OpenGFX2/releases/tag/0.8.1).
Its SHA-256 is `2f4d0d8cd82b9b15d7c5a742581bfd11a08d4fd54fc0743f1f8a1032e3b5eeaf`.
The PNGs and cue WAV are under `data/openttd-previews/episode-009/`.

The delivery card shows the change in native transport income across the sample
window, with one cue ID per interval. A positive bank movement alone produces no
cue. The short original chime is generated as 48 kHz mono PCM. The test frames
show the active cue state, both as a corner card and as a callout pointing to the
delivery stop. Continuous spectator motion, cue timing against
narration and the final mix still need production checks.

To build and sample the staged route in a new local folder:

```sh
node --import tsx scripts/openttd-freight-baseline.ts data/openttd-previews/freight-new --staged
```

To reproduce a screenshot, use a native PNG rendered from the same day's saved
checkpoint as the telemetry sample:

```sh
node --import tsx scripts/openttd-native-screenshot.ts RUN/day-048.sav native.png classic
node --import tsx scripts/openttd-freight-preview.ts RUN 48 native.png preview.png 'OpenGFX2 Classic' truck
```

The `classic` argument expects the pinned archive under `data/openttd-runtime/`.
Omit it for the pinned OpenGFX 8.0 control. The screenshot command uses macOS
window services and the composition command requires `rsvg-convert`.
