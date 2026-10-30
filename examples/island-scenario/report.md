# Constructed island example

This hand-authored example is an alternative to a paid level-design harness call.
It builds real blocks after a fresh survival reset, and uses the same install,
verification, code approval and snapshot contract as generated scenarios.

The player starts with empty inventory at (0.5,80,0.5). The mainland gold marker is
at (40,79,0), with an objective position (40,80,0). The goal prompt names those
coordinates because the current agent observes a local block scan rather than a
rendered panoramic image. Four oak logs can supply boat materials; four apples
are in a reachable barrel. The water surface offers another plausible route.
Natural terrain outside the constructed area is intentionally retained.

Automated verification reads actual blocks, inventory, food, health and mode,
opens the food barrel, checks capabilities and recorder dependencies, then closes
the player connection. Preflight separately inspects the seed and generator.

Manual review is still required for challenge quality, interesting alternative
routes, visual landmark clarity, recorder appearance, and pathfinder swimming
limitations. These checks do not prove that an autonomous agent can win.
The final video still needs a reviewed v2 edit plan and supplied narration audio.
