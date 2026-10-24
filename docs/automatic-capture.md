# Automatic Minecraft capture (experimental)

We want **run experiment → automatic video**, with no manual narrator or camera path editing.

## Current v0

The first implementation uses [prismarine-viewer's headless renderer](https://github.com/PrismarineJS/prismarine-viewer) attached to the same Mineflayer bot controlled by our world adapter. It follows the bot automatically in a fixed built-in view and writes a finite MP4 recording.

**It is not a sophisticated spectator camera**: no independent camera actor, shot switching, picture-in-picture, behavioral highlights, audio, captions, or multi-agent following yet. The MP4 is a diagnostic output that should be checked for visual quality before publication. Headless graphics dependencies may not work on all hosts.

1. Start Docker Minecraft locally after accepting the EULA.
2. Install Node dependencies: `npm install`.
3. Run `npm run capture-smoke`.
4. Find `data/captures/<timestamp>/bot.mp4` and `events.json`.

This smoke test connects to a live server, moves a bot a few blocks and attempts to write a short video without opening Minecraft's desktop client. Unlike our scripted bot action test, **it does not require a flat world**, but it does modify the bot's position and may fail if movement is blocked.

## Manual MCP / experiment recording

For any process using the existing Minecraft WorldAdapter, opt into capture by setting:

```sh
RECORD_MP4=data/captures/manual.mp4 RECORD_FRAMES=1800 npm run mcp
```

Then connect an MCP-capable agent to that **same** process. The video starts after Minecraft spawn and stops after the specified number of frames, which may not align with experiment duration. Recording initialization failure currently fails the session rather than silently running without video.

The event log in the smoke script is a first step; complete tool-decision logging and clock synchronization still belong in the planned experiment runner.

## Known engineering follow-ups

- Verify FFmpeg / OpenGL / software rendering requirements across Linux/macOS/Windows and on GitHub-hosted runners.
- Add frame-validation via ffprobe and a controlled camera shot proving the bot is visible.
- Build a separate independent observer agent rather than rendering from the actor's camera.
- Add per-agent event streams and switch cameras automatically on behavior-change events.
- Implement reliable recording lifecycle with start/stop, file flush, encoding status and synchronized event timecodes.
- Add captions from **explicit agent statements**, not invented internal reasoning.
- Produce full-length and condensed highlights automatically.

Keep Minecraft game/video branding and music within the relevant rights holder's usage guidelines.
