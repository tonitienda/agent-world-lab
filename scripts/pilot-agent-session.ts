import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createWorld } from "../src/environments/index.js";

type AgentDecision = { thought: string; action: "observe" | "inventory" | "move_to" | "mine" | "place" | "say" | "finish"; args?: Record<string, unknown> };
const objective = process.env.PILOT_PROMPT ?? "Explore your immediate surroundings. Try to find an interesting block, collect it if safe, and describe what you discovered.";
const endpoint = process.env.AGENT_API_URL ?? "https://api.openai.com/v1/chat/completions";
const model = process.env.AGENT_MODEL ?? "gpt-4.1-mini";
const apiKey = process.env.AGENT_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set AGENT_API_KEY (or OPENAI_API_KEY) to run a real model-driven pilot.");
if (!/^https?:\/\//.test(endpoint)) throw new Error("AGENT_API_URL must be an http(s) endpoint");
const maxTurns = Math.max(1, Math.min(12, Number(process.env.PILOT_MAX_TURNS ?? "8") || 8));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = resolve(process.env.PILOT_OUTPUT_DIR ?? join("data", "pilot-sessions"), timestamp);
mkdirSync(dir, { recursive: true });
process.env.RECORD_MP4 = join(dir, "agent-pov.mp4");
process.env.RECORD_WIDTH ??= "854";
process.env.RECORD_HEIGHT ??= "480";

const prompt = `You control a Minecraft agent through a limited tool interface.
Your objective: ${objective}
You receive observations containing the bot's coordinates, nearby blocks and entities.
Choose ONE useful action per turn. Your actions must be grounded in observed data.
Allowed actions: observe, inventory, move_to, mine, place, say, finish.
For move_to/mine/place give integer x,y,z. For place give item; for say give message.
Movement may travel at most 24 blocks per command; mining/placing requires proximity.
Never hallucinate inventory items or world features. Avoid repeated failed actions.
Prefer small safe steps. No requirement to succeed: report what happened.
Reply ONLY with a JSON object: {"thought":"short reasoning summary for the episode log","action":"observe|inventory|move_to|mine|place|say|finish","args":{}}.
The thought is a brief explanation, not private reasoning or a chain of thought.`;

const world = createWorld("minecraft");
const events: Array<Record<string, unknown>> = [];
const add = (kind: string, payload: unknown) => { events.push({ at: new Date().toISOString(), kind, payload }); };
const history: Array<{ role: "system" | "user" | "assistant"; content: string }> = [{ role: "system", content: prompt }];
let connected = false;
let error: unknown;
const startedAt = new Date().toISOString();
try {
  await world.connect();
  connected = true;
  add("spawn", await world.observe());
  for (let turn = 1; turn <= maxTurns; turn++) {
    const observation = await world.observe();
    history.push({ role: "user", content: JSON.stringify({ turn, objective, observation, actions: world.capabilities }) });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: history, temperature: 0.4, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
    const answer = body.choices?.[0]?.message?.content;
    if (!answer) throw new Error("Model returned no decision");
    const decision = JSON.parse(answer) as AgentDecision;
    if (!["observe", "inventory", "move_to", "mine", "place", "say", "finish"].includes(decision.action)) throw new Error(`Invalid agent action: ${decision.action}`);
    history.push({ role: "assistant", content: answer });
    add("decision", { turn, thought: decision.thought, action: decision.action, args: decision.args ?? {}, usage: body.usage });
    console.log(`Turn ${turn}: ${decision.action} — ${decision.thought}`);
    if (decision.action === "finish") break;
    const result = decision.action === "observe" ? await world.observe() : await world.act(decision.action, decision.args ?? {});
    add("result", { turn, result });
    history.push({ role: "user", content: JSON.stringify({ result }) });
    await delay(1200);
  }
  add("final-observation", await world.observe());
  await delay(3000);
} catch (e) {
  error = e;
  add("error", String(e));
  console.error("Pilot failed:", e);
  process.exitCode = 1;
} finally {
  if (connected) {
    try { await world.close(); }
    catch (e) { add("recorder-error", String(e)); console.error(e); process.exitCode = 1; }
  }
  writeFileSync(join(dir, "events.json"), JSON.stringify(events, null, 2) + "\n");
  writeFileSync(join(dir, "session.json"), JSON.stringify({ prompt: objective, model, endpoint, startedAt, endedAt: new Date().toISOString(), maxTurns, success: !error }, null, 2) + "\n");
  for (const name of ["agent-pov", "observer", "follow"]) {
    const file = join(dir, `${name}.mp4`);
    if (!existsSync(file) || !statSync(file).size) {
      console.error("Missing recording:", file);
      process.exitCode = 1;
    } else console.log("Recording:", file);
  }
  console.log("Session directory:", dir);
  process.exit(process.exitCode ?? 0); // Viewer keeps local HTTP ports open.
}
