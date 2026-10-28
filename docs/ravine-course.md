# Repeatable ravine course

Episode 002 uses `ravine-v1`, an explicitly constructed course in a freshly reset
survival world. It does not rely on finding a natural ravine in a particular seed.

- Start: `(2.5, 96, 0.5)`, facing east, full health/food, empty inventory, survival mode.
- Gap: `x=4..11`, `z=-16..16`; banks at block Y=95, stone bottom Y=71.
- Goal: gold 3×3 landing pad centered at `(15.5, 96, 0.5)` on the far bank.
- Marker: emerald pillar at `(18, 96..99, 0)`.
- Resources: two small oak trees at `(-1, 96, -5)` and `(-6, 96, 6)`.
- Course bounds: `(-12, 71, -16)` through `(27, 127, 16)`.

The 24-block drop makes an unprotected fall dangerous. There is no prebuilt crossing.
The agent may use any available strategy; the harness does not prescribe a bridge.
The course is finite, and going around is allowed if the agent can safely manage the
surrounding terrain. Geometry and supplied resources are fixed; terrain outside the
course still depends on the selected survival seed. Daylight, weather, random block
ticks and new mob spawning are held fixed for the challenge.

## Running an episode

Run `bash scripts/run-episode-002.sh`. It archives/resets the world as before, checks
the survival generator, builds the course, then reconnects as `emergent-002` to check
that the starting state was saved. Existing session captures are archived only after
course verification succeeds. It then configures MCP and starts Claude with the
original prompt plus a scenario briefing containing the goal and resource coordinates.

Setup uses the Docker image's console pipe as server user 1000. RCON stays disabled;
no administrator privileges are granted to the agent. Console actions finish before
recording and are never presented as agent decisions or narration. During the challenge,
the agent continues using only the Minecraft MCP tools.

The setup writes `data/minecraft/scenario.json` only after checking every block in
the controlled volume, the marker, gap, resources, player position/facing, survival
mode, inventory, health and food. The manifest identifies the course, player, seed
and verified world-reset timestamp. `SCENARIO_FILE` tells MCP which manifest to use.
MCP rejects stale manifests and verifies the course and player again before starting
capture. `world_info` and `observe` include the scenario. Each recording session also
gets a `scenario.json` copy, a `scenario_ready` event and scenario data in `mcp-session.json`.
Sessions without `SCENARIO_FILE` keep the ordinary world behavior.

`completed` remains a session-finalization status. It does not claim the objective
was achieved. The briefing asks the agent to finalize on the gold pad after success,
or clearly report failure; inspect the final position and event log when assessing
an episode.

## Setup commands

Preview without changing Minecraft:

```sh
npm run scenario:ravine
```

Prepare only after resetting the intended world and closing active MCP sessions:

```sh
npm run scenario:ravine -- --yes --agent emergent-002
npm run scenario:ravine -- --verify-only --agent emergent-002
```

`--yes` changes the course volume, global time/weather/spawning settings and the selected
player's starting state. Rebuilding erases changes within that volume. The session lock
prevents setup during a recording. Verification logs in as the selected player but
issues no setup commands; the manifest and full live course must still match.
A failed setup prevents the episode runner from launching Claude. An interrupted rebuild
invalidates the previous manifest. To prepare another take, use the runner so the prior
world is archived before reconstruction.

## Tests

`npm test` covers terrain geometry, fill-volume limits, marker/gap corruption, stale
manifests, player initialization, deterministic setup and runner failure handling.
`npm run integration:ravine` creates a separate temporary Docker world on a random
port. It verifies setup, reconnect persistence, tamper detection, repeatable reconstruction
and a real placement/navigation crossing. Its test-only building supplies are not
part of the actual challenge. The existing Minecraft container and episode assets
are never mounted into the disposable server. Only a cached immutable server JAR
may be copied to avoid downloading it again. The fixture's own directory is retained
for diagnosis and its container is removed afterward.
