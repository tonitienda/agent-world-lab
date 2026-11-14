// Scripted stand-in for a model's aim, used by the spike and by the MCP self-test.
export type Point = {x: number; y: number};
export type Aim = {direction: 'left' | 'right'; elevation: number; power: number};

/**
 * Picks a bazooka shot from `me` at `foe`. Coordinates are map pixels with y
 * growing downwards. elevation: degrees above the horizon (45 = diagonal lob).
 * power: 1..100 percent. wind: -100..100, negative blows to the left.
 */
export function chooseShot(me: Point, foe: Point, wind: number): Aim {
  const dx = foe.x - me.x;
  // TODO(human): replace this fixed 45-degree lob with a better aiming rule.
  return {direction: dx < 0 ? 'left' : 'right', elevation: 45, power: Math.min(100, (250 + Math.abs(dx) * 0.9) / 15)};
}
