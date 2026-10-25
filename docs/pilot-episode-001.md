# Pilot episode 001 — A small Minecraft expedition

This is a **real model-driven agent session**, not the scripted capture smoke test. It uses the existing Minecraft adapter and dual-camera recorder; its decisions are made by a configured chat-completions-compatible model endpoint.

## Episode prompt

> Explore your immediate surroundings. Try to find an interesting block, collect it if safe, and describe what you discovered.

The bot has eight decision turns by default, with a small pause after actions. It may fail or decide to stop: keep that behavior in the video. The model only receives structured observations and tool results, **not pixels from its camera**.

## Run locally

1. Install Node.js 22+, Docker, FFmpeg. Start the Minecraft server with a **positive-Y** world as in the CI video job. The default negative-Y superflat terrain caused invisible viewer recordings. The container's world data persists; generate a fresh disposable world to apply new generator settings.
2. `npm install`
3. `npm install --prefix packages/minecraft-recorder`
4. `npx --prefix packages/minecraft-recorder playwright install chromium`
5. Start Minecraft: `EULA=TRUE MC_LEVEL_TYPE=minecraft:flat GENERATOR_SETTINGS='{"biome":"minecraft:plains","layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:stone","height":70},{"block":"minecraft:dirt","height":2},{"block":"minecraft:grass_block","height":1}]}' docker compose up -d --wait minecraft` (ensure the server's existing world is already configured appropriately).
6. Supply a model credential **locally**, never commit it:

```sh
export AGENT_API_KEY="YOUR_KEY"
export AGENT_MODEL="gpt-4.1-mini"
npm run pilot-session
```

Override `AGENT_API_URL` for a compatible local or hosted chat-completions endpoint. `PILOT_PROMPT`, `PILOT_MAX_TURNS` (1–12), and `PILOT_OUTPUT_DIR` are optional. The model/provider may require a different model name or support different JSON-mode options; this runner expects `response_format: {"type":"json_object"}`.

The recorder runs Chromium/Playwright and FFmpeg, so the environment needs their system dependencies. See `packages/minecraft-recorder/README.md`.

## Artifacts

Each run saves a timestamped directory:

```text
data/pilot-sessions/<timestamp>/
  agent-pov.mp4
  observer.mp4
  agent-pov.webm
  observer.webm
  events.json
  metadata.json
  session.json
  agent-pov-debug.png
  observer-debug.png
```

`events.json` holds concise model decision summaries (not hidden reasoning), chosen tool actions, observations and outcomes, plus model usage if supplied. `session.json` contains the objective, model ID and timing; not API keys. Both camera recordings cover the same session, but their startup/record times can differ by seconds. For exact cross-camera synchronization, additional work is needed.

## Publishing test

Keep the video unpolished on purpose: title card, original objective, 5–15 seconds of ElevenLabs intro, then mostly continuous observer footage. Cut to agent POV when the action benefits from it. End with the outcome, including failed attempts.

Possible title: **I Gave an AI 8 Turns in Minecraft. Here's What It Did.**

Short intro narration:

> This agent has eight turns in Minecraft, and one simple objective: explore, find something interesting, and try to collect it. It can observe nearby blocks and choose actions, but it can't see the video you're watching. I haven't scripted its decisions. Let's see what happens.

Outro:

> That's the entire experiment. No retries, no hidden coaching. Next time, we'll give the agent a little more time — and a more interesting world.

Only say “no retries” if you actually publish the first unrerun result. Do not imply visual input: this bot uses structured observations rather than game video.

## Current limitations

This PR implements the session runner but cannot verify a **live AI-model session** in CI without a configured model endpoint and credential. It does not make footage visually appealing or add automatic editing. Review the footage and costs before publishing.
