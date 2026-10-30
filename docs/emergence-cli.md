# Emergence orchestration CLI

For an interactive walk-through with browser previews and an audio pause, use
[the guided pipeline](guided-pipeline.md):
`./pipeline.sh --design codex --player claude episodes/episode-003/episode.yaml`.
It prepares the initial v2 edit from measured audio and asks you to review it.

On macOS/Linux, build with Go 1.23+ (`make cli`), test with `make cli-test`, and run
`./bin/emergence --help`. Run from anywhere inside this repository, or pass
`--root /absolute/repository`. Node 22+, the existing npm dependencies, Docker
Compose, FFmpeg/ffprobe, recorder Chromium, and authenticated Claude Code are
needed for live recording. Static episode validation needs only the built binary.
`doctor` reports optional dependencies without making them mandatory for every command.

## Run Episode 003

The starter already exists in `episodes/episode-003/`. Edit both Markdown prompts
and the YAML before generating a scenario. Never put hidden solutions in goal.md.
This is a real experiment: installation and every take replace the active world,
archiving its full server data first. Finalize existing MCP sessions before those
commands. The CLI respects their existing lock and never overwrites old takes.

```sh
make cli
./bin/emergence doctor
./bin/emergence episode validate episode-003
./bin/emergence scenario generate episode-003
# Read ALL generated scenario/implementation files, manifest.json and report.md.
./bin/emergence scenario validate episode-003 --dry-run
./bin/emergence scenario validate episode-003 --yes --approve-code <printed-digest>
# Review challenge design and reachability separately from automated checks.
./bin/emergence scenario freeze episode-003
./bin/emergence run episode-003 --agent claude --dry-run
./bin/emergence run episode-003 --agent claude --yes
./bin/emergence run episode-003 --agent claude --take 002 --yes
./bin/emergence runs list episode-003
./bin/emergence extract episode-003 --agent claude --take 001
# Review footage/logs; author v2 edit-plan.json; supply selected narration WAVs.
./bin/emergence produce episode-003 --agent claude --take 001 --stage validate
./bin/emergence produce episode-003 --agent claude --take 001
./bin/emergence status episode-003
```

`scenario generate` calls the configured designer and can incur model usage. An
included, hand-authored island implementation exercises the identical artifact
contract without a designer/model call:

```sh
node examples/island-scenario/bundle.mjs > /tmp/island.bundle.json
./bin/emergence scenario generate episode-003 --bundle /tmp/island.bundle.json
# Continue with digest review, live validation and freeze above.
```

Choose **one** generation path. Generation never replaces an existing scenario.
For another episode: `./bin/emergence episode new episode-004`. Initialization
never overwrites an existing directory. Change the new goal coordinates if its
scenario uses a different landmark; the designer receives the actual goal prompt.
The designer also receives the resolved environment and evaluation configuration.
The manifest must register the exact `evaluation.target` identifier from the YAML
at the destination the installer builds and verifier checks. Invalid bundles are
rejected before installation; correct the inputs if needed and rerun generation.

## Version 1 YAML

The complete starter is [episode.yaml](../episodes/episode-003/episode.yaml).
Unknown keys, duplicate YAML keys, multiple documents, invalid IDs, unsupported
providers/harnesses/evaluators, duplicate agent IDs, invalid timeouts, missing or
empty prompts and unsafe artifact paths fail static validation.

| Field | Required / default |
| --- | --- |
| `version` | `1` |
| `episode.id`, `episode.title` | Required; ID starts `episode-` and matches directory |
| `environment.provider` | `minecraft` (only implemented provider) |
| `environment.preset` | `survival`; also `superflat` |
| `environment.seed` | Required signed 64-bit decimal; quote it |
| `environment.minecraft.version` | `1.21.4`; actual snapshot version is checked |
| `environment.minecraft.port` | `25565`; loopback only, range 1024..65535 |
| `level_design.harness`, `.model` | `claude`; optional model / `configured-default` |
| `level_design.prompt` OR `.prompt_file` | Exactly one; file relative to episode |
| `goal.prompt` OR `.prompt_file` | Exactly one; never shares designer context |
| `evaluation.type`, `.target`, `.radius` | `reach_location`, named manifest target, radius defaults 4 |
| `agents` | Nonempty list of unique `id`, `harness`, optional `model` |
| `recording.cameras` | Current recorder requires `[agent-pov, observer, follow]` |
| `recording.max_duration_minutes` | 20; integer 1..1440, enforced by supervisor |
| `production.renderer` | `motion-canvas` |
| `production.narration` | `manual`; also `elevenlabs` (manual/pluggable exports) |
| `production.max_video_duration_minutes` | 10; excessive edits are rejected, never truncated |

File prompts retain their bytes, including multiline whitespace. Inline prompts
follow YAML block scalar rules (`|`, `|-`, `|+`); no Go trimming is applied.
Harness/model identifiers are independent; model strings are passed as argument
values, and `configured-default` omits the model flag. Current harness adapters
are `claude` and `codex`. Multiple agent definitions support separate sequential
takes; simultaneous multi-agent play is not implemented.

## Scenario contract, approval and verification

The designer runs in a new temporary workspace with execution tools disabled and
receives its own prompt, the challenge goal and an artifact contract. It returns
an inert JSON bundle, `{"files":{"relative/path":"exact content"}}`. The CLI
validates and installs these files under `scenario/`; it does **not** run them.
The same bundle can be imported with `--bundle`. See the complete island example.

Required files:

* `manifest.json`: strict JSON with `version:1`, `spawn:{x,y,z}`, named `targets`,
  `install`, `verify`, `revision`, and optional `required_capabilities`.
* `implementation/*.mjs`: installation/verification ES modules, plus helpers and
  assets. The two entry paths must be inside this directory.
* `report.md`: actual checks, design assumptions, resources, limitations and
  manual reachability review. Do not claim an automatic proof of solvability.

The CLI prints a SHA-256 of every artifact, including file names and contents.
Review all files before passing that exact digest as `--approve-code` together
with `--yes`. Editing any artifact invalidates approval. This is the explicit
noninteractive automation path too: an external reviewer can approve the digest.
Approved code executes with operator privileges; approval is a trust boundary,
not a sandbox. Never approve a bundle you have not reviewed.

Installation runs the existing `world:reset` with preset/seed/version/port, then
`node --import tsx <install.mjs>` with argument arrays. The scripts receive
`EMERGENCE_REPO`, `EMERGENCE_SCENARIO_DIR`, `MC_PORT` and
`AGENT_ID=emergence-player`. They must construct actual blocks, establish the
initial player position/facing, full health/food, empty inventory and survival
mode, close connections, and exit. Scripts may reuse existing repository code;
new implementations do not require Go changes.
Entity cleanup must exclude players and use explicit spatial bounds for the
construction area; world-wide `kill @e` selectors are rejected. Spawn, chunk
loading and connection shutdown must be bounded, including timeout cleanup.
The trusted `src/environments/minecraft/scenario-lifecycle.ts` helper supplies
these waits; a bundled copy can be included in the reviewed scenario artifacts.

World reset preserves reusable vanilla server distributions in the ignored
`data/minecraft-runtime-cache/<version>/` directory. It checks SHA-256 digests and
can recover an exact-version distribution from earlier world archives. Only the
server JAR and its installer receipt are restored; world/player data, permissions
and server configuration are newly created. Dynamic versions such as `LATEST`,
new versions, or missing/invalid cache entries require normal downloads. Cache
entries are local runtime artifacts and are not committed or distributed.

Validation runs existing `world:preflight` and the approved verifier. The verifier
writes `EMERGENCE_VALIDATION_REPORT` with booleans `spawn`, `target`, `resources`,
`capabilities`, `recorder`, a `reachability` review description and nonempty
`evidence`. All five booleans must pass. Review the scripts and evidence: Go
cannot independently prove arbitrary generated verification code is truthful.
`scenario validate --dry-run` only checks installable artifacts and prints the
digest; it never claims live verification.

Successful validation is resumable: repeating it with the same artifact digest
does not reset again. Failed/interrupted installation is recorded; a retry needs
the explicit reset authorization again. Freeze rechecks the live scenario under
one reservation, stops Minecraft, verifies seed/generator/version, copies the
whole server directory, and freezes the configuration, prompts and scenario
sources. It leaves Minecraft stopped. The immutable snapshot is read-only and
content-addressed by `frozen.json`; partial snapshots are preserved for inspection.
Repeated freeze validates identity without taking another snapshot. If the final
manifest was persisted before a crash, a subsequent freeze repairs workflow state.
Changing the world/evaluation configuration or level design after freeze requires
a new episode. The player goal may change between takes: edit `goal.md` or the
configured inline goal and choose a new unused `--take`. The world and scored
destination remain fixed. Existing snapshots work without migration. The exact
goal and its SHA-256 hash are saved in the new take before world restoration;
later goal edits do not change an earlier take or its extracted narration.

Every take verifies the snapshot hash and restores its **actual world/player
data**; it never reruns the designer or installer. The writable restored copy is
separate from the read-only snapshot. The fixed Minecraft username gives every
harness the same player data/identity; agent/model identities remain in run.json.
Docker recreates the container after replacing the bind-mount directory, using
the frozen generator, seed and version parameters.

## Sessions, isolation and outcomes

Go holds a repository orchestration flock and a reservation in the existing
Minecraft session lock across preparation, restore, recording and finalization.
Only token-bearing subprocesses can borrow it. Delegated MCP PIDs remain active
lock owners if the supervisor is killed. Legacy reset/session commands retain
their exclusion behavior. Do not manually remove a live lock.

Claude gameplay uses a separate process and empty temporary working directory,
`--restricted --tools "" --strict-mcp-config`, explicit settings disabling hooks,
memory and all CLAUDE.md discovery, disabled skills/Chrome, no session persistence,
empty setting sources, `dontAsk` permissions and an allowlist of world MCP tools.
Installed isolation flags and authentication are checked **before restoration**,
using the same customization/authentication flags as the player. Normal Claude
subscription login/keychain auth is supported; neither `--bare` (disables OAuth)
nor `--safe-mode` (disables explicit MCP servers) is used.
The model receives exactly the current goal captured for that take. It has no local file/shell
or web tools and is not given SCENARIO_FILE, evaluation targets, reports, source
code or designer transcript. The trusted MCP process can access recordings and
world state but exposes only the existing world tools. This relies on the
installed Claude CLI honoring its restricted/tool settings; it is not an OS
sandbox against a compromised harness executable or administrator customization.

Codex supports a practical noninteractive, read-only, shell-disabled **designer**
adapter. Its currently installed read-only gameplay sandbox still permits reads
outside its working directory, so `run --agent codex` is explicitly blocked before
world restoration. An empty working directory alone is insufficient. An external
container/VM boundary is required before enabling Codex benchmark gameplay.

Run timeouts include harness/MCP startup. On timeout/cancellation the supervisor
requests the existing MCP lifecycle controller to stop and finalize; it allows a
90-second grace period before killing the process group. It then checks finalized
session metadata and all camera files. Failed/interrupted takes are retained and
never retried automatically. A hard OS kill cannot guarantee finalized MP4s;
raw intermediates, durable events and locks remain for recovery. `status`/`runs
list` expose unfinished metadata; an interrupted `running` take is not silently
resumed or overwritten. Use a new take after inspecting/finalizing that session.

`run.json` separates workflow, infrastructure (`completed`, `failed`, `stopped`,
`aborted`, `timed_out`), objective and agent-reported completion. The MCP records
a trusted final adapter observation before closing. The evaluator also reads
trusted `observe` events. A recorded position within radius proves a reach;
completion alone never does. Without trusted positions the outcome is `unknown`;
an interrupted observed run is `incomplete`; a completed run with no observed
reach is `failure`. Positions are sampled, not continuous: unobserved traversal
is not inferred. Agent prose is retained in harness.stdout.log and separately in run.json, never used as
objective evidence. The recorded goal is preserved for later extraction, independently
from subsequent edits to the live prompt files. Harness logs redact inherited API credentials and lease tokens.

## Files and production stages

```text
episodes/episode-003/
  episode.yaml, level-design.md, goal.md       # version control
  scenario/manifest.json, implementation/, report.md  # review + version control
  state.json, .verification.json              # local runtime state/reports
  frozen.json, frozen/                        # local immutable snapshot + identity
  runs/claude/take-001/
    run.json, events.json, metadata.json, mcp-session.json
    goal.md                                  # exact player prompt used by this take
    harness.stdout.log, harness.stderr.log
    agent-pov.mp4, observer.mp4, follow.mp4    # plus preserved recorder intermediates
production/episode-003-claude-001/
  source.json, narration.txt, narration-manifest.json, edit-plan.json
  editorial-report.md, project.ts, scene.tsx
production/public/episode-003-claude-001/{video,audio}/
production/output/episode-003-claude-001.mp4
```

Scenario source/configuration and reviewed editorial sources belong in Git.
World snapshots, run state, recordings, model logs and derived MP4s are ignored.
Back up frozen.json together with frozen/ externally when sharing a benchmark;
all source definitions alone do not recreate the exact saved world.

`extract` reads the actual recording events, metadata and all three MP4s through
`episode:plan`. It preserves every valid public intention and original eventIndex,
including untimed/out-of-window narration, independently from preview shot
selection. Such lines may need manual footage selection. New extracted media
uses hardlinks (copy fallback across filesystems); treat source media as immutable.
Existing Episodes 001/002 and the legacy planner defaults are unchanged.
Each take has its own production ID to prevent cross-agent/take collisions.

Extraction creates a **v1 draft** and wrappers for the shared Motion Canvas scene.
Review the real footage/logs and author a v2 edit-plan.json using
[production/README.md](../production/README.md). Supply the chosen WAVs with the
exact narration manifest filenames; omitted lines must be an editorial decision.
Audio may be exported manually from ElevenLabs or another tool. No credentials
or external voice service is mandatory. Missing selected audio is an actionable
error, never a silent render without narration.

`produce --stage validate` calls the existing timeline/assets/audio validator;
`--stage render` validates then invokes the existing Motion Canvas renderer;
`--stage check` decodes/checks the final MP4. The default `all` runs all three and
marks `produced` only after the final media check. Existing final MP4s are never
replaced by this CLI. Preserve an earlier export before deliberately rerendering.
The existing renderer keeps source camera synchronization and narration manifests.
There is no new renderer, simplified-camera fallback or automatic editorial claim.

## Verification

```sh
make cli-test
npm run check
npm test
npm --prefix production run check
npm run integration:survival
npm run integration:orchestration
```

The last two commands need Docker access and existing Minecraft EULA acceptance.
Survival integration uses its established random-port disposable container.
Orchestration integration copies code into a fresh temporary repository with a
unique Compose project, isolated world data and random Minecraft port. It runs
the real Go CLI, installs/freezes/restores an example world, uses a scripted MCP
client in place of paid model inference, records three cameras, extracts actual
events and renders/checks a Motion Canvas fixture with synthetic audio. It keeps
fixture artifacts for inspection and removes only its own container/network.
It does not validate the quality of a real model's level design or gameplay, or
voice quality. Unit tests inject runners/harnesses for failure, timeout, resume,
identity tampering, prompt isolation and no-overwrite cases.
