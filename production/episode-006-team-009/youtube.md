# episode-006-team-009 — YouTube packaging

Video: `production/output/episode-006-team-009.mp4` (3:16, 3840×2160, 60 fps).
Chapter times come from the final `edit-plan.json` (195.55 s), not from raw event times.

## Title

Recommended:

**Can Claude and Codex Work Together in Minecraft?**

Alternatives:

- Claude and Codex must reach a Minecraft shrine together
- One AI has the wood, the other knows the shrine: Claude + Codex in Minecraft

## Description

```
Two AI agents, one Minecraft world. Ada is played by Claude and Bram by Codex. A deep gorge splits them, and the shrine on the far bank only counts when both stand on its twin pedestals at the same time.

Neither can do it alone. Ada has the only wood in the valley. Bram knows how the shrine works: a pressure plate lifts its causeway, but only while someone stands on it. They have to share what they know through chat.

Watch Ada fell a cherry tree and bridge the gorge while Bram holds the plate. Then Ada finds a second plate inside the shrine that keeps the causeway up for Bram, and the two line up on the pedestals together.

This is The Agent Terrarium: experiments exploring how AI agents plan, use tools, make mistakes and adapt inside simulated worlds.

Chapters
0:00 Two agents, one shrine
0:16 Ada gathers cherry wood
0:55 Bram finds the causeway plate
1:07 Bridging the gorge
1:32 "No path": testing the causeway
1:53 Inside the shrine
2:12 Bram crosses
2:28 Climbing the twin pedestals
2:39 Centring up and finishing together

About the experiment
Each agent gets its own half of the briefing, then chooses its own actions through Minecraft tools and structured observations. They cannot see each other's thoughts or tool calls, only the messages they send. The camera footage is for the viewer; it is not supplied to the agents. The agents' voiced lines are their own recorded public intentions.

Episode 006 | The Agent Terrarium

Which pair should we drop in next? Tell us in the comments.

#Minecraft #ClaudeAI #AIAgents
```

## Tags

```
Claude, Codex, Claude AI, Anthropic, OpenAI Codex, Claude vs Codex, Claude and Codex, multi-agent AI, AI agents cooperate, AI teamwork, Minecraft AI, AI plays Minecraft, autonomous AI agent, agentic AI, LLM agents, Minecraft redstone, Minecraft puzzle, Mineflayer, The Agent Terrarium, AI experiment
```

## Notes

- Chapters start at 0:00. Every chapter is at least 10 seconds, as YouTube requires. The 7.8 s outro is folded into the last chapter.
- End screen: place its elements over the outro card, 3:08–3:16.
- No music and no game audio, so there are no credits to copy.
- This file is local upload copy. Nothing here changes YouTube.

## Private evidence notes — not part of the description

- Source: `episodes/episode-006/runs/team/take-009/run.json`, objective `success`.
  - Ada: event 167, trusted position (37.5, 97, −3.35), 3.853 from the pedestal.
  - Bram: event 61, (35.5, 96, 4.52), 4.596. Both within the 5-block radius.
- Don't name model variants. `episode.yaml` records `configured-default`, and `run.json` has an empty `model`. Bram's Codex log prints `gpt-6.1-sol`, but Ada's variant was not recorded, so the copy names neither.
- The shrine has no visible reaction in the recording. Don't say it lit up or opened. "Line up on the pedestals together" is what the objective check verified.
- "The only wood in the valley" is quoted from Ada's briefing ("As far as you can tell"), so the description presents it as what she was told.
- The chat between the agents is paraphrased by the presenter in the cut, not shown on screen. Don't promise "watch their conversation".
