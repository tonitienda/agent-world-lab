# Automatic Minecraft video capture (experimental)

The video recorder lives in `packages/minecraft-recorder`. Core agent tests do not install or depend on it.

The recorder starts Prismarine Viewer's **browser** spectator view and uses Playwright Chromium to record the page. When the bot session closes, the browser recording is finalized and FFmpeg converts it to MP4. No native headless `gl` or `node-canvas-webgl` dependency is used.

## Local run

1. Start the disposable Minecraft server: `docker compose up -d`
2. `npm install`
3. `npm install --prefix packages/minecraft-recorder`
4. `npx --prefix packages/minecraft-recorder playwright install chromium`
5. Install FFmpeg and make sure `ffmpeg` is in PATH.
6. `npm run capture-smoke`

The output is `data/captures/<timestamp>/bot.mp4` and `events.json`, plus an intermediate WebM.

The `minecraft-video` CI job installs the browser recorder independently, runs the bot, validates the MP4 with FFprobe/FFmpeg and uploads the recording as a workflow artifact.

## Limits

This remains unverified until CI produces and decodes an MP4. The current camera is Prismarine Viewer's built-in follow view, not a self-directing camera operator. Recording requires Chromium graphics support on the runner. The recorded browser page might render a blank or stalled world; inspect a representative frame before publishing.
