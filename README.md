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

Not implemented yet: unattended model orchestration, multiple bots, replay/video recording, world reset/snapshots, cost limits, guaranteed visual perception, or automated integration CI. Do not mistake local smoke tests for successful end-to-end Minecraft testing until you run them.

## Licenses and content

Minecraft software and artwork remain subject to Mojang/Microsoft terms. The repository does not distribute Minecraft binaries. The server image downloads the game files only after EULA acceptance. Check individual asset and music licenses before publishing videos.

## Record a test for YouTube

See [the recording guide](docs/recording.md). Start a replay-capable Java client locally before running:

```sh
npm run record -- npm run integration
# Once the bot-actions smoke test is merged:
npm run record -- npm run bot-smoke
```

This creates timestamped process event logs under `data/recordings/`. Video must be captured independently using a client replay mod or OBS; CI does not produce footage.
