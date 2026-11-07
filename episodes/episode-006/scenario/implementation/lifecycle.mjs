// Bundled copy of the trusted scenario lifecycle helper; included in artifact review.
/** Bound scenario setup waits and always clear the losing deadline timer. */
export async function withDeadline(task, ms, label) {
    let timer;
    try {
        return await Promise.race([
            task,
            new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); }),
        ]);
    }
    finally {
        clearTimeout(timer);
    }
}
export async function waitForSpawn(bot, ms = 45_000) {
    let spawned;
    let failed;
    let ended;
    try {
        await withDeadline(new Promise((resolve, reject) => {
            spawned = resolve;
            failed = reject;
            ended = () => reject(Error("Disconnected before spawn"));
            bot.once("spawn", spawned);
            bot.once("error", failed);
            bot.once("end", ended);
        }), ms, "Spawn timeout");
    }
    finally {
        bot.removeListener("spawn", spawned);
        bot.removeListener("error", failed);
        bot.removeListener("end", ended);
    }
}
export async function closeScenarioBot(bot, ms = 3_000) {
    await new Promise(resolve => {
        const done = () => { clearTimeout(timer); bot.removeListener("end", done); resolve(); };
        const force = () => { try {
            bot.end();
        }
        catch { }
        finally {
            done();
        } };
        const timer = setTimeout(force, ms);
        bot.once("end", done);
        try {
            bot.quit();
        }
        catch {
            force();
        }
    });
}
