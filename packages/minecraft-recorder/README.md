# Experimental native Minecraft recorder

Independent npm package: no root workspaces, no hoisting, and no graphics
packages installed by `npm install` at repository root.

Install only when capturing:
```sh
npm install --prefix packages/minecraft-recorder --no-audit --no-fund
```

The main adapter loads `index.cjs` only when `RECORD_MP4` is present.
Native OpenGL dependencies may still need special system packages and a
compatible Node version. Rendering remains experimental until an MP4 passes CI.

## Dual-camera capture

A single Mineflayer agent session starts two independent Prismarine Viewer browser instances:
`agent-pov.mp4` (first person) and `observer.mp4` (third-person viewer), each on its own local port. Both begin before the smoke-test bot moves and share `events.json` and `metadata.json`. Playwright records both; FFmpeg creates H.264 MP4 copies.

The observer uses Prismarine Viewer's built-in third-person setting. Automatic camera following, smoother movements, and cinematic composition remain future work and should be visually verified before publishing.

The CI video job validates both videos for decoding and nonuniform frames. Keep the test terrain above Y=0 due to the confirmed failure to render the default negative-Y superflat world.
