const { startViewer } = require("./viewer-server.cjs");
const { chromium } = require("playwright");
const { spawnSync } = require("node:child_process");
const { mkdirSync, renameSync } = require("node:fs");
const { dirname, join } = require("node:path");
const {createFollowController, terrainSnapshot, addFollowCamera, installFollow} = require("./follow-camera.cjs");
const {synchronizationOffset} = require("./sync.cjs");
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
    { name: "observer", port: port + 1, firstPerson: false },
    { name: "follow", port: port + 2, firstPerson: false }
  ];
  const servers = [];
  let browser;
  const captures = [];
  const cameraTimings = [];
  const inventoryTimers = [];
  try {
    for (const view of views) {
      servers.push(await startViewer(bot, { port: view.port, firstPerson: view.firstPerson, viewDistance: 6 }));
    }
    browser = await chromium.launch({
      headless: true,
      args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"]
    });
    mkdirSync(dirname(options.output), { recursive: true });
    // Start all browser views before the experiment advances.
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
        // Intercept only third-person scripts; fail if the upstream hook changes.
        let patched = false;
        await page.route("**/index.js", async route => {
          const original = await route.fetch();
          const body = (view.name === "follow" ? addFollowCamera : addObserverFollow)(await original.text());
          patched = true;
          await route.fulfill({response: original, body});
        });
        captures[captures.length - 1].verifyObserverPatched = () => {
          if (!patched) throw new Error("Observer viewer script never loaded; tracking not guaranteed");
        };
      }
      if (view.name === "follow") {
        await page.addInitScript({content: `(${installFollow.toString()})(${createFollowController.toString()});`});
      }
      await page.goto(`http://127.0.0.1:${view.port}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.locator("canvas").first().waitFor({ state: "visible", timeout: 20000 });
      captures[captures.length - 1].verifyObserverPatched?.();
      if (view.name === "follow") {
        const updateFollow = async () => {
          await page.evaluate(state => { window.__followState = state; }, terrainSnapshot(bot));
        };
        await updateFollow();
        let busy = false;
        inventoryTimers.push(setInterval(async () => {
          if (busy || page.isClosed()) return;
          busy = true;
          try { await updateFollow(); } catch (error) { console.error("Follow terrain update:", String(error)); }
          finally { busy = false; }
        }, 50));
        await page.waitForFunction(() => window.__followTelemetry?.updates > 0, undefined, {timeout: 15000});
      }
      await page.evaluate(() => {
        const gate = document.createElement("div");
        gate.id = "recording-sync-gate";
        Object.assign(gate.style, {position:"fixed",left:"0",top:"0",width:"32px",height:"32px",background:"white",zIndex:"2147483647"});
        document.body.appendChild(gate);
      });
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
      if (view.name === "observer") {
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
    const epoch = Date.now() + 1000;
    const transitions = await Promise.all(captures.map(capture => capture.page.evaluate(epoch => new Promise(resolve => {
      function tick() {
        if (Date.now() < epoch) return requestAnimationFrame(tick);
        const gate = document.getElementById("recording-sync-gate");
        document.body.appendChild(gate);
        gate.style.background = "black";
        resolve(Date.now());
      }
      requestAnimationFrame(tick);
    }), epoch)));
    const startedAt = new Date(epoch).toISOString();
    const metadata = { status: "recording", startedAt, cameraTimings: cameraTimings.map((timing, i) => ({
      ...timing, rawCaptureOpenedAt: timing.captureOpenedAt,
      captureOpenedAt: startedAt, gateAt: new Date(transitions[i]).toISOString()
    })), synchronization: "optical gate aligned to shared event epoch; precision limited by capture frame rate",
      cameras: views, dimensions: {width: options.width, height: options.height} };
    const metadataPath = join(dirname(options.output), "metadata.json");
    const saveMetadata = () => require("node:fs").writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    saveMetadata();
    const { createFinalizer } = require("./finalize.cjs");
    return createFinalizer([
      async () => {
        metadata.endedAt = new Date().toISOString();
        inventoryTimers.forEach(clearInterval);
        saveMetadata();
      },
      ...captures.map(capture => async () => {
        try {
          if (capture.name === "observer") {
            const telemetry = await capture.page.evaluate(() => window.__emergentObserverFollow ?? null).catch(() => null);
            console.error("Observer camera follow updates:", telemetry?.updates ?? 0, "last target:", telemetry?.target ?? "none");
            await capture.page.screenshot({path: join(dirname(options.output), "observer-final-debug.png")}).catch(() => {});
            if (!telemetry?.updates) console.error("WARNING: Observer camera received no tracked position updates; inspect observer-final-debug.png");
          }
          if (capture.name === "follow") {
            metadata.followTelemetry = await capture.page.evaluate(() => window.__followTelemetry).catch(() => null);
            await capture.page.screenshot({path: join(dirname(options.output), "follow-final-debug.png")}).catch(() => {});
          }
          const video = capture.page.video();
          await capture.context.close();
          const webm = join(dirname(options.output), `${capture.name}.webm`);
          await video.saveAs(webm);
          const mp4 = join(dirname(options.output), `${capture.name}.mp4`);
          const partial = join(dirname(options.output), `${capture.name}.partial.mp4`);
          const opticalOffset = synchronizationOffset(webm);
          const timing = metadata.cameraTimings.find(t => t.name === capture.name);
          // Account for the measured browser scheduling delay after the shared epoch.
          const offset = Math.max(0, opticalOffset - (Date.parse(timing.gateAt) - epoch) / 1000);
          timing.opticalGateSeconds = opticalOffset;
          timing.rawTrimSeconds = offset;
          saveMetadata();
          const duration = (Date.parse(metadata.endedAt) - epoch) / 1000;
          const ff = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", webm, "-ss", String(offset), "-t", String(duration), "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", partial], { encoding: "utf8" });
          if (ff.status !== 0) throw new Error(`FFmpeg ${capture.name} failed: ${ff.stderr}`);
          renameSync(partial, mp4);
          timing.status = "completed";
          saveMetadata();
          console.error("Camera saved:", mp4);
        } catch (error) {
          const timing = metadata.cameraTimings.find(t => t.name === capture.name);
          timing.status = "failed";
          timing.error = String(error);
          saveMetadata();
          throw error;
        }
      })
    ], async () => {
      inventoryTimers.forEach(clearInterval);
      const results = await Promise.allSettled([browser.close(), ...servers.map(server => Promise.resolve().then(() => server.close()))]);
      const errors = results.filter(r => r.status === "rejected").map(r => r.reason);
      metadata.status = errors.length || metadata.cameraTimings.some(t => t.status === "failed") ? "failed" : "completed";
      saveMetadata();
      if (errors.length) throw new AggregateError(errors, "Camera cleanup failed");
    });
  } catch (error) {
    inventoryTimers.forEach(clearInterval);
    for (const capture of captures) await capture.context.close().catch(() => {});
    await browser?.close().catch(() => {});
    for (const server of servers) { try { await server.close(); } catch {} }
    throw error;
  }
}
module.exports = { start };
