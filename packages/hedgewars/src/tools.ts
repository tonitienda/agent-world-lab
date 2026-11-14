import {z} from 'zod';
import type {Command} from './engine.js';

const narration = z.string().min(3).max(200).describe('One short public first-person line for viewers about what you are trying to do');
const direction = z.enum(['left', 'right']);

/** The tools one seat (one team) sees. The same definitions feed the MCP adapter and the session. */
export const toolDefinitions = {
  observe: {
    description: 'See the battlefield without acting: every hedgehog with its position and health, the wind, whose turn it is, and a text map of the terrain. '
      + 'Coordinates are map pixels; x grows to the right and y grows DOWNWARDS.',
    schema: z.object({}),
  },
  wait_for_turn: {
    description: 'Wait until it is your team\'s turn (or the match ends). Returns the same view as observe plus what happened since your last action. Call this after every shot. '
      + 'A hedgehog knocked into the water drowns at once. After 15 rounds sudden death begins: every hedgehog loses 5 hp at the start of each turn, down to 1. '
      + 'When you call it right after your shot, give a reaction to how that shot turned out.',
    schema: z.object({
      reaction: z.string().min(3).max(200).optional()
        .describe('One short public first-person line for viewers reacting to the result of your last shot: a hit, a miss, a kill, or hurting your own hedgehog'),
    }),
  },
  shoot: {
    description: 'Fire with your current hedgehog. This ends your turn. Returns where each projectile landed, how far that was from the nearest enemy, and all damage dealt. '
      + 'Shells and grenades fly in an arc under gravity; the bazooka shell is also pushed by the wind, the grenade is not. Explosions destroy terrain and can hurt your own hedgehogs.',
    schema: z.object({
      weapon: z.enum(['bazooka', 'grenade']).default('bazooka'),
      direction,
      elevation: z.number().min(-90).max(90).describe('Aim in degrees above the horizon: 0 = flat, 45 = diagonal up, 90 = straight up, negative = downwards'),
      power: z.number().min(1).max(100).describe('Launch power in percent of the maximum'),
      fuse: z.number().int().min(1).max(5).optional().describe('Grenade only: seconds before it explodes (default 3)'),
      narration,
    }),
  },
  walk: {
    description: 'Walk your current hedgehog. Does not end your turn. Hedgehogs walk about 60 pixels per second and cannot climb steep slopes; walking off a ledge causes fall damage or drowning.',
    schema: z.object({direction, seconds: z.number().min(0.1).max(5), narration}),
  },
  jump: {
    description: 'Jump with your current hedgehog. Does not end your turn. "long" covers ground forwards; "high" goes up and slightly backwards.',
    schema: z.object({direction, kind: z.enum(['long', 'high']), narration}),
  },
  skip: {
    description: 'End your turn without shooting.',
    schema: z.object({narration}),
  },
} as const;

export type ToolName = keyof typeof toolDefinitions;
export type ToolArgs<T extends ToolName> = z.infer<(typeof toolDefinitions)[T]['schema']>;

/** Engine angle: 0 = straight up, 1024 = horizontal, 2048 = straight down. Engine power: ticks of holding fire, 1..1500. */
export function toEngineShot(args: ToolArgs<'shoot'>): Extract<Command, {kind: 'shoot'}> {
  return {
    kind: 'shoot', weapon: args.weapon, facing: args.direction,
    angle: Math.round((90 - args.elevation) / 90 * 1024),
    power: Math.max(1, Math.round(args.power * 15)),
    ...(args.weapon === 'grenade' ? {timer: args.fuse ?? 3} : {}),
  };
}
