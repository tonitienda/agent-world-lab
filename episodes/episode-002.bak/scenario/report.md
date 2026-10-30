# Constructed ravine course (ravine-v1)

Hand-authored bundle for Episode 002. It replaces a level-designer call and wraps
the existing course in `src/environments/minecraft/ravine.ts` (see
docs/ravine-course.md), so the emergence CLI rebuilds exactly the legacy course.

After a fresh survival reset, install calls `prepareRavine`: it fixes daylight,
weather, random ticks and mob spawning, fills the course volume (-12,71,-16)..(27,127,16),
cuts the 8-wide, 24-deep gap at x=4..11, places the gold 3x3 pad centred at
(15.5,96,0.5), the emerald pillar at (18,96..99,0) and two oak trees at (-1,96,-5)
and (-6,96,6), then puts `emergence-player` at (2.5,96,0.5) facing east in survival
with full health/food and an empty inventory. There is no prebuilt crossing.

Automated verification reconnects without rebuilding, checks every block in the
course volume, the start position/facing/mode/health/food/inventory, the required
adapter capabilities and recorder prerequisites. Preflight separately checks seed
and generator. Terrain outside the course still depends on seed 20261027.

Manual review is still required: whether bridging with the supplied wood or
walking around the gap's ends is realistic for the agent, landmark visibility in
the cameras, and fall danger. These checks do not prove an autonomous agent can win.
