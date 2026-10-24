# Record the first Minecraft agent experiment

The initial recording workflow separates **world execution** from **video capture**. Minecraft runs under Docker; the observer is a normal Minecraft Java client on your desktop. We are **not** claiming that CI produces a video: GitHub-hosted CI is for repeatable behavior checks, not cinematic recordings.

## Recommended: replay-capable client

Use a locally installed **Minecraft Java Edition 1.21.4** client with Fabric and a compatible client-side replay mod, such as [Replay Mod](https://www.replaymod.com/download/) or [Flashback](https://flashback-mod.com/). Check exact versions and prerequisites on their official release pages before installation. Replay mods let you capture a session and compose spectator camera shots **afterwards**, which is much more forgiving than live camera operation. These mods run in the **client**, not the Docker Minecraft server.

You must have your own legitimate Minecraft Java client/account. The local bot server in this project uses offline authentication, so **keep its port loopback-only** and connect only from your trusted computer.

### First session

1. Start the local world with `docker compose up -d` after reading/accepting the Minecraft EULA. For recordings worth keeping, use a separate new world/data folder. Never run destructive tests against a valued world.
2. Start your Minecraft client with the replay mod installed and join `localhost:25565`. Enable recording in the mod settings and confirm its indicator appears. A normal player client can watch bots; an elevated spectator camera requires an operator/creative/spectator configuration and is not automatically provisioned here.
3. Start recording **before** running the bot. Keep the Minecraft client connected throughout the run; client-side replay mods may not record chunks/entities/events that the client hasn't received. Increase view distance or move the observer to stay near the bot if necessary.
4. From the repo root execute `npm run record -- npm run integration` to record the basic connection test. After merging the separate bot-action smoke-test PR, use `npm run record -- npm run bot-smoke` for the movement/mine/place demo. The recording wrapper stores a timestamped command transcript and metadata, not raw model reasoning.
5. Disconnect the spectator client after the experiment so the replay is finalized. Use the replay mod timeline and camera editor to export a cinematic clip; alternatively capture the client using OBS.
6. Save exports outside the Git repo. The `data/` folder, including recording metadata, is ignored by Git.

### OBS fallback

Use [OBS Studio](https://obsproject.com/) Window/Game Capture targeting Minecraft. Start OBS recording **before** the bot command. Prefer 1920×1080 at 60 fps if the machine sustains it, and use MKV for crash resilience (remux to MP4 for editing). Capture game audio on a separate track when convenient. OBS is a real-time recording: it cannot recover different camera angles after the fact.

### Timeline metadata

`npm run record -- <command> [args...]` creates:

```text
data/recordings/<timestamp>-<id>/
  session.json      # run identifier, ISO start time, environment, command
  events.jsonl      # timestamped stdout/stderr lines + start/end markers
```

The wrapper prints a unique **VIDEO SYNC MARKER**. Say or display the marker during recording, or note the video start time, to align recordings with event logs in editing. The marker is a synchronization aid, not frame-accurate timecode. The script captures command output; structured MCP interactions, model prompts, token usage, and wall-to-simulation-time mapping need future dedicated instrumentation.

### First-video editing outline

- Opening (10–20s): the question, *Can our first agent actually interact with a Minecraft world?*
- Setup (20–40s): the bot and tool architecture. Label this as a **scripted capability test**, not autonomous intelligence.
- Experiment (60–120s): genuine movement, mining, collecting and block placement, including failures if any.
- What worked / what failed (30–60s): exact verifiable outcomes from the run logs.
- Next challenge (15–30s): connect the tools to an LLM and test genuinely self-selected goals.

Keep an unedited run and its logs privately as provenance before creating highlights. Disclose scripted behavior accurately; avoid claiming the bot chose its own goals until the autonomous runner exists.

## Why this is environment-neutral

The record wrapper handles *process events* and the environment ID. Different world adapters may need different video capture drivers (screen capture, game replay, native render), without changing the command runner. A future `RecordingProvider` interface can coordinate video, screenshots, timestamps and event logs.
