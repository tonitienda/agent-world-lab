# Implementation report — Emergence orchestration CLI

## Delivered

The working Go CLI is built at `bin/emergence`. Episode 003 has a validated starter
configuration and separate designer/player prompts; it remains in `created`
state, with no experiment run against the development world.

Implemented commands: `episode new`, `episode validate`, `scenario generate`,
`scenario validate`, `scenario freeze`, `run`, `runs list`, `extract`, `produce`,
`status`, `doctor`. The command parser supports an explicit repository root,
agent/take selection, dry runs, content-digest code approval, reset authorization,
artifact bundle import and independent production validation/render/check stages.
See [the workflow guide](emergence-cli.md) for the full schema and exact Episode
003 commands. Start with `make cli`, `./bin/emergence episode validate episode-003`,
then `./bin/emergence scenario generate episode-003`.

Go owns strict YAML, paths, state transitions, atomic metadata, immutable content
identities, take allocation, subprocess supervision, harness adapters and trusted
location evaluation. Small configuration/storage/executor/harness/environment
packages support an episode service; there is no generic workflow engine.
The Minecraft provider delegates to existing reset/preflight/MCP/recorder code
and a small trusted snapshot bridge. Actual installed world and player data are
frozen, rather than assuming a seed recreates constructed structures. Restoration
is independent of both the designer and its installer.

External agents emit inert source bundles; exact-content operator approval is
required before execution. Claude gameplay runs in a separate MCP-only process
with no file/shell tools, user settings or persisted designer session. The actual
installed isolation flags and authentication are checked before restoration.
Only the frozen public goal is delivered to that process. Model prose, workflow,
infrastructure finalization and trusted objective evidence are stored separately.
A killed supervisor does not invalidate its still-running MCP child's lock.

Extraction preserves all valid public intentions and their event associations;
new production media is hardlinked when possible. Each take has a unique
production ID. Rendering uses the existing shared Motion Canvas scene, camera
offsets, narration manifest, audio builder and final MP4 checks. Existing episode
assets were not moved, overwritten or rerendered.

## Created and modified files

New sources:

* `go.mod`, `go.sum`, `cmd/emergence/`.
* `internal/config/`, `internal/storage/`, `internal/executor/`,
  `internal/harness/`, `internal/environment/`, `internal/episode/`, including tests.
* `scripts/emergence-environment.ts`, `scripts/emergence-integration.ts`.
* `episodes/episode-003/{episode.yaml,level-design.md,goal.md}`.
* `examples/island-scenario/` — complete real-block installer, verifier, manifest,
  review report and inert bundle packager.
* `tests/emergence-lock.test.ts`, `docs/emergence-cli.md`, this report.

Updated sources:

* `Makefile`: `cli`, `cli-test`, help entries; existing targets preserved.
* `README.md`, `.gitignore`, `package.json`: workflow, artifact policy and
  disposable integration command.
* `compose.yaml`: configurable loopback Minecraft port, default unchanged.
* `src/session/lock.ts`: explicit nested supervisor delegation and orphan protection.
* `src/mcp/main.ts`: trusted final position observation, fixed-start audit,
  MCP PID registration; legacy scenario handling preserved.
* `scripts/episode-plan.ts`, `tests/episode-plan.test.ts`: opt-in preservation of
  all valid intentions and media hardlinks, keeping legacy defaults unchanged.

No Episode 001/002 source, media, narration, production plan or recording changed.

## Verification results

Passed:

* `make cli` and `make cli-test` (`go test -race ./...`).
* `go vet ./...`.
* `npm run check` and `npm --prefix production run check`.
* `npm test`: 65 tests, zero failures/skips.
* `npm run integration:survival`: existing disposable live mechanics suite,
  including MCP registration and completed/stopped/aborted finalization.
* `npm run integration:orchestration`: full real Go CLI lifecycle in a temporary
  repository and unique disposable Docker project on a random loopback port.
* `git diff --check`; static validation and status of the supplied Episode 003.

The end-to-end fixture installed a real constructed island, verified it, froze
and restored world/player data, used a scripted MCP client through the harness
subprocess boundary, recorded all three actual cameras, extracted events and
intentions, authored a fixture v2 plan, rendered full/PIP/split camera layouts,
and validated the encoded MP4. No paid model or voice service was used. Synthetic
sound clips exercise audio plumbing, not narration quality or agent intelligence.
The disposable container/network were removed; diagnostic artifacts were kept.

Latest fixture:

* Repository: `/private/tmp/emergence-e2e-fVuDOK`.
* MP4: `production/output/episode-fixture-claude-001.mp4` inside that repository.
* Result: 6.4 seconds, 160 frames, 1920×1080, 25 fps, AAC audio; full decode passed,
  no black-frame intervals, all four audio windows measured successfully.
* Contact sheet: `render-contact-sheet.png`; inspected title, actual POV, PIP and
  split views. The deliberately low-resolution camera fixture enlarges inventory
  overlays and is not presented as a publishable episode.

The existing Vite/Motion Canvas setup emitted a browser error fetching its optional
editor module during headless export; the actual renderer completed, and stream,
frame-count, camera-image and audio/decode verification passed. That editor-resource
warning remains a production tooling limitation, not a bypass to another renderer.

Live testing found and fixed a restore defect: immutable snapshot permissions must
not be applied to the live world, and Docker must recreate the container after
its bind-mount directory is replaced. Failed fixture recordings and diagnostics
were preserved; no retry reused a take or modified the development world.

## Boundaries and remaining limitations

* Codex is implemented for noninteractive read-only **design generation**.
  Its gameplay run is deliberately blocked: the installed CLI cannot guarantee
  the required filesystem read isolation. A container/VM boundary is still needed.
* Real paid designer/player model calls were not exercised. Invocation arguments
  were checked against installed CLI help; runners/harnesses are covered by Go
  tests and the scripted live protocol fixture. Token/cost metadata and an actual
  resolved model name for `configured-default` are not inferred or fabricated.
* A human must review generated executable code and challenge design. The live
  verifier and preflight are distinct from heuristic reachability assumptions;
  passing arbitrary reviewed verification code does not prove solvability.
* Extraction deliberately produces the existing v1 draft. A reviewed v2 edit and
  selected complete WAV files are required before production. ElevenLabs remains
  manual/pluggable; no external service or invented credential is required.
* Agent definitions support separate sequential takes. Simultaneous multi-agent
  gameplay, additional environment providers/evaluators and Windows process
  supervision are not implemented.
* Trusted positions are sampled. A success requires an observed reach; completion
  or model claims do not prove it. Hard OS kills may leave raw/unfinalized media;
  logs and locks are preserved, and takes are never automatically rerun.
* World snapshots consume disk and remain local/ignored. Preserve both the
  snapshot and frozen identity in backups; source definitions alone are insufficient
  to recover that exact installed world.

## Guided runner follow-up

Added `pipeline.sh` and the Go `pipeline` command for explained interactive
approvals, arbitrary YAML input, a real loopback world preview, recorded-take
resume, an audio-file pause and a measured-audio v2 draft with Motion Canvas
preview before rendering. See [the guided walkthrough](guided-pipeline.md).

The automatic edit preserves whole voices and original event associations,
reports missing coverage as commentary cards, and never overwrites a manually
edited v2 timeline. The readable narration text now keeps one paragraph per WAV
in the new extraction mode; the manifest and raw goal retain their original text.
Preview processes and their locks are shut down before subsequent stages.

Follow-up verification: Go race tests and vet, 71 TypeScript tests, both type
checks, wrapper help/dry-run, and `npm run integration:pipeline` passed. The guided
integration used `/private/tmp/emergence-e2e-g9eugj`, real Minecraft/MCP recording,
actual world/editor browser pages, scripted approvals/reviewer/player, synthetic
WAVs and a 4.64-second / 116-frame 1080p MP4 that passed decode, black-frame and
all four audio-window checks. A second invocation reused the completed recording
without reset or an agent retry. World and editor screenshots were inspected.
Only the unique disposable container/network were removed. The development world
and Episode 002 source/recordings were not changed by that verification.

Vite's preview now explicitly allows its resolved dependency directory, so the
editor stylesheet works when a disposable checkout shares node_modules through a
symlink. The ordinary production directory remains the other allowed path.
The guided fixture completed export without the earlier editor-resource warning.
