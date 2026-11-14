# OpenTTD integration spike

Research and the next-terrarium decision live in
[docs/research/next-terrarium.md](../../docs/research/next-terrarium.md).
The [validated spike report](../../docs/research/openttd-spike-results.md) records
the first passing 90-day run, including 31 passenger deliveries and its limitations.

This is a disposable **real OpenTTD 15.3** integration, not a replacement simulation.
A scripted Node driver exercises the same JSON boundary an agent could use later.
It creates one idle company, surveys passenger sites, constructs two stops and a
depot, buys a bus, assigns orders and runs it for 90 economy days.

## Run

Requires Node 22+, installed repository dependencies, and `unzip` on macOS.

```sh
npm run openttd:setup   # macOS: download pinned engine + OpenGFX; verify SHA-256
npm run openttd:spike
```

## Event-driven camera preview

```sh
npm run openttd:spike -- --record
npm run openttd:record -- data/openttd-spikes/<new-run>
```

Recording requires `rsvg-convert`, `ffmpeg` with libx264, and `ffprobe`. It captures
the real full world before/after construction and once per economy day, while
paused. Town buildings render transparently in recording mode so they cannot
hide the bus or stops; this is an observer display setting, not a gameplay change.
The original unrecorded spike and its screenshots remain intact.

The renderer produces a **1920×1080, 30fps camera study**, approximately 36.5 seconds
for the default run. This is daily sampled time-lapse with intentional construction
holds and no audio, not continuous real-time gameplay footage. It makes editorial
crops of the same isometric world image, rather than changing the game's viewing
direction or adding a 3D camera.

- **Wide:** world context at the beginning and result at the end.
- **Construction:** the intended site before construction, then the actual result,
  with a tile outline. Depot/vehicle readiness is also covered.
- **Queue:** focus a stop when its measured waiting count crosses a multiple of
  25. Counters remain live while the shot stays on that stop.
- **Follow:** track the bus during ordinary travel.
- **Boarding/delivery:** prioritize increases in the bus load or confirmed cargo
  deliveries. Delivery takes precedence over a queue or boarding shot.

Close-ups include a small world inset with the current camera rectangle, so cuts
retain geographic context.

An eight-sample minimum dwell reduces camera thrashing; higher-priority events
can interrupt it. Timelines preserve capture order. Passenger counts are overlays
from station observations; no people or events are fabricated. Yellow rings locate
the bus by its observed tile, not exact sub-tile position.

The run preserves `captures.json` and the original full-world PNGs, so new edits
do not require another game run. `camera-plan.json` contains each shot's source
capture, camera, focus, reason and duration. Edit that file and run `openttd:record`
again to change the cut; the renderer preserves an existing plan. Derived outputs
are `camera-frames/`, `camera-preview.mp4`, and `camera-render.json`.

Projection currently supports only this flat, freeform-edge fixture and normal
world-screenshot zoom. It follows the pinned engine's
[screenshot framing](https://github.com/OpenTTD/OpenTTD/blob/15.3/src/screenshot.cpp)
and [isometric projection](https://github.com/OpenTTD/OpenTTD/blob/15.3/src/landscape.h).
Terrain, differently sized maps/zoom, smooth camera transitions, multiple buses,
and finished episode production need further work. A bus icon/counter becoming
visible between daily samples does not establish its exact arrival time.

Setup writes to ignored `data/openttd-runtime/`, never `/Applications` or global
OpenTTD settings. Both setup and the runner refuse existing destination directories.
For a different setup destination: `npm run openttd:setup -- /absolute/new/path`.

Manual/custom runtime:

```sh
npm run openttd:spike -- \
  --binary /absolute/path/to/openttd \
  --graphics /absolute/path/to/opengfx-8.0.tar \
  --assets /absolute/path/to/engine-data \
  --out /absolute/path/to/new-run
```

`--assets` contains the engine's `lang`, `baseset`, `game` and `ai` directories.
On macOS this is detected as `OpenTTD.app/Contents/Resources`. Manual Linux setup
should supply equivalent 15.3 assets; Linux has not been validated. Graphics may
also be an extracted OpenGFX directory. `OPENTTD_BINARY` and `OPENTTD_GRAPHICS`
are alternatives to the corresponding flags. Do not point graphics at proprietary
Transport Tycoon assets; this spike uses the freely distributed OpenGFX set.

## Boundary

```text
trusted runner → local admin TCP → restricted Game Script → GSCompanyMode → game
```

- `src/admin.ts`: packet framing, loopback connection, request IDs, streamed survey
  records, serialized calls, deadlines, disconnect rejection. Admin protocol 3,
  legacy password join, explicitly enabled only for this loopback fixture.
- `game/terrarium`: Squirrel bridge, finite operation switch, company 0 only,
  bounded observations and time advancement. No evaluation of incoming code.
- `ai/idle`: creates a company through `start_ai`, then never makes gameplay decisions.
- `scripts/openttd-spike.ts`: owns launch/configuration, scenario, action driver,
  assertions, evidence capture and cleanup.

The agent-facing candidates are `observe`, `sites`, `engines`, `build_road`,
`build_stop`, `build_depot`, `build_vehicle`, `append_order`, `start_vehicle`, and
`advance`. They are experimental internal operations, **not MCP tools yet**.
The trusted runner alone uses console commands to create the company, save and
take screenshots. Never expose the admin client, arbitrary RCON, or its password
to a playing agent. The bridge has not been hardened for untrusted remote clients.
`stations` provides up to four bus-stop positions and waiting counts; `geometry`
provides the fixture's north/south ground heights for the observer renderer.

## Time and action semantics

Game Scripts continue running while the simulation is paused. The fixture enables
`construction.command_pause_level = 3` so ordinary company actions can execute in
that state. Construction spends real company funds; the driver does not grant money.
The flat 64×64 map has two generated towns, no industries, and disabled breakdowns,
disasters, inflation and town growth. The first route serves one town using its
existing roads, with short entrance connections constructed through the bridge.

`advance {days: 1..90}` unpauses, waits for the requested number of **economy dates**,
then pauses before replying. This is not an exact tick API: a construction action,
script scheduling and pause commands need not consume zero engine/network frames.
Idle date stability and each 15-day increment are checked live. One request runs at
a time. A disconnect/timeout stops the driver; it never retries an uncertain action.
The runner's four-minute watchdog (seven minutes in recording mode) and shutdown
sequence terminate its own server. Recording mode checks ninety one-day increments
instead of six fifteen-day increments.

Surveys stream individual site records because `GSAdmin.Send` limits JSON replies
to 1450 bytes. Observations currently cap towns and vehicles at four. The survey
is bounded to radius 16 and reports empty flat sites adjacent to roads, passenger
acceptance/production, and nearest town; it does not construct or select routes.
`delivered` accumulates cargo-monitor deltas so repeated observations preserve a
session total. Vehicle profit is an operating figure, separate from construction
spending, loan interest and the company's net financial result.

## Evidence

Each run creates a new ignored `data/openttd-spikes/<timestamp>/` directory:

- `manifest.json`: pinned engine version, seed, script hashes, graphics hash for
  archive inputs, ports and redacted configuration.
- `events.json`: trusted setup commands plus requests, responses and failures.
- `route-plan.json`, `snapshots.json`, `result.json`: chosen sites, observations,
  assertions and outcome. Failed runs retain a failure result and server log.
- `route-built.sav`, `after.sav`: game states before and after operation.
- `world/screenshot/`: minimaps and actual rendered world PNGs before/after.
- `server.log`, plus the isolated world, scripts, heightmap and configuration.

The local world config contains a random per-run admin password and is mode 0600;
it stays in ignored runtime data. Do not publish that config as an episode artifact.

## Checks and next work

```sh
npm run openttd:test
npm run check
```

Protocol tests cover fragmented/coalesced packets, limits, string validation,
streamed survey replies, serialization and disconnects. The live runner verifies
paused observations, idle date stability, invalid-action rejection without state
changes, company construction, orders, movement, exact 15-day date increments,
passenger deliveries, positive vehicle operating profit, saves and images.

Still outside this spike: an MCP server/WorldAdapter, model-driven play,
multi-agent authorization and arbitration, competition, freight/rail pathfinding,
deterministic replay, save/reload continuation validation, and continuous video recording.
Next increment: wrap the restricted operations as MCP tools, record each agent's
public intention, then compare one agent with two sharing a company under matched
total inference budgets. Preserve the trusted runner/agent permission boundary.
