# The Elevated Forest

The installer builds a deterministic stone ravine with a six-block-high, rooted grass-and-rock mesa on the starting bank. Three oak trees provide 16 logs, convertible into 64 planks without a crafting table. Six accessible dirt blocks allow a pillar beside the mesa. The destination is a gold landing pad centered at (15.5,96,0.5), with an emerald pillar behind it. The exact evaluation identifier is `gold-landing-pad`.

The player starts at (2.5,96,0.5), facing east, with empty inventory, full health and food, and survival mode. Noon, clear weather, peaceful difficulty, disabled spawning and random ticks remove incidental hazards. Leaves persist. The installer saves world and player state; snapshot restoration must restore that saved state without rerunning installation. Disconnect the player and include the complete world/player data in the operator snapshot.

## Prompt alignment

The current player goal matches this implementation: spawn (2.5,96,0.5),
ten-block gap x=4..13 extending z=-192..192, bottom y=71, destination
(15.5,96,0.5), and elevated oak trunks beginning at y=102 at (-4,-4),
(-6,5), and (-7,0). It correctly identifies the six initial dirt blocks at
x=-1..0, y=95, z=-2..0. The earlier briefing's ground-level wood coordinates
and short ravine bounds have been replaced. The goal describes public facts
without supplying a required route. It does not impose the old 80-action budget.
Future goal changes must remain consistent with the frozen geometry.

The ravine extends z=-192..192. The constructed banks extend x=-48..3 and x=14..48. Terrain outside this corridor remains seed terrain; a very long detour is intentionally possible. There are no barriers, bedrock additions or movement restrictions. The mesa has vertical sides and no staircase. Its trees cannot be harvested from the starting floor by ordinary survival reach.

## Resource and route assumptions

The starting floor is stone with only six exposed dirt blocks nearby. Bare-hand stone mining yields no building item. Six dirt blocks can raise the player to mesa height; dirt and grass on top remain legitimate additional resources. Oak logs provide ample bridge material and optional wooden tools. A representative route uses six dirt mining actions, six placements, several movement actions, three or four harvested logs, inventory crafting and roughly ten bridge placements. The exact total and feasibility with the actual movement/placement tools must be playtested; the current goal has no action-count limit. Crafting must be available through the existing survival tool interface even though it is not one of the four manifest capability identifiers.

Creative alternatives remain valid, including collecting accessible mesa material by another method, building different access structures, or taking a distant detour. There is no mechanism enforcing the intended order. A fall to the bottom is dangerous; peaceful difficulty prevents mobs and food management from becoming the challenge.

## Validation and remaining review

Entity cleanup is restricted to the construction corridor at x=-48..48,
y=71..319, z=-192..192 and excludes players. It does not clear entities elsewhere.
Spawn has a 45-second deadline, chunk loading has a 30-second deadline, and
disconnect forces the connection closed after three seconds if graceful quit
stalls. Console acknowledgements also clear their timers/listeners on failure.
These safeguards do not establish challenge solvability or recorder integration.

Run install and verify sequentially with the agent disconnected. Both scripts use the same player account and close their connections. Install uses Docker console commands with argument arrays and acknowledgement messages. Verify performs read-only world/player checks and writes the required validation JSON, including failure details. It never reconstructs blocks or resets the player. It checks the actual destination, resources, central gap, persisted player state, Mineflayer primitives and basic camera prerequisites.

The repository Minecraft preflight must still establish actual agent-tool and recorder integration. The recorder flag establishes only inspected scene/protocol prerequisites; it does not claim a successful recording. Verify intentionally reports reachability as manual review required. Inspect the full corridor for unexpected edge crossings, confirm the initial view presents the destination and elevated trees clearly, check peripheral terrain and camera framing, and trial the access/wood/bridge route with the actual agent tools and recording time limit. Measure completion time with an autonomous agent before claiming the requested 10–20 minute difficulty. The limited visual dressing keeps the crossing and construction areas readable, but final naturalness and plateau silhouette require in-game visual review.
