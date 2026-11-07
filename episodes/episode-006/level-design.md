# Scenario: The Twin Shrine of Sakura Falls

A two-player cooperative Minecraft survival scenario. Two autonomous agents,
**ada** and **bram**, start on opposite banks of a waterfall gorge. Neither can
finish alone: one holds the only wood in the valley, the other stands at the
doorway of a shrine that only opens for two.

Axes: +x is east, +z is south. "Floor" means the block a player stands on;
a player standing on floor y=95 has position y=96.

## The world (beauty brief)

A closed mountain valley at golden afternoon light. Everything the cameras see
should feel hand-crafted and calm, with one clear danger: the gorge.

- **Valley bowl.** Clear and rebuild x=-40..56, z=-64..64. Ring the valley with
  stone/andesite/tuff mountains rising to y=120–135 at the edges (x≤-34,
  x≥50, |z|≥56). Mountains must be sheer or overhanging. Players must not be able
  to walk around the gorge's ends. Cap the peaks with snow blocks and a few
  spruce-free ledges of moss. No floating blocks.
- **The gorge.** x=4..12 (9 blocks wide), z=-56..56, rim floor at y=95. Walls
  are stone with streaks of tuff, calcite and mossy cobblestone. Glow lichen
  and hanging vines on the walls are optional; they must not form a climbable
  ladder. Bottom is a turquoise lake: floor y=75, still water y=76..80. A fall
  lands in water and does not kill.
- **Sakura Falls.** At the north end (z≈-50..-56) a cliff rises to y≈118 and
  pours a 3-wide waterfall into the lake. It must be visible from both spawns
  and from the bridge site at z=0. Lily pads drift on the lake near the south end.
- **Pilgrim's ladder (fall recovery).** A ladder column on the WEST gorge wall
  at z=40 (ladders at x=4 attached to x=3, y=81..95), from the water to the west
  rim. It returns a fallen player to the **west** bank only, so the lake is not
  a shortcut to the shrine.
- **West bank: the cherry grove (ada).** Grass, moss and pink-petal carpets
  between x=-32..3. Four cherry trees with trunks rooted on floor y=95 at
  (-12,-6), (-15,3), (-10,8), (-18,-2). Each trunk is 5 `cherry_log[axis=y]`
  (y=96..100). Use a broad, layered `cherry_leaves[persistent=true]` canopy.
  Flowering azalea bushes, a mossy stone path from spawn toward the rim, and
  two lanterns on stone-brick wall posts (no wooden fences, since they are wood) at the rim near z=0. These are the **only
  logs in the valley**.
- **East bank: the shrine court (bram).** x=13..48. Stone-brick and mossy
  stone-brick court floor, no trees, no wood items, no dirt, no grass. A few
  flower pots and lanterns are fine, but they must not be convertible into
  building blocks.
- **The Twin Shrine.** A small temple of deepslate tiles and polished
  deepslate, trimmed with calcite and copper, at x=25..42, z=-8..8, walls y=96..102,
  with a stepped roof. The walls are obsidian-cored, so the gate is the sensible
  route (no unbreakable blocks).
  - **Gate**: an open doorway at (25, 97..98, 0) whose threshold sits one block
    above the court, behind a **moat**: a 1-wide trench x=20..24, z=0 flanked by
    low walls. At rest its floor is two blocks below the threshold (no way up).
    Five sticky pistons raise a causeway to court level while a plate is pressed.
    (An iron door was tried first; mineflayer-pathfinder treats iron doors as walls
    and a bot can break one by hand in about 25 s, so it was replaced.)
  - **Outer plate P1**: `stone_pressure_plate` at (20, 96, 4) on the court floor.
  - **Antechamber** x=26..31, z=-3..3, lit by lanterns.
  - **Inner plate P2**: `stone_pressure_plate` at (30, 96, -3).
  - The causeway is UP while P1 **or** P2 is pressed. Use hidden under-floor redstone.
  - Archway from the antechamber into the **Shrine Hall** x=32..41, z=-7..7.
  - **Twin pedestals**: two raised calcite pedestals (floor y=96) holding
    `stone_pressure_plate` at (37, 97, -4) and (37, 97, 4), each reachable
    by one step block. Hidden **AND** logic: only while BOTH are pressed, a ring
    of 8 redstone lamps around the hall lights up. A beacon beam is an optional
    flourish if it can be revealed deterministically.
- **Stone pressure plates** react to players only, not dropped items. This is
  what makes the relay require two players.

## Players and spawn

| player | spawn (position)     | facing | inventory |
|--------|----------------------|--------|-----------|
| ada    | (-6.5, 96, 0.5)      | east (yaw -90) | empty |
| bram   | (18.5, 96, 0.5)      | west (yaw 90)  | empty |

Both start in survival with full health and food. They can see each other
across the gorge at z=0.

## Intended co-op solution (not mandatory)

1. **Talk.** Each player knows only half the valley (see goal files). They must
   use `say`/`listen` to share what they see.
2. **Bridge.** Ada fells cherry logs (≥3), crafts planks (2x2, no table needed)
   and bridges x=4..12 at floor y=95 near z=0. Bram can spot from the far rim.
3. **Relay gate.** One player holds P1. The other walks across the causeway into the shrine,
   then stands on P2, which keeps the causeway up, and the first player walks in.
4. **Twin pedestals.** Both stand on a pedestal plate at the same time. The lamps
   light, and that is the shot for the video.

## Difficulty and constraints

- Peaceful, no mobs, no weather, frozen time (afternoon, about 9000 ticks), randomTickSpeed 0.
- No unbreakable or invisible blocks, no command blocks in reach.
- Target duration: 15–30 minutes of shared play.
- The hard part is **coordination**: waiting on a plate while the teammate moves,
  passing information both ways, and not finishing alone.

## Success condition

Both players reach the twin pedestals (target `twin-pedestals`, centre
(37.5, 97, 0.5), radius 5), as recorded by each player's trusted adapter
observations.
