# Writing episode prompts

Treat `episode.yaml`, `level-design.md`, and `goal.md` as one specification.
Revise them together when the challenge changes. The designer receives the two
prompts plus the resolved environment and evaluation configuration. The player
receives only `goal.md` and its world tools; it cannot read the designer's notes.

| File | Audience | What belongs here |
| --- | --- | --- |
| `episode.yaml` | Orchestrator and designer | Environment, target identifier, evaluation radius, harnesses, recording time limit |
| `level-design.md` | Designer and operator | World construction, resource economics, intended decisions, alternatives, verification, camera readability |
| `goal.md` | Playing agent | Objective, truthful starting information, permitted actions, public constraints, stopping instructions |

## Start with the experiment

Write one sentence describing the decision you want to observe. For example:
“Will the agent invest in reaching an elevated wood supply before crossing a
ravine, or find a cheaper alternative?” This permits a direct bridge to be a
valid outcome. “The agent must climb to the trees first” is a different experiment
and requires a corresponding rule and evaluator if sequence is to determine success.

Separate requirements from preferences. State which measurements are exact,
which are ranges, and which the designer may choose. Avoid two different coordinate
maps across the files. If you fix destination coordinates in the goal, require the
installer and manifest to use those same player-feet coordinates. If the designer
chooses coordinates, inspect the generated manifest and update the public goal
to match before approving installation or freezing.

## Level design template

```md
# Scenario: <name>

## Experiment
<One question about the player's decisions.>

## Required starting state and geometry
- Survival mode, empty inventory, full health and food.
- Spawn and facing: <fixed coordinates/direction, or explicitly designer-chosen>.
- Destination: <marker and location; exact evaluation.target key from YAML>.
- Geometry: <gap, heights, bounds, access routes and fall consequences>.
- Reproducibility: <fixed seed, time, weather and permitted hazards>.

## Resources and mechanics
- <Resource, approximate quantity, placement, tools required and collectibility.>
- <What can be gathered with empty hands to bootstrap crafting/building?>
- <Approximate costs of reaching resources and then reaching the destination.>
- <Natural alternatives, shortcuts and recovery after mistakes.>

## Intended decisions
<What the player should weigh; distinguish a plausible route from a required route.>
Creative alternatives remain valid if they meet the public objective.

## Player knowledge
<What the goal reveals and what the actual observation tools can discover.>
<Any fixed coordinates or landmarks that must agree with goal.md.>

## Recording
<Recognizable start/destination, readable hazards and room for the follow camera.>

## Verification and manual checks
Verify actual spawn, inventory, resources, destination and bootstrap mechanics.
Register the destination under the exact evaluation.target identifier from YAML.
In report.md, estimate route costs, disclose shortcuts and explain assumptions
that need manual testing. Do not claim solvability from block checks alone.
```

Use concrete resource costs. A one-block-wide crossing of a 10–12-block gap takes
roughly that many placed blocks, with additional blocks for approaches or mistakes.
A six-block climb also consumes blocks, but dirt used to climb can often be
recovered. Ask the designer to compare both routes in its report. With accessible
minable ground, a direct dirt bridge may be cheaper than the intended forest route.
Either accept this as a legitimate strategy or change the physical tradeoff.
“Make it significantly less practical” alone does not specify that tradeoff.

For an empty-inventory start, make the first useful resource obtainable without
tools. Stone is breakable by hand but does not supply cobblestone without a suitable
pickaxe; it cannot substitute for accessible dirt as a bootstrap building material.
Do not rely on the agent discovering this through a stalled recording.

## Player goal template

```md
You are <brief starting situation>.
Your objective is to reach <unambiguous destination and location>.

You start with <true inventory/health and relevant initial facts>.
<Concise geography or resource locations the player is allowed to know.>

You may explore, mine, craft, build, and choose your own strategy.
<Only public rules that apply to this experiment.>

Use only the world tools. Give brief public first-person intentions before actions.
Observe after reaching the destination so your position is recorded.
Call finish_session when finished, including a clear explanation if you cannot
complete the challenge.
```

Describe the destination, not a procedure for reaching it. Resource hints are a
deliberate experimental choice: use the same hints for all compared players.
Avoid telling the player to climb, harvest, craft and bridge in order unless
following that procedure is the experiment.

## Player personality and spoken commentary

Put the player's narration personality in its public `goal.md`, after the
objective and stopping instructions. The runner deliberately disables Claude's
`CLAUDE.md` discovery; repository `AGENTS.md` instructions address implementation
agents and are not supplied to the experiment player. Do not rely on either file
to define the player's voice. The complete goal, including style guidance, is
saved and hashed with each take, so the narration conditions remain reviewable.

New episode goals include the `PlayerVoicePrompt` from
`internal/episode/starter.go`. Existing managed goals can use the same section;
episodes 002 and 003 already include it. Editing an existing episode's section
affects its next new take, including on a frozen scenario, without changing
previous takes or their narration recordings. Apply the same section across
providers when comparing agents.

The default voice is a curious, practical experimenter with occasional dry wit:
start with the useful thought, avoid repetitive “So”, “Okay”, “Alright” and
“I'm going to” openings, and keep routine action intentions around 3–8 words.
Explain meaningful discoveries and strategy changes more fully. Humor should
respond to an observed situation, with most lines left straightforward; avoid
forced jokes, catchphrases or actions staged to create a funny moment.
The world-tool `intent` description reinforces brevity and follows the goal's
personality, rather than demanding a long sentence for every repeated action.

For example, after a genuinely refused placement, “That spot is occupied. I'll
step aside.” supplies useful commentary. An occasional “Gravity remains
unimpressed” can suit a failed attempt, but repeating it at every setback becomes
another verbal tic. These are delivery examples, not required lines or hints
about how to solve a scenario. Never present a planned action as already successful.

Personality does not remove execution failures or long waits. Preserve meaningful
mistakes and recovery in the story, and trim uneventful waiting during editing;
do not fill every quiet moment with more commentary.

The current player receives structured local observations, not the camera video.
The block scan covers offsets of −3 to +3 in X/Z and −1 to +2 in Y, filters by
visibility, and returns at most 128 blocks. A tree six blocks above spawn can look
obvious to a human while being absent from the player's observation. Provide
truthful public geography or an accessible discovery route; camera visibility
alone is insufficient. Do not put essential navigation information only in the
private design document.

### Optional discovery with the one-use survey

The `survey` tool is available in new Minecraft sessions. The server enforces one
successful use for that session/take; it is not merely an instruction in the goal.
It scans a horizontal radius of 16 blocks, from 8 blocks below to 12 above the
player's floored position, using loaded terrain and the same line-of-sight checks
as normal observation. It does not turn the camera, move the player, mine blocks,
reveal hidden ore or return a solution. This is a panoramic visibility scan rather
than a camera image. It cannot see over an obstructing cliff just because its
height range includes the top. Normal `observe` remains unlimited at its existing
range and reports `survey.usesRemaining`.

The result groups visible blocks by material, with counts, coordinate bounds and
up to eight nearest samples per material. Up to 64 groups are returned, with an
explicit omission count if there are more. Bounds summarize visible blocks, not
solid volumes. Unloaded positions are counted and skipped. An empty visible scene
can still spend the survey; an unavailable scan with no loaded terrain does not.
An already-spent request is rejected without scanning again. The allowance lives
in the adapter, survives closing/reconnecting that adapter, and starts fresh with
a new session. Recorded-session folders cannot be reused to restart a take.

For a discovery-focused experiment, add this to the public goal:

```md
You have one use of the survey tool for a wider view of visible nearby terrain.
Choose when and where to use it. Normal observations remain unlimited.
```

You can omit exact resource coordinates when the resources have a fair discovery
route through observation or survey. Keep the destination unambiguous. Supply the
same information and tool allowance to every compared agent. When revising an old
experiment, record that survey became available; earlier takes without this tool
are not comparisons under identical tool conditions. Calls and public intentions
are recorded in events.json through the existing MCP logging path and can feed the
narration pipeline. The tool's schema requires a public `intent` before use.

## Match rules to enforcement

The current `reach_location` evaluator accepts a trusted observed player position
within the YAML radius of the manifest target. The radius is a 3D distance, not
an exact check that the player stands on a particular block. It accepts reaching
the location at any recorded observation, rather than requiring the player to
remain there at the end. Choose a radius that does not include the starting bank
or an unintended position below/alongside the destination.

“Without dying,” “at most 80 world-changing actions,” and “use the forest first”
are not enforced by this evaluator. The recording time limit is enforced, but a
natural-language action budget is only an instruction to the agent. For scored
rules, implement event-based enforcement/evaluation before claiming compliance;
otherwise label them as instructions and review the events manually. Do not invent
new YAML fields for unsupported rules.

## Before approval

- Compare every coordinate, resource claim and rule across all three files.
- Read the generated manifest, installer, verifier and report. Confirm the
  destination identifier and coordinates match the YAML and public goal.
- Check bootstrap resources, affordable routes, shortcuts and recovery options.
- Inspect the world preview for geography and recording clarity. Separately check
  whether local observations can reveal what the player needs.
- Decide which conditions are automatically scored and which need human review.

World, level-design and evaluation changes after freezing require a new episode
ID; the frozen scenario is immutable. You may edit the player goal and run a new
take against that same frozen world. Each take saves its exact goal in `goal.md`
and `run.json`, with a SHA-256 hash. Keep factual claims consistent with the frozen
world: changing the goal does not move resources or change the scored destination.
Changing prompt text does not redesign an existing scenario. Before freezing, an
already generated scenario is also preserved rather than automatically overwritten.
Use a new episode ID for a revised design, keeping older recordings reproducible.
See the [guided pipeline](guided-pipeline.md) for approvals and resume behavior.

## Review of Episode 002: The Elevated Forest

The revised `level-design.md` establishes a useful planning tradeoff and clearly
allows alternative strategies. The existing `goal.md` still describes the previous
scenario. Resolve these points before generating the new design:

| Issue | Decision needed |
| --- | --- |
| Design gap is 10–12 blocks; goal fixes x=4…11, an 8-block gap | Choose one geometry and use it throughout |
| Goal gives wood at y=96; design puts all trees 5–7 blocks above ground | Replace the old resource locations with truthful elevated-forest information |
| Goal fixes spawn, pad and marker coordinates; design leaves them open | Require those coordinates in the design, or update the goal after reviewing generated coordinates |
| Accessible dirt may make a direct bridge cheapest | Accept that outcome or specify a measurable resource/access tradeoff |
| “Dirt or stone” with empty inventory | Require a hand-collectible bootstrap resource; check stone tool requirements |
| Forest must be visually obvious | Also account for the player's limited local scan |
| Goal adds 80 actions and no deaths | Remove stale constraints or clearly separate instructions from automatically scored conditions |

The target identifier `gold-landing-pad` can stay even if the episode title changes.
It is the stable manifest key used for evaluation, not a required story title.
