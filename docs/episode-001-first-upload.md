# Emergent Episode 001 — first publishable cut

Goal: **ship a simple observational experiment video**, not build a full automatic documentary editor before the first upload.

## Inputs

A completed MCP session with `events.json`, `metadata.json`, `observer.mp4`, and `agent-pov.mp4`. Use the new clean world for the rerun and retain the first attempt separately.

## Procedure

From the repo root:

```bash
git pull
npm install
npm run episode:plan -- data/mcp-sessions/episode-001-rerun
```

Review `production/generated/edit-plan.json`. It is an **initial proposal**. Check camera offsets and event positions against the footage, then edit the shot start times and durations. A shorter edit is better than lingering on inactive footage. Keep the first run's original prompt and the exact model/harness name in the episode description.

The planner generates **one file**, `production/generated/narration.txt`, with **one spoken sentence per line**. The intro/outro are neutral, while the commentary comes from the agent's explicit `report_intention` MCP calls. The system does not narrate boring tool calls such as “the agent moves to another position,” nor does it invent private reasoning. Review each line for clarity and whether it matches what appears onscreen.

Generate **one MP3 per line** in ElevenLabs, in the same order, naming them `001.mp3`, `002.mp3`, etc. Place them in `production/generated/narration-audio/`. The `narration-manifest.json` maps each line to the corresponding edit segment.

```text
production/generated/
  narration.txt
  narration-manifest.json
  narration-audio/
    001.mp3
    002.mp3
    003.mp3
```

Run a first cut:

```bash
npm run episode:render-simple
```

Optionally supply one licensed ambient music file:

```bash
EPISODE_MUSIC=/absolute/path/to/licensed-track.mp3 npm run episode:render-simple
```

The output defaults to `production/output/episode-001.mp4`. An optional output argument overrides this:

```bash
npm run episode:render-simple -- production/output/pilot.mp4
```

## What the simple renderer really supports

- Intro/outro cards using the existing plan text
- 1080p H.264 hard cuts between the **primary camera** named in each shot
- Optional narration MP3 for each segment (matched by manifest order)
- Optional fixed music mixed at low volume; narration at normal gain
- A final MP4 without a manual FFmpeg invocation

**It does not render Motion Canvas transitions, split-screen, or picture-in-picture.** Those layouts remain available in the Motion Canvas project; this renderer deliberately falls back to the first camera in each shot. There is currently no audio ducking, subtitles, auto thumbnail, automatic upload, or frame-accurate timeline synchronization.

Check that narration fits within each segment. If the renderer warns about overlap, adjust durations or the voice clip manually. The audio mix may be too loud or too quiet depending on the source music. Always listen to the result.

## Practical first episode structure

Keep it around 60–90 seconds if the footage is interesting enough:

1. 5–7 second intro: prompt and what the agent can observe
2. 10–20 seconds of initial movement, observer camera
3. 10–20 seconds of interaction, agent POV
4. 15–25 seconds of the agent trying or recovering, observer camera
5. 5–7 second outro asking for viewer suggestions

Narration should be occasional, not continuous. An agent intention is a **statement of its goal**, not hidden reasoning. Do not invent outcomes not present in the event log.

## Check before publishing

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 production/output/episode-001.mp4
python3 scripts/check-video.py production/output/episode-001.mp4
open production/output/episode-001.mp4
```

Watch the full render. Verify shots align with tool events, clips do not freeze unexpectedly, the voice is audible, and the music is licensed and properly credited. Preserve raw footage and `events.json`.

Upload to YouTube manually. For a first baseline, try a straightforward title such as **I Let Claude Explore Minecraft. It Started Digging.** (only if the new run actually follows that story). Ask viewers for the next prompt in the pinned comment, and leave room at the end for an end screen.

Treat the first upload as a baseline for impressions, CTR, retention, and comments; do not draw conclusions from an extremely small initial audience.
