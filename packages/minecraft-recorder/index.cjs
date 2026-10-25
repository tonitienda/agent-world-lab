const { mineflayer: viewer } = require("prismarine-viewer");
const { chromium } = require("playwright");
const { spawnSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");

async function start(bot, options) {
  const port = Number(process.env.RECORD_VIEWER_PORT || 3007);
  // Verify that Mineflayer can access terrain, not merely that spawn fired.
  // A WebSocket/canvas with no chunks produces an entirely blue recording.
  const pos = bot.entity.position.floored();
  let ground;
  for (let attempt = 0; attempt < 30; attempt++) {
    ground = bot.blockAt(pos.offset(0, -1, 0));
    if (ground) break;
    if (attempt % 5 === 0) console.error("Waiting for recorder terrain", {
      attempt, position: pos.toString(), dimension: bot.game.dimension,
      knownColumns: Object.keys(bot.world?.async?.columns || {}).length
    });
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ground) throw new Error("Recorder cannot see terrain below bot after 15s; refusing blank video");
  await bot.look(bot.entity.yaw, 0.75, true);
  console.error("Recorder terrain loaded:", ground.name, "at", ground.position.toString());
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
    page.on("websocket", ws => {
      console.error("Viewer websocket:", ws.url());
      const traffic = {};
      const logFrame = (kind, frame) => {
        const data = frame.payload;
        const key = String(data).slice(0, 32);
        traffic[kind] = (traffic[kind] || 0) + 1;
        if (traffic[kind] <= 4) console.error("Viewer socket", kind, "bytes=", data.length, "prefix=", key);
      };
      ws.on("framereceived", frame => logFrame("received", frame));
      ws.on("framesent", frame => logFrame("sent", frame));
      ws.on("close", () => console.error("Viewer websocket closed; traffic:", traffic));
    });
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
    console.error("Viewer canvas:", await page.locator("canvas").first().evaluate(c => {
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      return { width:c.width, height:c.height, webgl: Boolean(gl),
        renderer: gl?.getParameter(gl.RENDERER), viewport: gl?.getParameter(gl.VIEWPORT) };
    }));
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
