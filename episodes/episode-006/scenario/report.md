# The Twin Shrine of Sakura Falls: scenario design report

Revision `twin-shrine-v1`. Two players:

- **ada** spawns on the west bank at (-6.5, 96, 0.5), facing east (yaw -90).
- **bram** spawns on the east bank at (18.5, 96, 0.5), facing west (yaw 90).

The target `twin-pedestals` is at (37.5, 97, 0.5), radius 5.

## Files

| file | role |
|------|------|
| `manifest.json` | spawn, per-player `spawns`, target and capabilities (observe, move_to, mine, place, craft, say, listen) |
| `implementation/world.mjs` | Pure, deterministic geometry: exported coordinates plus `worldCommands()`, which returns 1302 fill/setblock commands. No I/O and no `Math.random`; variation comes from a fixed-seed integer hash and smoothstep value noise. |
| `implementation/common.mjs` | Player list (`EMERGENCE_PLAYERS`, falling back to `AGENT_ID`), manifest and spawn lookup, batched console sender with tellraw acks, player reset |
| `implementation/install.mjs` | Builds the valley and prepares both players |
| `implementation/verify.mjs` | Reads the world back, runs a functional two-player redstone test, then restores both players |
| `implementation/lifecycle.mjs` | Verbatim copy of the trusted lifecycle helper from episode 002 |

## Install

1. Connect a bot for every player and park each in spectator at y=140 above its spawn.
2. Set gamerules: no daylight or weather cycle, no mob, patrol or trader spawning, no fire tick, randomTickSpeed 0. Set peaceful difficulty, `time set 9000` and clear weather.
3. `forceload add` the construction area (x=-40..56, z=-64..64), and remove it again at the end.
4. Run a bounded entity cleanup that excludes players and stays inside the construction volume:
   `kill @e[type=!minecraft:player,x=-40,y=61,z=-64,dx=96,dy=194,dz=128]`
5. Send the 1302 world commands in newline-joined batches of at most 40 lines or 3500 bytes. Each batch ends with a `tellraw` token, and install waits for it in chat before sending the next batch. Every fill stays at or under 32768 blocks.
6. Reset each player. Set the spawnpoint, clear the inventory, effects and XP, tp them to spawn with yaw and switch to survival. Give instant health and saturation, then clear effects and tp again.
7. Wait for chunks, then assert each player is within 0.2 of its spawn. Finally run `save-all flush`.

Install changes nothing outside x=-40..56, y=61..255, z=-64..64. The only global changes are `forceload` and `setworldspawn`.

## World layout

- **Valley base.** The construction box is cleared, and stone fills y=61..95. West-bank soil (x=-33..3) is dirt at y=92..94 with grass at y=95. The east bank is bare stone with andesite, tuff and calcite patches.
- **Gorge.** x=4..12, carved down to a calcite lake floor at y=75.
  - The lake is still source water at y=76..80 over z=-50..55. The falls massif seals z≤-51, and the mountain ring seals z≥56.
  - The walls have flush vertical streaks of tuff, calcite, mossy cobblestone and andesite, plus non-climbable glow lichen at y=82..92. The lichen is kept away from |z|≤18, the ladder and the falls. There are no vines.
- **Mountains.** Sheer 4x4 stone cells along x≤-34, x≥50 and |z|≥56, rising to y=120..135. The outer ring is 3 blocks higher than the inner ring. Tops at y≥127 get snow caps; tops at y≤121 get moss ledges.
- **Sakura Falls.**
  - A massif at x=-3..19, z=-55..-51, with its top at y=121 over the gorge.
  - A 3-wide notch at x=7..9 holds source water at y=118. It spills at z=-50 and falls 37 blocks into the lake. The falls never come near z=-6..6.
- **Pilgrim's ladder.** `ladder[facing=east]` at (4, 81..95, 40) against the x=3 wall. It continues as waterlogged ladders at y=76..80 so a swimmer can grab it. A wall post with a lantern at (2, 96..97, 38) marks it from the west rim. It is the only climbable on either wall, and it returns a player to the west bank only.
- **West bank (ada).**
  - Four cherry trees with 5-log trunks at (-12,-6), (-15,3), (-10,8) and (-18,-2), y=96..100. These 20 logs are the only wood in the valley.
  - Layered persistent cherry canopies at y=99..102, with drooping blossoms at y=98.
  - Pink petals, moss, 12 azalea bushes and foothill mounds.
  - A mossy stone-brick path runs from spawn to the rim along z=-1..1.
  - The rim lantern posts at (2, 96..97, ±5) are `stone_brick_wall`, not oak fences, which would be a second wood source.
- **East bank (bram).**
  - A stone-brick and mossy-stone-brick court at x=13..24, z=-11..11.
  - A calcite rim edge, and a calcite 3x3 marking P1.
  - Lantern posts at (14, 96..97, ±10) and (24, 96, ±2).
  - Rock terraces at x≈44..49.
  - No dirt, grass, moss_block, trees or wood items.
- **Twin Shrine** (x=25..42, z=-8..8).
  - **Base:** obsidian foundation at y=86..94 and a polished-deepslate floor at y=95.
  - **Shell:** deepslate tiles at y=96..102, with an obsidian lower band at y=96..99 on all outer walls and obsidian-cored side masses.
  - **Trim and roof:** calcite and oxidized-copper courses, and a stepped polished-deepslate, deepslate-tile and copper roof at y=103..109.
  - **Gate:** open doorway (25, 97..98, 0) on a `chiseled_deepslate` threshold at y=96, calcite lintel at y=99.
  - **Moat:** trench x=20..24, z=0. `chiseled_stone_bricks` causeway rests at y=94 on five `sticky_piston[facing=up]` at y=93 and rises to y=95 when powered. Deepslate-brick flank walls (21..24, 96..97, ±1) with lanterns.
  - **Antechamber:** x=26..31, z=-3..3, with three hanging lanterns. P2 sits on calcite at (30, 95, -3).
  - **Archway:** calcite, at x=31.
  - **Hall:** x=32..41, z=-7..7, with a calcite aisle down the middle.
  - **Pedestals:** calcite blocks at (37, 96, ±4). Each has a bottom-slab step at (36, 96, ±4) and a calcite stele with a lantern at (38, 96..97, ±4).
  - **Altar:** calcite, at x=40..41, z=-1..1, with a sea lantern on top.

## Redstone (all hidden, every cell enclosed)

```
CAUSEWAY (OR): P1 or P2 raises the moat causeway (20..24,95,0)

  P1 plate (20,96,4) on calcite (20,95,4)    P2 plate (30,96,-3) on calcite (30,95,-3)
  dust (20,94,4) -> (19,94,4..-1)            dust (30..26,94,-3) -> (26,94,-2)
              \-> bus (20..26,94,-1) <---------------/   (x=25 cut through obsidian)
  each bus dust weakly powers the stone it lies on (x,93,-1)
  -> sticky piston (x,93,0) beside it extends, lifting (x,94,0) to (x,95,0)
  Weakest bus cell from P1: 4; from P2: 3. Dust under a piston would not power it.

PEDESTALS (AND): only both plates light 8 lamps
  plate (37,97,±4) -> pedestal (37,96,±4) -> dust (37,95,±4) -> obsidian (37,94,±4)
  wall torch (38,94,±4) facing east (air pocket above, under the stele)
  either torch lights NAND line dust (39,94,-4..4) -> (40,94,0) -> obsidian (41,94,0)
  torch tower in the altar, x=41 z=0: torches at y=95,97,99,101,103
    rest states off/on/off/on/off; the y=103 torch = A AND B
  -> obsidian (41,104,0) -> attic dust at y=104 (columns x=33 and x=40, rows z=±6, spine z=0)
  -> redstone_lamp at y=103: (35,-6) (38,-6) (40,-3) (40,3) (38,6) (35,6) (33,3) (33,-3)
  The weakest lamp receives signal 4.
```

Placement order: structure, then wiring, lamps, attic dust and plates. Pistons are placed retracted, before the bus. Torches are placed in their rest states.

## Deviations from level-design.md

1. **Ladder.** It extends to y=76, with waterlogged cells at y=76..80, so a swimmer can grab it. It cannot be crafted back into planks.
2. **Gorge ends.** Gorge air runs z=-55..55, because the mountain ring at |z|≥56 forms the ends. The lake runs z=-50..55.
3. **Falls.** The massif top is y=121, with the water pool at y=118, so the pool has a lip.
4. **Pedestals.** Each has a calcite stele (hiding the inverter's air pocket) and a slab step.
5. **Lamps.** They are an octagon in the hall ceiling, not on the walls. A calcite altar hides the AND torch tower.
6. **Shrine walls.** They are one block thick, with an obsidian lower band. Nothing is unbreakable.
7. **Extra modules.** `world.mjs` and `common.mjs` let verify reuse install's exact coordinates. Console commands are sent in acknowledged batches.
8. **Verify moves players.** It teleports both players onto the plates for the functional test, then fully resets and re-checks them.
9. **Lanterns** are used instead of flower pots on the east bank.

## What verify measures

- **Spawn.** For both players: position and yaw, survival mode, 20/20 health and food, empty inventory, solid floor and clear body space.
- **Gorge.**
  - Clear air over the crossing, solid rims, and source water across the lake.
  - The waterlogged ladder faces east, and the walls have no other climbables.
  - The falls are where they should be, with no water near the crossing.
- **Shrine.**
  - Threshold, doorway air, flank walls, every piston and wiring cell and the torch rest states.
  - At rest: plates unpowered, causeway lowered and lamps dark.
  - Pedestals and steps, the obsidian gate wall and the target.
- **Functional (two players).**
  - P1 alone raises the causeway and it drops on release; the same for P2.
  - One pedestal leaves the lamps dark, and both light all 8.
  - Both players are reset, then spawn and rest state are re-checked.
- **Resources.**
  - Exactly 20 cherry logs, and no other wood in the construction box.
  - No soil on the east bank.
  - No barrier, bedrock, reinforced deepslate or command blocks.
- **Recorder.** The capability list, Mineflayer primitives, protocol 1.21.4 and clear camera points.

## Manual review still required

- **Not run on a live server.** The scripts were checked with `node --check` and run end to end against a mock server and voxel simulator, which do not simulate redstone or fluids. Redstone timing, door behaviour and waterfall flow are proven only by a real verify run. Batching also assumes that `mc-send-to-console` splits newline-joined commands into separate console lines. If it does not, install fails with an acknowledgement timeout.
- **Alternative routes.**
  - West-bank grass and dirt can be dug by hand and bridged, so wood is not the only crossing.
  - A wooden pickaxe makes the upper shrine shell breakable, so the gate can be bypassed by pillaring.
  - The twin pedestals still require two players at once, because stone plates ignore dropped items.
- **Visuals.** Canopy shape, mountain silhouettes, the falls' visibility from both spawns, and the ladder's sightline from the water need a camera pass.
