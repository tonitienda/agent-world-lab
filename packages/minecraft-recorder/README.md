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

## Three-camera capture

One Mineflayer session serves three independent Prismarine Viewer pages on loopback ports
`RECORD_VIEWER_PORT` (default 3007), +1, and +2:

- `agent-pov.mp4`: the agent's natural first-person view.
- `observer.mp4`: the existing tracking aerial orbit camera.
- `follow.mp4`: a smooth trailing camera, four blocks behind and slightly above the player.

New agent sessions default to 3840×2160 capture at 60 fps for all three cameras.
Chromium recording uses Playwright 1.64.1 or newer; run `npm ci` in this package
after updating. `RECORD_WIDTH`, `RECORD_HEIGHT` and `RECORD_FPS` override the direct
adapter defaults. The guided orchestrator explicitly requests 4K/60 regardless of
provider. Metadata records dimensions and requested frame rate. Three 4K/60 views
are demanding; a 60 fps stream does not guarantee 60 distinct rendered frames per
second when the machine is overloaded. Recorder timings remain measured from the
optical gate. New Motion Canvas drafts export at 4K/60; old plans retain their
saved settings.

No Minecraft client is required. The follow camera uses the viewer's existing player
mesh and Three.js camera. Its controller runs every animation frame, smooths yaw on
the shortest arc, and sweeps a camera body against Mineflayer collision shapes.
Terrain snapshots refresh every 50 ms. Occlusions pull the camera inward immediately;
clear terrain allows a smooth return. A level shoulder view helps under low ceilings; very short booms try nearby side views to keep the player visible.
Unknown terrain counts as solid. POV, inventory HUD, intentions, and session events remain active.

All pages finish initialization before a common event-clock epoch. A 32-pixel optical
gate in the raw browser videos switches from white to black at that epoch. FFmpeg detects
the transition independently in each raw video and trims all MP4s to the same start and
end. `metadata.json` records the epoch, actual gate transition times, raw capture estimates,
and measured trim offsets. New MP4s have zero relative media offsets; old sessions keep
their original offsets. Timing precision is limited to captured frames and browser scheduling,
not sample-accurate timecode. The black gate occupies the upper-left 32×32 pixels.

Every camera is finalized even if another fails. Raw named WebMs (and Playwright's
original numbered WebMs) are retained. Encoding writes `.partial.mp4` and only renames
on success. Missing sync gates fail explicitly rather than emitting misaligned MP4s.
On initialization failure, contexts and HTTP/WebSocket servers close; partial browser
captures remain in the destination. Use a new directory for every session.

## Validation

`npm run integration:recorder` runs the real viewer, Chromium, optical synchronization,
and FFmpeg against an in-memory terrain fixture: open ground, a narrow tunnel, low
ceiling, an end wall, turns, and height changes. It never connects to a Minecraft server.
Artifacts are retained in the printed temporary directory. Install the recorder package,
Playwright Chromium, and FFmpeg first. `npm run capture-smoke` additionally checks a live
Mineflayer session; CI decodes and checks all three cameras for visible spatial variation.
`npm run integration:recorder -- --fail-encoder` injects an observer encode failure and verifies that POV/follow still save and every raw WebM survives.
Unit tests cover smoothing, yaw wrapping, collision/fallback, fractional block shapes,
unloaded terrain, recovery, and legacy/three-camera production plans.

## Limitations

Camera avoidance is geometric and uses a finite camera body and near plane, not the
entire view frustum. Very confined spaces cannot fit both a camera and a full player;
the close view may crop the character. Terrain changes between snapshots, rapid movement,
and teleports can cause a brief pop or occlusion. Only solid collision shapes obstruct
the camera; liquids, decorative non-colliding blocks, and entities do not. Viewer graphics
and model compatibility remain those of Prismarine Viewer. The follow hook checks the
installed bundle and fails explicitly on unsupported upstream changes. Existing aerial
negative-Y initialization behavior is unchanged; the follow camera supports negative Y.
