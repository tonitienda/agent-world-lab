# Guided episode pipeline

Run from the repository root:

```sh
./pipeline.sh --design codex --player claude episodes/episode-002/episode.yaml
```

You work on the YAML and its two prompts, inspect the world, provide narration
WAVs, and watch the draft. The runner handles the individual CLI commands and
content digests. `./pipeline.sh --help` shows options; add `--dry-run` to see the
steps without running models, changing episode files, or starting services.
The wrapper builds the Go CLI when needed. Go remains the orchestration layer.
New takes request 3840×2160 at 60 fps for all cameras, and new automatic edits
export at the same format, independently of the player provider. The channel
branding is The Agent Terrarium. Existing v2 edits retain their saved settings.
Before changing a challenge, use the [prompt writing guide](episode-prompts.md)
to update the design, public goal and YAML together.

An external YAML filename also works, including paths with spaces:

```sh
./pipeline.sh --design codex --player claude '/path/to/my experiment.yml'
```

Relative prompt references resolve beside that YAML. On first use the runner
copies the validated configuration and exact prompt contents into
`episodes/<episode.id>/`. It never overwrites a different existing episode.
Repeating an unchanged external input resumes that managed copy. If you change
external inputs after import, use a new episode ID or work on the managed copy
before generating/freezing. An existing frozen scenario is reused; `--design`
does not redesign it. Choose another episode ID to try a different design.

## What happens

1. **Static checks and scenario source.** The selected designer generates inert
   installation and verification source, or the runner reuses existing scenario
   artifacts. The configured designer model is retained. No generated code runs.
2. **Code review and installation approval.** A separate tool-disabled reviewer
   session checks the exact source digest and gives a plain-language summary.
   Rejected or incomplete reviews block installation. You see the source location,
   findings and the actual consequence: the active world will be archived/reset,
   then the reviewed code will run. Press `y` to authorize that installation.
   Automated review is not a security guarantee; decline sources you do not trust.
3. **Actual world preview.** A temporary observation-only bot serves a loopback
   browser page with player/orbit views, your exact goal and automated evidence.
   Open the printed URL. Check the start, recognizable destination, resources,
   possible approaches and camera visibility. Press `y` in the terminal if this
   is the challenge you want the agent to attempt. The viewer closes cleanly,
   the scenario is reverified/frozen, and that approval starts the recording.
4. **Isolated recorded take.** The fixed frozen starting world is restored and
   the player receives only its public goal. Existing MCP tools and the recorder
   capture actions, events and all three cameras. No automatic session retries.
5. **Extraction and audio pause.** All public intentions and event references
   are extracted. The runner prints the exact narration.txt location, audio
   destination and required filenames (`1_Chapter_1.wav`, etc.). Review the text
   before using ElevenLabs or another voice tool. Put complete WAVs into the named
   directory; press Enter to recheck. Missing files keep the pause active; `q`
   stops safely. No voice service or credential is built into the runner.
6. **Measured-audio edit.** The runner probes each WAV and camera, preserves the
   v1 draft, and creates a v2 timeline compatible with the shared Motion Canvas
   renderer. Clips stay whole and in manifest order, with breathing room. Source
   coverage is chronological and does not repeat. The helper holds a real source
   frame before resuming playback when a full voice needs more time, and lists
   timing limitations in `automatic-edit-report.md`. It uses observer and combined
   views where appropriate; the opening uses a short objective over a darkened
   initial scenario frame. Slow playback still requires further implementation.
   See the
   [production editing guide](../production/README.md#keep-gameplay-visible).
7. **Edit preview and final approval.** Open the printed Motion Canvas URL. Play
   and unmute the editor. Check speech, camera cuts, anticipation of actions and
   any commentary-card warnings; replace narration cards with gameplay before
   accepting the final edit. Press `y` to render, `r` to restart/revalidate
   after edits, or `q` to pause. Your manually edited v2 plan is never overwritten
   by the automatic author. Audio changes cause a still-untouched automatic draft
   to be rebuilt on resume with newly measured durations.
8. **Rendering and encoded-media checks.** The existing Motion Canvas renderer
   and MP4 validator run. The runner prints the final MP4 and editable project
   paths. It does not publish or upload anything.

There is no blanket `--yes`: each confirmation names what it authorizes. In the
normal first run there are three approvals: installation, the world, and the edit.
The visual world approval authorizes the subsequent frozen-world recording.
A previously approved frozen scenario needs a separate confirmation before a new
take restores it. If an existing finalized recording has usable media despite an
infrastructure failure, the runner asks before proceeding with that preserved take.

## Pause, resume and another take

```sh
# The same command resumes at the existing take/audio/edit stage.
./pipeline.sh --design codex --player claude episodes/episode-002/episode.yaml

# Explicitly start another isolated take; never replace take 001.
./pipeline.sh --design codex --player claude --take 002 episodes/episode-002/episode.yaml
```

The selected take, review digest and world approval live in the ignored
`episodes/<id>/.pipeline/` directory. An unfinished `running` take is not retried:
inspect/finalize its session, then explicitly choose another take. A completed
MP4 is reused/validated instead of silently overwritten.

To compare different player prompts on the same frozen scenario, edit the managed
`episodes/<id>/goal.md` (or the configured inline goal), then run with a new unused
`--take` number. No redesign, reinstallation or refreeze is required. The runner
shows the current goal before confirmation and saves its exact text and SHA-256
hash with the take before restoring the frozen world. Editing the goal while
confirmation is pending requires another review. Existing snapshots work without
migration. World/evaluation configuration and level-design changes remain blocked.
Changing the text cannot change the destination that the frozen evaluator scores.
Resuming an existing take continues its production with the goal recorded for that
take, even if the current goal file has since changed. External YAML imports still
use the managed-copy rules above; edit the managed goal for prompt comparisons.

Scenario previews use temporary loopback ports and the existing viewer server;
no recording or playing agent runs during that preview. Motion Canvas is also
bound to loopback. Both preview processes and their locks close before later
stages. A failed or declined preview never launches gameplay or rendering.

The player currently needs to be Claude: Codex gameplay is blocked because its
installed read-only sandbox does not isolate privileged filesystem reads. Codex
works as the designer/reviewer. Generated scenario code still requires trust;
automatic review and visual inspection cannot prove solvability or safety.
The maximum configured video duration is enforced without cutting speech; an
oversized draft requires an editorial change. See the detailed
[CLI guide](emergence-cli.md) for dependencies, lifecycle and artifact layout.

## Claude authentication

Claude subscription authentication uses your normal CLI/keychain login. The
launcher preserves OAuth while disabling hooks, memory, project instructions
and built-in tools. Authentication is checked with the same isolation settings
before restoring the world. Older builds used `--bare`, which disables OAuth
and could report “Not logged in” despite a valid subscription login; rebuild
with `make cli` or use the wrapper to pick up the fix. Failed takes are preserved;
choose a new `--take` number when starting another attempt. Harness failures
print the actual stdout/stderr log paths and available error output.

## Minecraft startup failures

If a reset reports an unhealthy container, it prints recent startup logs and
container status. The prior server data remains in the reported archive.
`UnknownHostException`, `SERVFAIL` or “Failed to resolve” during installation means
Docker could not resolve a server-download host. Resets reuse a matching local
vanilla runtime from `data/minecraft-runtime-cache/<version>/`; the first reset
also looks for completed installations in prior archives. Cache entries include
SHA-256 checksums. World data, player data and configuration are always fresh.
A new version or missing/invalid cache still requires a download. Fix Docker/network DNS access
before repeating installation; changing the level-design prompt cannot resolve it.
The container may recover on its own, but that does not finish a failed reset's
verification or install the episode. Rerun the pipeline after startup is working;
review its installation/reset approval again. Do not delete the preserved archive.

## Tests

`make cli-test`, `npm test`, and both TypeScript checks cover guided confirmations,
external YAML imports, no-reset resume, unique takes, complete narration durations,
source bounds, camera readiness, explicit fallback cards and refusal of unsafe
player isolation. `npm run integration:pipeline` exercises the whole guided flow
in a fresh disposable repository/container with real browser previews, recordings,
automatic editing and MP4 export. Its approvals, reviewer/player and synthetic
WAVs are controlled fixtures, not paid inference or real narration.

`EMERGENCE_REAL_CLAUDE_TEST=1 go test -race ./internal/harness -run
TestRealClaudeOAuthCompatibleIsolation` additionally verifies the installed
Claude CLI against a local dummy model API and MCP server. It checks authentication
preflight parsing, tool restrictions and exclusion of private `CLAUDE.md` content
without model billing or Minecraft access.
