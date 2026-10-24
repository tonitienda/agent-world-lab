/** Portable agent-facing tool surface. Adapters can offer different capabilities. */
export type ActionResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

export interface WorldAdapter {
  readonly id: string;
  readonly capabilities: readonly string[];
  connect(): Promise<void>;
  observe(): Promise<unknown>;
  act(action: string, args: Record<string, unknown>): Promise<ActionResult>;
  close(): Promise<void>;
}

export function requireCapability(world: WorldAdapter, action: string): void {
  if (!world.capabilities.includes(action)) {
    throw new Error(`World "${world.id}" does not support "${action}"`);
  }
}
