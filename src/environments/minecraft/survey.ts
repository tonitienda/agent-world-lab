import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";

export const surveyLimits = {
  usesPerSession: 1,
  horizontalRadius: 16,
  below: 8,
  above: 12,
  maxMaterialGroups: 64,
  maxSamplesPerMaterial: 8,
} as const;

type Point = { x: number; y: number; z: number };
type Material = { name: string; visibleCount: number; min: Point; max: Point; samples: Point[]; nearest: number };

/** Reads only loaded blocks visible from the player's current eye position.
 * Groups by material so a large stone floor cannot crowd trees out of the result.
 * Bounds summarize visible blocks; they do not describe a solid filled volume.
 */
export function surveySurroundings(bot: Bot) {
  const center = bot.entity.position.floored();
  const materials = new Map<string, Material>();
  let loadedPositions = 0, unloadedPositions = 0, visibleBlocks = 0;
  for (let dx = -surveyLimits.horizontalRadius; dx <= surveyLimits.horizontalRadius; dx++)
    for (let dz = -surveyLimits.horizontalRadius; dz <= surveyLimits.horizontalRadius; dz++) {
      if (dx * dx + dz * dz > surveyLimits.horizontalRadius ** 2) continue;
      for (let dy = -surveyLimits.below; dy <= surveyLimits.above; dy++) {
        const position = center.offset(dx, dy, dz);
        const block = bot.blockAt(position);
        if (!block) { unloadedPositions++; continue; }
        loadedPositions++;
        if (["air", "cave_air", "void_air"].includes(block.name) || !bot.canSeeBlock(block)) continue;
        visibleBlocks++;
        const p = { x: position.x, y: position.y, z: position.z };
        const distance = position.distanceSquared(center);
        let group = materials.get(block.name);
        if (!group) {
          group = { name: block.name, visibleCount: 0, min: { ...p }, max: { ...p }, samples: [], nearest: distance };
          materials.set(block.name, group);
        }
        group.visibleCount++;
        for (const axis of ["x", "y", "z"] as const) {
          group.min[axis] = Math.min(group.min[axis], p[axis]);
          group.max[axis] = Math.max(group.max[axis], p[axis]);
        }
        group.nearest = Math.min(group.nearest, distance);
        group.samples.push(p);
        group.samples.sort((a, b) => center.distanceSquared(new Vec3(a.x, a.y, a.z)) - center.distanceSquared(new Vec3(b.x, b.y, b.z)));
        group.samples.length = Math.min(group.samples.length, surveyLimits.maxSamplesPerMaterial);
      }
    }
  if (!loadedPositions) throw Error("Survey unavailable: no loaded terrain; the one-use allowance was not spent");
  const groups = [...materials.values()].sort((a, b) => a.nearest - b.nearest || a.name.localeCompare(b.name));
  return {
    position: { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z },
    limits: surveyLimits,
    coverage: { loadedPositions, unloadedPositions, visibleBlocks, totalMaterialGroups: groups.length, omittedMaterialGroups: Math.max(0, groups.length - surveyLimits.maxMaterialGroups) },
    materials: groups.slice(0, surveyLimits.maxMaterialGroups).map(({ nearest, ...group }) => group),
    interpretation: "Visible loaded blocks only, not an X-ray or a route recommendation. Material bounds summarize visible blocks, not solid volumes. Samples are bounded; absence does not prove a resource is absent beyond the scan or behind terrain.",
  };
}
