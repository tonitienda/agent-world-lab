const { mineflayer: viewer } = require("prismarine-viewer");
const { chromium } = require("playwright");
const { spawnSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");

async function start(bot, options) {
  const port = Number(process.env.RECORD_VIEWER_PORT || 3007);
  // First-person on a flat world can show only horizon/sky when level.
  // Tilt toward blocks beneath and ahead of the bot before rendering.
  await bot.look(bot.entity.yaw, 0.75, true);
  console.error("Recorder bot pose:", JSON.stringify({position: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch}));
  const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  console.error("Recorder ground:", below?.name ?? "not loaded");
  viewer(bot, { port, firstPerson: true, viewDistance: 6 });
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"]
  });
  let context;
  try {
    mkdirSync(dirname(options.output), { recursive: true });
    context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      recordVideo: { dir: dirname(options.output), size: { width: options.width, height: options.height } }
    });
    const page = await context.newPage();
    page.on("websocket", ws => { console.error("Viewer websocket:", ws.url()); ws.on("close", () => console.error("Viewer websocket closed")); });
    page.on("requestfailed", req => console.error("Viewer request failed:", req.url(), req.failure()));
    page.on("console", m => { if (m.type() === "error") console.error("Viewer:", m.text()); });
    page.on("pageerror", err => console.error("Viewer page:", err));
    for (let attempt = 0; attempt < 20; attempt++) {
      try { await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "domcontentloaded", timeout: 3000 }); break; }
      catch (e) { if (attempt === 19) throw e; await new Promise(r => setTimeout(r, 300)); }
    }
    await page.locator("canvas").first().waitFor({ state: "visible", timeout: 20000 });
    console.error("Browser Minecraft viewer recording:", options.output);
    await page.waitForTimeout(3000);
    console.error("Viewer canvas:", await page.locator("canvas").first().evaluate(c => ({width:c.width, height:c.height})));
    await page.screenshot({ path: join(dirname(options.output), "viewer-debug.png") });
    let stopped = false;
    return async () => {
      if (stopped) return;
      stopped = true;
      const video = page.video();
      await context.close(); // Playwright flushes the WebM only after closing.
      const webm = join(dirname(options.output), "capture.webm");
      await video.saveAs(webm);
      await browser.close();
      const ff = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", webm, "-c:v", "libx264",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", options.output], { encoding: "utf8" });
      if (ff.status !== 0) throw new Error("FFmpeg MP4 conversion failed: " + ff.stderr);
    };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    await browser.close();
    throw error;
  }
}
module.exports = { start };
