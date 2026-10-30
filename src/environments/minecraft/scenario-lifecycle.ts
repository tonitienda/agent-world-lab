import type { Bot } from "mineflayer";

/** Bound scenario setup waits and always clear the losing deadline timer. */
export async function withDeadline<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function waitForSpawn(bot: Pick<Bot, "once" | "removeListener">, ms = 45_000): Promise<void> {
  let spawned: () => void;
  let failed: (error: Error) => void;
  let ended: () => void;
  try {
    await withDeadline(new Promise<void>((resolve, reject) => {
      spawned = resolve;
      failed = reject;
      ended = () => reject(Error("Disconnected before spawn"));
      bot.once("spawn", spawned);
      bot.once("error", failed);
      bot.once("end", ended);
    }), ms, "Spawn timeout");
  } finally {
    bot.removeListener("spawn", spawned!);
    bot.removeListener("error", failed!);
    bot.removeListener("end", ended!);
  }
}

export async function closeScenarioBot(bot: Pick<Bot, "once" | "removeListener" | "quit" | "end">, ms = 3_000): Promise<void> {
  await new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); bot.removeListener("end", done); resolve(); };
    const force = () => { try { bot.end(); } catch {} finally { done(); } };
    const timer = setTimeout(force, ms);
    bot.once("end", done);
    try { bot.quit(); } catch { force(); }
  });
}
