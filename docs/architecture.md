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
