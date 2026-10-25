# Emergent — standard episode workflow

This checklist is the expected process for each **Emergent** video. The agent's decisions and the original recordings are the source of truth. The editing system may shorten and explain events but must not fabricate actions or outcomes.

## A. Define the experiment

1. Create an episode ID (e.g., `episode-001-rerun`) and write the exact objective/prompt in `prompt.md`.
2. Choose the model and CLI harness (Claude Code, Codex CLI, etc.) and record their versions, permitted tools, any turn/time budget, and Minecraft world configuration.
3. Create a **fresh recording directory**. Do not overwrite the first attempt. Preserve the original run as a baseline.
4. For an **isolated rerun**, first stop the old MCP session with `finish_session` and ensure camera MP4s are finalized. From the repo root, run `npm run world:reset` to preview the operation, then `npm run world:reset -- --yes` to archive the existing Minecraft server data and launch a fresh positive-Y superflat world. Set `EULA=TRUE` in `.env` after accepting the Minecraft EULA. The command stops the server but refuses to reset while default recorder ports 3007/3008 are active. Prior worlds are archived under `data/world-archives/<timestamp>/` and recordings under `data/mcp-sessions/` are untouched. The reset replaces the entire Minecraft server data directory, including configuration; archived data is preserved. Verify `docker compose ps` afterward.

## B. Capture the experiment

1. Configure the harness's **stdio** MCP server with `RECORD_MP4=/absolute/path/to/data/mcp-sessions/<episode>/agent-pov.mp4`, unique `AGENT_ID`, and working directory pointing to this repo. The MCP process starts the Minecraft bot and both cameras.
2. Start/restart the CLI harness after configuring MCP. Use `world_info` and `observe` to confirm the agent is connected.
3. Every **`move_to`**, **`mine`**, and **`place`** call now requires an **`intent`** sentence. The MCP server records that sentence automatically as `report_intention` before executing the action. The agent may still call `report_intention` explicitly for bigger strategy changes. This is declared public commentary, *not* hidden model reasoning.
4. Let the agent use the Minecraft tools autonomously. Avoid coaching or altering the world after the run starts.
5. Agent calls **`finish_session`** at the end; wait for both MP4 conversions to complete. SIGINT/SIGTERM to the MCP process is the fallback; do not SIGKILL.
6. Save the harness's prompt and a brief run report (model, CLI version, exceptions, human interventions, approximate tokens if reported).

### Re-run Episode 001 prompt

> You are an autonomous agent inside Minecraft. Explore your immediate surroundings, try to find something interesting, and collect it if safe. You have at most eight Minecraft action decisions; observations and inventory checks are allowed. Interact exclusively through agent-world MCP tools; do not edit the repository or run external commands to affect Minecraft. Include a brief, natural first-person `intent` sentence in **every movement, mining, or placement action** describing what you're trying to accomplish and why. Don't simply read tool names aloud. You may call `report_intention` separately when changing overall strategy. These statements are public summaries for viewers, not private reasoning. When finished, call `finish_session` and summarize the experiment.

This repeat deliberately keeps the objective comparable to the first run. The new agent run is not guaranteed to repeat the same decisions.

## C. Check the raw materials

- Verify `agent-pov.mp4`, `observer.mp4`, `metadata.json`, `events.json` and `mcp-session.json` exist and are nonempty.
- Run `ffprobe` and `python3 scripts/check-video.py` on **both** MP4s.
- Watch each perspective around walking, digging, and descent. Check if the observer remains near the bot; note any magenta geometry, horizontal seams or missing models.
- Inspect the timestamps in `metadata.json` (camera `captureOpenedAt` and `readyAt`) and compare them against the events log. Camera-to-video alignment is still **estimated**, not frame exact. If timing is visibly wrong, adjust the edit plan manually.
- Preserve unedited footage and event logs. A failed or uninteresting run can still be useful and must not be misrepresented.

## D. Prepare the edit

From the repo root:

```bash
npm run episode:plan -- data/mcp-sessions/episode-001-rerun
cd production
npm install
npm run dev
```

This creates `production/generated/edit-plan.json`, copies camera assets into `production/public/media/`, and produces one `narration.txt` (one sentence per line) and `narration-manifest.json`.

In the Motion Canvas editor, review the visual chronology: intro, observer establishing shot, selected POV closeups or split/PiP for interactions, and the reusable outro. Check every transition against the actual events. Do **not** pretend there are multiple independent agents when two cameras are showing the same bot.

## E. Write and record narration

1. Review `production/generated/narration.txt`. The agent's first-person `report_intention` statements are the primary commentary; edit for clarity without adding claims the agent never made. Intro/outro remain neutral.
2. Generate **one voice file per line** in ElevenLabs, numbered `001.mp3`, `002.mp3`, etc. Store them under `production/generated/narration-audio/` and check the mapping in `narration-manifest.json`. Listen for pronunciation and pacing.
3. Keep a consistent licensed background music asset and reusable outro; lower music while narration plays.
4. **Current limitation:** Automatic audio placement, ducking and final MP4 export are not implemented in this repository. Assemble the narration/music manually until a later verified production PR adds them. Do not treat Motion Canvas preview as the finished master.

## F. Review and publish

1. Verify the final video against the raw event log, camera timing, narration and visual continuity. Check loudness, captions/text readability, video duration and export resolution.
2. Disclose the agent/model, original objective, tool limitations (structured observations rather than visual input), and any human intervention or rerun.
3. Prepare title, description, chapters if useful, and a pinned comment inviting viewers to propose future prompts/scenarios. Use end-screen space for video recommendations in the reusable outro.
4. Keep raw MP4s, events, prompt, edit plan, narration texts/audio, source music credits and final render together for future reproducibility.

## Recorder changes in this iteration

- Third-person browser applies zoom-in wheel actions before each recording; verify actual improvement on macOS.
- Removed the forced downward bot view at initialization. A magenta object in the old POV image may be a rendering artifact or placeholder model; **its cause is not established**. Do not imply this PR definitively fixes it.
- Metadata now includes per-view `captureOpenedAt` and `readyAt`. The editor uses approximate offsets. Playwright video encoding startup is not frame-accurate; avoid multi-agent synchronization claims.
- The `report_intention` MCP tool records short public summaries. It does not access or store the model's hidden reasoning.
