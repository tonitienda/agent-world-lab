# Architecture and next work

## Boundary

`WorldAdapter` = connect + observe + named, structured actions + close. Core does not contain Minecraft terms. The MCP server maps portable semantics to adapters; unsupported actions should fail explicitly.

## First release

- Private local Java server under Docker Compose.
- One Mineflayer client process connects through MCP stdio.
- Basic perception and limited physically constrained actions.
- Manual MCP agent interaction and real-server smoke test.

## Future releases

1. Agent-agnostic unattended runner, prompts, scheduled decision/action loop, resource budgets and durable event log.
2. Experiment seed and deterministic reset snapshots; enforce reproducibility.
3. Per-agent bot sessions and communications, event timestamps, observer and video/spectator capture.
4. Second environment adapter (e.g. Craftium/Luanti, custom 3D simulation) with capability negotiation and shared evaluation.
5. Learned skills and memory artifacts stored per agent/run, never conflated with system-provided instructions.

## Safety

The local server uses offline-mode authentication for easily spawned test accounts. Port 25565 is localhost-bound, no RCON. Do not publish it or configure Docker for remote reachability. Treat model-suggested actions and texts as untrusted and validate input.

## Survival actions and lifecycle

`MinecraftAdapter` owns recipes, Mineflayer windows, equipment, bounded perception,
reach checks and navigation. The core `WorldAdapter` contract remains unchanged.
MCP validates arguments and records narration before an action attempt, then the
structured result (including `ok:false`) separately. The episode planner recognizes
new interactions as POV shots. Every MCP session writes events, even without video.
Existing recording directories are rejected rather than overwritten.

Navigation uses pathfinder with digging, scaffolding and towers disabled. Short
jumps and normal obstacle routing remain available; doors need explicit interaction.
An action timeout stops navigation/digging/use. Canceled navigation is retryable;
other timeouts block further actions because a protocol operation may have an
uncertain result. Finalize those sessions.

A process-owned directory lock covers adapter connection, recording and closing.
Reset acquires the same lock before stopping the Minecraft service; it never kills
sessions. Only demonstrably dead owner PIDs are reclaimed. PID reuse and malformed
locks fail conservatively and require manual inspection. An operator control request
is handled by the MCP process itself. Concurrent shutdown requests share one promise.
`completed`, `stopped`, and `aborted` are distinct persisted outcomes; recorder errors
or actions still pending at finalization produce `aborted`. SIGINT/SIGTERM and transport
closure gracefully stop incomplete sessions. SIGKILL cannot finalize cameras; previously
written events and camera intermediates remain for recovery.

Reset creates a new data directory after atomically archiving the previous one,
then verifies server.properties and the generated level.dat generator and seed.
The manifest in `data/minecraft/world-config.json` is copied to session metadata.
Unmanaged existing worlds are explicitly unverified. Survival uses the normal
overworld and normal difficulty; superflat retains the positive-Y layers and peaceful
benchmark configuration. Neither preset grants resources or changes the spawn.

Tests use temporary directories; `integration:survival` owns a labeled disposable
Docker server on a random loopback port, with fixture-only RCON accessible through
Docker exec. It never mounts experiment data. Static/unit tests, live initialization,
and live survival exercises are reported separately. See README for the tool contract.
