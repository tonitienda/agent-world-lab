# Record an MCP agent session (Codex CLI / Claude Code)

This workflow uses the **harness's own login/subscription**. Agent World Lab does not call a model API or need `AGENT_API_KEY`.

## Prepare

1. Start the Minecraft server with the positive-Y world described in `docs/pilot-episode-001.md`.
2. `npm install`, `npm install --prefix packages/minecraft-recorder`, and install Playwright Chromium according to `packages/minecraft-recorder/README.md`.
3. Choose a **new** recording directory for each run, e.g. `<absolute repo path>/data/mcp-sessions/episode-001`.

## MCP server configuration

Set your Codex or Claude MCP server to execute `npm run mcp` from the repository root, and supply:

```json
{
  "WORLD_ADAPTER": "minecraft",
  "AGENT_ID": "emergent-001",
  "RECORD_MP4": "/absolute/path/to/agent-world-lab/data/mcp-sessions/episode-001/agent-pov.mp4",
  "RECORD_WIDTH": "854",
  "RECORD_HEIGHT": "480"
}
```

These entries are **environment variables** for the MCP process, not a complete harness config. Configure the command, args and working directory according to your harness. If the process startup takes time, increase the harness MCP startup timeout: initializing all three Chromium cameras can take several seconds.

The MCP server starts the Minecraft bot and all three cameras when it connects. Do not launch the `pilot-session` API runner in parallel.

## Prompt to the local agent

> You control a Minecraft agent. Explore your surroundings, find an interesting block, and try collecting it. Make at most eight Minecraft action decisions. Use only the agent-world MCP tools to interact with Minecraft. Do not alter repository files. When you finish, **call the `finish_session` tool**, wait for it to report success, then summarize what you did. Do not claim to see the recording: your world observations are structured data, not live video.

## Output

Once `finish_session` returns success, the recording folder contains:

- `agent-pov.mp4`, `observer.mp4`, `follow.mp4`, and their WebM masters
- `events.json` — timestamped MCP tool calls and results, updated after each action
- `metadata.json` — recorder details
- `mcp-session.json` — shutdown metadata

`events.json` deliberately does **not** capture the model's private reasoning or chat conversation. It records observable MCP actions, arguments, responses and failures. The session prompt is kept by the harness; save it separately if you want it included in the episode.

New MP4s share an optical-gate-aligned event timeline. Precision is limited to browser capture frames; raw WebMs retain initialization lead-in. See `packages/minecraft-recorder/README.md` for recovery and camera limitations. Legacy recordings retain their original offsets.

## Fail-safe shutdown

If the harness can't call `finish_session`, send **SIGINT or SIGTERM to the MCP server process** and let the recorder finish. Do not use SIGKILL or force-quit the terminal: that can interrupt MP4 creation.

Afterwards run `npm run episode:plan -- /absolute/path/to/recording-directory`, then open `production/` for visual review.

This PR starts/stops recording with the **MCP server lifecycle** (not a separate independent `lab:start` daemon). The explicit tool is the supported clean end-of-session control.

### Claude startup timeout

The episode runner exports `MCP_TIMEOUT=180000` and
`CLAUDE_CODE_MCP_STARTUP_WAIT_MS=180000` for the Claude process. The backend
connects to Minecraft, waits for chunks, and initializes all three Chromium cameras
before exposing MCP tools. Claude's default 30-second connection deadline can kill
this startup after the first two cameras, leaving partial raw WebMs. Override these
environment variables before running the script if a slower machine needs more time.
Use `MCP_TIMEOUT`, rather than `MCP_TOOL_TIMEOUT`, to change connection startup.
Do not run a separate recording-enabled MCP health check against the same session
folder: that would create another capture and collide with the session lock.

For Episode 002, the runner now prepares and verifies the constructed
[ravine course](ravine-course.md) before launching Claude. `SCENARIO_FILE` opts an
MCP session into the verified start guard and exposes its goal through observations.
A normal survival reset alone does not prepare any challenge geometry.
