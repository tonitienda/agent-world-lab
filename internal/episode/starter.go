package episode

import "fmt"

func Starter(id string) string {
	return fmt.Sprintf(`version: 1
episode:
  id: %s
  title: The Island Escape
environment:
  provider: minecraft
  preset: survival
  seed: "12345"
  minecraft:
    version: "1.21.4"
level_design:
  harness: claude
  model: configured-default
  prompt_file: level-design.md
goal:
  prompt_file: goal.md
evaluation:
  type: reach_location
  target: mainland-landmark
  radius: 4
agents:
  - id: claude
    harness: claude
    model: configured-default
  - id: codex
    harness: codex
    model: configured-default
recording:
  cameras: [agent-pov, observer, follow]
  max_duration_minutes: 20
production:
  renderer: motion-canvas
  narration: manual
  max_video_duration_minutes: 10
`, id)
}

const DesignerPrompt = `Construct a reproducible Minecraft island escape challenge. Place a small island,
a visible mainland landmark, useful resources, and several viable routes. Avoid
requiring one intended solution. Set the player's initial survival state explicitly.
Use the supplied scenario artifact contract; implement and verify actual blocks,
spawn, resources and landmark. Explain reachability assumptions separately from
checks that your verify script can actually measure.
`
const GoalPrompt = `You are on an island. Reach the mainland landmark using the resources available.
The gold landmark is at x=40, y=80, z=0. Decide how to accomplish this.
Use only the world tools. Give brief public first-person intentions before actions.
Call finish_session when finished, including when you cannot complete the challenge.
` + "\n" + PlayerVoicePrompt

// PlayerVoicePrompt is copied into new public goals, so it is recorded and hashed
// with each take rather than relying on provider-specific instruction discovery.
const PlayerVoicePrompt = `Narration style for The Agent Terrarium:
- Sound like a curious, practical experimenter with a little dry wit. Be warm,
  observant and occasionally self-deprecating when a real attempt goes wrong.
- Speak naturally in first person. Start with the useful thought, not a stock
  preamble. Avoid repeated "So", "Okay", "Alright" and "I'm going to" openings.
- Keep routine action intentions very short, usually 3-8 words. Use a slightly
  fuller sentence for a new strategy, a discovery or a meaningful change of plan.
  Do not pad every mined block or placed plank into a fresh explanation.
- Vary phrasing and focus on what matters: the current obstacle, the next useful
  step, or what an observed failure changed. Do not restate the whole goal.
- Humor is optional and occasional. Let it come from the actual situation;
  leave most lines straightforward. Avoid a joke per action, forced catchphrases,
  exaggerated reactions, or extra actions staged for entertainment.
- Keep every claim grounded in observations and tool results. An intention is
  not a successful outcome. Do not invent dialogue, events or private reasoning.
- Personality changes the delivery, not the objective or the world-tool rules.
`

const Contract = `
You are the level designer, in a fresh session with no execution tools. Return ONLY
one JSON object {"files":{"manifest.json":"...","implementation/install.mjs":"...",
"implementation/verify.mjs":"...","report.md":"..."}}. Values are exact file contents.
Do not use markdown fences. You are generating an actual implementation for later
operator approval, not an essay. No generated code will run during generation.

manifest.json schema (no extra keys):
{"version":1,"spawn":{"x":0.5,"y":80,"z":0.5},
 "targets":{"mainland-landmark":{"x":40,"y":80,"z":0}},
 "install":"implementation/install.mjs","verify":"implementation/verify.mjs",
 "revision":"island-v1","required_capabilities":["observe","move_to","mine","place"]}

Scripts are ES modules executed by node from the repository root AFTER a fresh
world reset. Import dependencies from process.env.EMERGENCE_REPO + '/node_modules/'
(using createRequire) or import existing repository implementation by absolute URL.
No package installation, no shell, no agent invocation, no external network services.
Bound entity selectors to the construction area with explicit x/y/z/dx/dy/dz
or a fixed position and distance. Never use world-wide kill @e commands, including
kill @e[type=!minecraft:player]. Exclude players from cleanup. Do not delete entities
outside the fixed construction bounds even though the server was freshly reset.
Use Mineflayer and docker compose exec -T --user 1000 minecraft mc-send-to-console
with execFile argument arrays for block placement/teleports. Use the repository's
src/environments/minecraft/ravine.ts as a pattern if available; do not depend on it
if your design differs. The script receives EMERGENCE_REPO, EMERGENCE_SCENARIO_DIR,
AGENT_ID=emergence-player, and EMERGENCE_VALIDATION_REPORT. Connect to 127.0.0.1 with port Number(process.env.MC_PORT ?? 25565),
wait for spawn/chunks and teleport acknowledgement, close every connection and exit.
Give every spawn/chunk-loading wait a deadline; clear timeout timers on success.
Use a bounded disconnect in finally, forcing bot.end() if bot.quit() stalls.
The trusted helper src/environments/minecraft/scenario-lifecycle.ts exports
waitForSpawn(bot), withDeadline(promise, milliseconds, label), and closeScenarioBot(bot).
Import it by absolute file URL under EMERGENCE_REPO when using node --import tsx.
Set the SAME player's position, facing, health, food, survival mode and empty inventory.
Set deterministic time/weather/spawning rules. The install must construct the world;
verify must read actual blocks, player spawn/inventory/resources/target and assert
required capabilities and recorder prerequisites, without rebuilding or resetting.
verify writes JSON to EMERGENCE_VALIDATION_REPORT with
{"spawn":true,"target":true,"resources":true,"capabilities":true,"recorder":true,
 "reachability":"manual review required", "evidence":["describe actual checks"]}.
Go also runs the existing Minecraft preflight. report.md explains implementation,
resource/route assumptions, automated limits and manual design review still needed.
All artifacts must be relative, regular files inside this bundle. No hidden solution
or manifest is ever supplied to the player. Player gets only its goal prompt.
The player's normal observation is a visible local block scan at offsets
X/Z -3..+3 and Y -1..+2. The player also has ONE successful survey per session,
scanning visible loaded blocks within horizontal radius 16 and Y -8..+12,
grouped by material. It is not an X-ray and does not provide a route. Design
discoverable terrain for these actual tools; camera footage is not model input.
The world snapshot includes all installed world data, player data and setup files;
restoration must work WITHOUT rerunning your scripts or the level designer.
`
