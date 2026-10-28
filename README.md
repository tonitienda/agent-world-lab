# Agent World Lab

A reproducible lab for autonomous agents exploring **virtual worlds**. Minecraft is the first environment, not the architecture.

## Quick start

Requirements: Docker Compose, Node.js 22+, npm, Java Edition Minecraft client (optional for observation).

1. `cp .env.example .env`
2. Read and accept the [Minecraft EULA](https://aka.ms/MinecraftEULA), then change `EULA=TRUE` in `.env`. Starting the server means accepting the EULA.
3. `docker compose up -d`
4. `npm install`
5. `npm run smoke` — connects a Mineflayer bot, observes, then disconnects.
6. `npm run mcp` — starts a **stdio MCP server** for one bot. Use this command as the MCP server in your local agent harness. The MCP protocol goes over stdout; logging goes over stderr.

The Minecraft server listens on **127.0.0.1 only**. It runs with offline authentication **only for a trusted, local test machine**. Do not expose port 25565 to a LAN or the Internet. Do not use this configuration on a shared/untrusted host.

### Example MCP config

```json
{
  "mcpServers": {
    "agent-world": {
      "command": "npm",
      "args": ["run", "mcp"],
      "env": { "WORLD_ADAPTER": "minecraft", "AGENT_ID": "explorer-1" }
    }
  }
}
```

Start the Minecraft server first, and configure the MCP process working directory to this repo. The agent has low-level tools; **no autonomous planning loop is included yet**. For a first manual experiment ask your MCP-capable agent to observe the world and select an objective.

## Architecture

- `src/core/`: environment-neutral world interfaces.
- `src/environments/minecraft/`: Minecraft-only Mineflayer implementation.
- `src/mcp/`: MCP transport + portable agent tools.
- `experiments/`: future experiment manifests.
- `docs/`: architecture and milestone scope.

The agent sees only information exposed through its adapter. Other environments can implement `WorldAdapter` without depending on Minecraft. We intentionally do **not** implement cross-world concepts as Minecraft block operations.

## Commands

```sh
npm run check          # TypeScript type check
npm run test           # adapter-independent tests
npm run smoke          # real-server connectivity test
npm run mcp            # run MCP stdio server
docker compose logs -f minecraft
docker compose down    # retains local Minecraft world data
```

## Status and roadmap

Bootstrap / Milestone 1: persistent local Minecraft server, pluggable adapter contract, single Mineflayer bot, stdio MCP tools, unit tests, and smoke test.

Available: survival actions, seeded world reset with archives, dual-camera recording, lifecycle controls, and disposable integration tests. Unattended model orchestration, cost limits, and guaranteed visual perception remain future work.

## Licenses and content

Minecraft software and artwork remain subject to Mojang/Microsoft terms. The repository does not distribute Minecraft binaries. The server image downloads the game files only after EULA acceptance. Check individual asset and music licenses before publishing videos.

## Record a test for YouTube

See [the recording guide](docs/recording.md). Start a replay-capable Java client locally before running:

```sh
npm run record -- npm run integration
# Once the bot-actions smoke test is merged:
npm run record -- npm run bot-smoke
```

This creates timestamped process event logs under `data/recordings/`. The optional Mineflayer recorder captures both agent POV and observer footage; see the recording guide for dependencies.

## Creating a new episode

### 1 agent - Minecraft

1 - Reset the scenarios

```
make reset EULA=TRUE
```

2 - Configure the MCP

```
make set-mcp AGENT_ID=agent-<nnn> SESSION=episode-<nnn>
```

example:

```
make set-mcp AGENT_ID=agent-002 SESSION=episode-002
```

1 - Create a directory with "episode-nnn" under `production` with a prompt.txt

## Survival experiments

Reset only after all sessions have finalized. Reset defaults to the historical
superflat preset; choose survival explicitly for ordinary resource gathering:

```sh
npm run world:reset -- --preset survival --seed 12345       # dry run
npm run world:reset -- --yes --preset survival --seed 12345
npm run world:reset -- --yes --preset superflat --seed 12345
npm run world:preflight -- --profile survival
npm run world:preflight -- --profile survival --exercise
```

Seeds are signed 64-bit decimal integers. Omit the seed to generate and record a
random one. Reset archives the entire previous server data folder under
`data/world-archives/`, starts a fresh world, and verifies both server.properties
and the actual level.dat generator and seed. Survival uses normal difficulty;
superflat preserves the earlier layers and peaceful difficulty. Normal generation
does not guarantee nearby wood, food, shelter, or a winnable challenge.

Preflight checks installed versions, adapter capabilities, world configuration,
actual generation settings and TCP connectivity. `--exercise` additionally logs
in, loads chunks and pathfinder, and inspects observation, recipes, inventory and
equipment. Run it before connecting the recording agent. These are distinct from
actually gathering, crafting, eating or fighting. To exercise those mechanics:

```sh
npm run integration:survival
npm run integration:survival -- --capture  # also exercise both cameras
```

This suite starts and removes its own labeled Docker containers on random loopback
ports with temporary world data. It never mounts the experiment world or recording
folders. It needs Docker and EULA acceptance; temporary fixture artifacts remain
for diagnosis. It exercises survival actions in controlled terrain, then verifies
a separate normal overworld. The standalone mutating `bot-smoke` command requires
`AWL_DISPOSABLE_TEST=1`; use it only against a disposable server.

### MCP tool reference

All coordinates are integers. Block interactions use top-level `x, y, z` and a
5-block reach. Entity interactions require an ID from the most recent `observe`,
current visibility and a 3-block reach. New block interactions also check visibility.
Counts must be positive integers (maximum 2304). Mutating survival tools require
`intent`: a short public first-person sentence about what the agent will try.
Results are `{ok, message, data?}` except discovery/observation, which return their
objects directly. A failed action returns `ok:false` with a diagnostic message.

| Tool | Arguments | Result / behavior |
| --- | --- | --- |
| `world_info` | none | World ID and supported actions |
| `observe` | none | Position, health, food, time, weather, equipment, bounded visible blocks and entities with IDs |
| `inventory` | none | Backwards-compatible item array with name/count plus slot, type, display name, durability and enchantments |
| `equipment` | none | Items in hand, off-hand, head, torso, legs and feet |
| `recipes` | optional `item` | Up to 128 recipes, output quantity, required ingredients, table requirement, craftability with a table |
| `craft` | `item`, `count`, optional `crafting_table_position:{x,y,z}`, `intent` | Exact output quantity; must be a multiple of recipe output; no intermediate crafting or resource collection |
| `equip` | `item`, `slot`, `intent` | Equips inventory item; slot is hand/head/torso/legs/feet/off-hand |
| `drop` | `item`, `count`, `intent` | Drops inventory items |
| `move_to` | `x,y,z`, optional `radius` (0 or 1, default 1), `intent` | Pathfinder movement, maximum 24 blocks, no automatic digging or scaffolding |
| `mine` | `x,y,z`, `intent` | Digs a reachable block; does not guarantee harvesting or picking up its drop |
| `place` | `x,y,z`, `item`, `intent` | Places a carried block into an empty target with solid adjacent support |
| `interact_block` | `x,y,z`, `intent` | Activates doors, trapdoors, gates, buttons, levers or bells; checks table access |
| `interact_entity` | `entity_id`, `intent` | Sends a normal interaction to a discovered nearby entity |
| `open_container` | `x,y,z`, `intent` | Opens a chest, barrel, shulker box, hopper, dispenser, dropper, furnace, smoker or blast furnace |
| `container` | none | Contents; furnaces include input, fuel item, output, burn fraction and progress fraction |
| `transfer_item` | `item`, `count`, `direction`, optional `slot`, `intent` | `deposit` or `withdraw`; furnaces require slot input/fuel/output; output is withdrawal only |
| `close_container` | `intent` | Closes current window; safe when already closed |
| `eat` | optional `item`, `intent` | Consumes carried food; omitted item picks first edible stack |
| `attack` | `entity_id`, `intent` | Attempts one attack; observe again to determine damage/outcome |
| `use_item` | optional `item`, `intent` | Equips if specified, activates held item for 500ms and releases it |
| `report_intention` | `summary` | Logs public narration |
| `say` | `message` | Sends up to 200 characters of local Minecraft chat |
| `finish_session` | none | Completes experiment and finalizes recording/events |

For smelting, open a furnace, deposit input and fuel into their respective slots,
poll `container`, withdraw completed output, then close the container. Unknown
fuel/progress values mean the server has not supplied those updates yet. Empty
input, invalid smelting material/fuel and a blocked output can prevent progress.

### Stop and finalize without continuing the agent

```sh
npm run session:control -- completed  # objective finished
npm run session:control -- stopped    # incomplete, gracefully stopped
npm run session:control -- aborted    # failed experiment; preserve artifacts
```

These commands ask the running MCP process to stop accepting actions, drain an
in-flight action and finalize recordings/events. Wait for it to exit before reset.
They do not invoke the agent or force-kill a process. `finish_session` records
`completed`; SIGINT/SIGTERM or transport closure records `stopped`. Recorder errors
and unresolved actions record `aborted`. Finalization runs once, even when requests
race. Sessions without video still write logs under `data/mcp-sessions/`.

Reset refuses a live session lock even when camera ports are closed. Dead-owner
locks are reclaimed; malformed locks or a reused live PID require manual inspection.
Restart MCP servers after installing this change so they participate in locking.
Never remove a live lock or reuse a recording folder. A forced OS kill cannot
finalize footage, but existing logs and raw camera intermediates remain available.

For Episode 002: finalize the prior session, reset with `--preset survival` and a
recorded seed, run preflight and the disposable integration suite, configure a new
agent/session with `make set-mcp AGENT_ID=agent-002 SESSION=episode-002`, then start
the experiment. Let the agent choose all resource, crafting and shelter decisions.
Use `session:control -- stopped` to end an incomplete run without another agent turn.

Limitations: observations are local and bounded, container support covers the
listed windows, and trade/enchant/brewing-specific interfaces are not implemented.
`use_item` supports a fixed short activation, not aimed bows or arbitrary charge
lengths. Doors may require manual opening before navigation. Water and complex
terrain can still produce no-path or timeout errors. Crafting confirms each batch
against server inventory and may fail after partial progress; inspect inventory
before retrying. The installed Mineflayer `_syncWindow` helper is used when present
to reconcile modern protocol crafting updates; output is checked even without it.
Canceled navigation can be retried. Other action timeouts block further actions
until finalization because protocol results may be uncertain. Recording/narration compatibility is covered by the existing planner
and production tests; this is not a guarantee of successful autonomous survival.
