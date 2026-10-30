# Scenario: The Elevated Forest

Create a Minecraft survival scenario where an autonomous agent must cross a deep ravine to reach a clearly marked destination.

## Environment

The agent starts on one side of a ravine approximately 10–12 blocks wide and at least 15 blocks deep.

The opposite side contains a clearly visible destination marker.

There must be no natural bridges, nearby crossings, or easy routes around the ravine.

### Elevated forest

Near the starting area, create a natural-looking elevated plateau approximately 5–7 blocks above ground level.

- Place 3–4 oak trees on the plateau.
- The trees must be inaccessible from ground level.
- The plateau must not have a natural staircase or walkable path leading to it.
- The plateau should be reachable by constructing stairs, platforms, or another structure using available resources.
- The trees must provide enough wood to construct a bridge across the ravine.

Position the plateau so that the trees are visible from the starting area.

### Starting area and resources

- The agent starts with an empty inventory.
- Provide accessible dirt or stone blocks that can be mined and used for construction.
- Make gathering enough ground-level materials to bridge the ravine directly significantly less practical than reaching the elevated forest.
- No other trees or easily obtainable wood should be available.
- Do not use invisible barriers, artificial movement restrictions, or unbreakable blocks to force a particular solution.

## Intended challenge

The scenario should encourage the following sequence of discoveries and actions:

1. Recognize that the ravine cannot be crossed directly.
2. Identify the elevated forest as a useful source of building materials.
3. Gather resources and construct a way to reach the plateau.
4. Climb onto the plateau and collect wood.
5. Use the collected resources to construct a bridge.
6. Cross the ravine and reach the destination.

This is an intended solution, **not a mandatory sequence**. Creative alternative solutions should remain valid.

## Visual design

The scenario will be recorded for a YouTube video.

- Make the ravine visually impressive and clearly dangerous.
- The elevated forest, starting area, and destination should be easy to distinguish.
- Make the plateau look integrated into the natural terrain, with exposed rock, dirt, and grass.
- Avoid unnecessary structures or visual clutter.
- Ensure enough open space around construction areas for the observer camera to capture the agent's actions.
- The initial view should communicate the challenge without revealing its solution.

## Difficulty and constraints

The scenario should require several meaningful decisions rather than one obvious action.

Aim for a challenge that an autonomous agent can reasonably complete in approximately 10–20 minutes of gameplay, although actual completion time may vary.

Avoid making the scenario difficult through excessive resource grinding, hostile mobs, darkness, or random hazards.

The primary challenge should be **planning and executing a sequence of dependent actions**.

## Success condition

The scenario is completed when the agent physically reaches the marked destination on the opposite side of the ravine.

All actions must be possible using the agent's available Minecraft tools and legitimate survival-mode mechanics.

The environment should be deterministic and reproducible, allowing multiple independent agents to attempt exactly the same challenge.
