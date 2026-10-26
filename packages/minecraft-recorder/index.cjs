const { mineflayer: viewer } = require("prismarine-viewer");
const { chromium } = require("playwright");
const { spawnSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");
const {addObserverFollow} = require("./observer-follow.cjs");

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
  // Do not force a downward look at startup: agent POV should follow its natural view.
  console.error("Recorder terrain loaded:", ground.name, "at", ground.position.toString());
  const views = [
    { name: "agent-pov", port, firstPerson: true },
    { name: "observer", port: port + 1, firstPerson: false }
  ];
  for (const view of views) viewer(bot, { port: view.port, firstPerson: view.firstPerson, viewDistance: 6 });
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"]
  });
  const captures = [];
  const cameraTimings = [];
  const inventoryTimers = [];
  try {
    mkdirSync(dirname(options.output), { recursive: true });
    // Start both browser views before the experiment advances.
    for (const view of views) {
      const context = await browser.newContext({
        viewport: { width: options.width, height: options.height },
        recordVideo: { dir: dirname(options.output), size: { width: options.width, height: options.height } }
      });
      captures.push({ ...view, context });
      const page = await context.newPage();
      const captureOpenedAt = new Date().toISOString();
      captures[captures.length - 1].page = page;
      page.on("console", m => { if (m.type() === "error") console.error(view.name, m.text()); });
      page.on("pageerror", err => console.error(view.name, "page:", err));
      if (!view.firstPerson) {
        // Intercept only the observer viewer script; fail if the upstream hook changes.
        let patched = false;
        await page.route("**/index.js", async route => {
          const original = await route.fetch();
          const body = addObserverFollow(await original.text());
          patched = true;
          await route.fulfill({response: original, body});
        });
        captures[captures.length - 1].verifyObserverPatched = () => {
          if (!patched) throw new Error("Observer viewer script never loaded; tracking not guaranteed");
        };
      }
      await page.goto(`http://127.0.0.1:${view.port}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.locator("canvas").first().waitFor({ state: "visible", timeout: 20000 });
      captures[captures.length - 1].verifyObserverPatched?.();
      // Prismarine Viewer only renders the 3D world. Overlay the *actual*
      // Mineflayer inventory on each video, updating while recording.
      // The panel is browser UI, not a fake Minecraft inventory screen.
      await page.evaluate(() => {
        const hud = document.createElement("div");
        hud.id = "emergent-inventory";
        Object.assign(hud.style, {
          position: "fixed", top: "18px", left: "18px", minWidth: "210px",
          maxWidth: "400px", zIndex: "2147483647", color: "#fff",
          background: "rgba(9, 18, 27, 0.84)", border: "1px solid #8cb8c3",
          borderRadius: "10px", padding: "11px 15px", pointerEvents: "none",
          fontFamily: "system-ui, sans-serif", fontSize: "19px",
          boxShadow: "0 3px 16px rgba(0, 0, 0, .35)"
        });
        hud.innerHTML = '<div style="font-size:13px;letter-spacing:2px;color:#93cad5;margin-bottom:5px">INVENTORY</div><div id="emergent-items">Empty</div>';
        document.body.appendChild(hud);
      });
      let previousInventory = "";
      const updateHud = async () => {
        if (page.isClosed()) return;
        const items = bot.inventory.items().map(item => ({ name: item.name, count: item.count }));
        const fingerprint = JSON.stringify(items);
        if (fingerprint === previousInventory) return;
        const changed = previousInventory !== "";
        previousInventory = fingerprint;
        await page.evaluate(({ items, changed }) => {
          const hud = document.getElementById("emergent-inventory");
          const target = document.getElementById("emergent-items");
          if (!target || !hud) return;
          target.replaceChildren();
          if (!items.length) target.textContent = "Empty";
          for (const item of items) {
            const row = document.createElement("div");
            row.textContent = item.name.replaceAll("_", " ") + " × " + item.count;
            target.appendChild(row);
          }
          if (changed) {
            hud.style.borderColor = "#ffe39b";
            setTimeout(() => { hud.style.borderColor = "#8cb8c3"; }, 1000);
          }
        }, { items, changed }).catch(error => console.error("Inventory overlay failed:", String(error)));
      };
      await updateHud();
      const timer = setInterval(() => { void updateHud(); }, 250);
      inventoryTimers.push(timer);
      // The third-person page uses OrbitControls. Zoom toward the bot using
      // wheel input before recording the experiment; POV is unaffected.
      if (!view.firstPerson) {
        const canvas = page.locator("canvas").first();
        await canvas.hover();
        for (let n = 0; n < 5; n++) await page.mouse.wheel(0, -300);
        await page.waitForTimeout(600);
      }
      await page.waitForTimeout(2400);
      await page.screenshot({ path: join(dirname(options.output), `${view.name}-debug.png`) });
      const readyAt = new Date().toISOString();
      cameraTimings.push({name: view.name, captureOpenedAt, readyAt});
      console.error("Camera ready:", view.name, "on", view.port);
    }
    const startedAt = new Date().toISOString();
    require("node:fs").writeFileSync(join(dirname(options.output), "metadata.json"),
      JSON.stringify({ startedAt, cameraTimings, synchronization: "approximate (video capture may start after page creation)", cameras: views.map(v => ({ name: v.name, port: v.port, firstPerson: v.firstPerson })),
        dimensions: { width: options.width, height: options.height } }, null, 2));
    let stopped = false;
    return async () => {
      if (stopped) return;
      stopped = true;
      try {
        inventoryTimers.forEach(clearInterval);
        for (const capture of captures) {
          const video = capture.page.video();
          await capture.context.close();
          const webm = join(dirname(options.output), `${capture.name}.webm`);
          await video.saveAs(webm);
          const mp4 = join(dirname(options.output), `${capture.name}.mp4`);
          const ff = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", webm, "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { encoding: "utf8" });
          if (ff.status !== 0) throw new Error(`FFmpeg ${capture.name} failed: ${ff.stderr}`);
          console.error("Camera saved:", mp4);
        }
      } finally { await browser.close(); }
    };
  } catch (error) {
    inventoryTimers.forEach(clearInterval);
    for (const capture of captures) await capture.context.close().catch(() => {});
    await browser.close();
    throw error;
  }
}
module.exports = { start };
