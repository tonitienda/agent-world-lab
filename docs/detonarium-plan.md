# Detonarium and Chess plan

For the next Detonarium video, start with the
[next-video brief](detonarium-next-video.md): required sound effects, a proposed
two-normal/one-smart CPU lineup, information fairness, and the production lessons
from Episode 004. The sections below retain the original engine/pipeline design.

Original episode allocation:

- **Episode 004 — Detonarium**: our own bomb-arena game. One LLM agent vs
  three CPU bots, best-of-N rounds.
- **Episode 003 — Chess**: the agent vs Stockfish at a fixed rating
  (`chess.js` for rules).

Both need the same pipeline generalization (see "Pipeline work"). Detonarium
goes first by choice; it is built so the engine itself is reusable by others.

## Detonarium engine

Lives in `packages/detonarium/` as an isolated, dependency-free package. It
must not import anything from `src/` or know about LLMs, MCP or video. Once the
API settles (after the Detonarium episode ships) it is extracted to its own public repo
with `git subtree split`, licensed Apache-2.0. It is our own game in the
bomb-arena genre: its own name, art and rules; no third-party names or assets.

### Rules (v0)

- Grid (default 11×11) of floor, indestructible walls (border and pillars)
  and crates. Crates may hide pickups: `+bomb` capacity or `+range`.
- 2–4 players spawn in corners with a crate-free safe zone.
- Simultaneous turns: every alive player picks `stay | up | down | left |
  right | bomb` each tick; the tick resolves all actions at once.
- Bombs have a fuse (default 8 ticks) and blast in a plus shape up to the
  owner's range, stopped by walls, destroying the first crate hit, and
  chaining into other bombs in the same tick. Flames linger briefly.
- Players in flames are eliminated; the kill is credited to the bomb owner.
- **Sudden death** (channel twist): from a configured tick, one cell per tick
  turns into wall in an inward spiral, crushing anything on it.
- The match ends when at most one player is alive (winner or draw) or at
  the tick limit (draw).

### Design properties

- `step(state, actions) → { state, events }` is pure and deterministic; the
  board is generated from a seed. Replays are `seed + rules + action log`.
- Events (`bomb_placed`, `exploded`, `crate_destroyed`, `pickup_collected`,
  `eliminated`, `collapse`, `match_over`) feed narration and editing.
- Coordinates are `(x, y)`, origin top-left, `x` to the right, `y` down.

### Engine milestones

1. Core rules + tests (this step).
2. CPU bots (`passive`, `wanderer`, `hunter`) with their own seeded RNG.
3. Replay format and a reference frame renderer (PNG/SVG per tick).
4. README, examples, license, extraction.

## Pipeline work (shared with Chess)

- `internal/config`: provider switch (`minecraft | detonarium | chess`) with
  per-provider blocks; `rounds:`; evaluation types `win_match`,
  `survive_ticks`, `win_rounds`.
- `internal/environment`: a `Provider` per engine; Detonarium "reset" is
  `seed + board.json`, freeze is a hash.
- `internal/episode/run.go` / `production.go`: per-provider MCP environment,
  evaluation and camera list.
- `src/mcp/main.ts`: remove direct Minecraft imports; register a
  `DetonariumAdapter` with macro-actions (`observe`, `move_to`, `place_bomb`,
  `wait`, `step`). CPU bots keep acting while a macro runs.
- Recording: render tick frames to `observer` (full board), `agent-pov`
  (what the agent saw) and `follow` (zoomed crop); events carry `tick`.

## Open decisions

- Full-board vs. limited-view observation for the agent.
- Rounds per episode and how notes carry between rounds.

## Next recording: observation fairness

The intended contract is full-board visibility, **without automatically reporting
opponents' upgrade totals**. This differs from hiding visible fire or changing the
rules. Everyone starts with the published base stats. The agent may track each
rival's observed pickups and learn from visible explosions itself.

The observation contract is below. Filtering is implemented for the LLM API;
the CPU information audit is tracked separately.

- Keep own range/capacity and observable rival identity, position and alive status.
  Remove `rivals[].range` and `rivals[].bombCapacity`.
- Keep visible bombs, positions and owners. Remove `range` from enemy bomb records
  too; hiding the rival field alone still leaks the same information. Own bomb
  range may remain. Shared fuse rules and visible countdowns are unchanged for
  this revision; the requested restriction concerns opponent blast reach.
- Keep actually burning cells visible. Their observed extent can support an
  inference, but a wall/crate can truncate a blast, so it is not proof of maximum
  range. Do not supply future enemy blast previews or automatic safety verdicts.
- Observable pickup events may identify who collected which item. During macros,
  preserve chronological order and tick so an agent can maintain its own evidence
  ledger. Do not replace hidden fields with an automatic rival upgrade counter.
  Missed evidence leaves uncertainty.
- Apply the contract to `observe` and every action response, event/alert text,
  error and helper tool. Authoritative state/replay data may retain full stats for
  simulation and editing, but must be inaccessible to the playing agent through
  files or extra tools. Clearly distinguish privileged viewer overlays.
- Audit CPU bot danger/escape helpers too. Use observation-based estimates or
  explicitly document any remaining information asymmetry; do not claim equal
  information while bots read authoritative rival ranges.

Implemented in `src/detonarium/session.ts`: the API omits rival upgrade totals
and enemy bomb ranges in observations and all action results. Event messages carry
their tick so pickup evidence stays usable during macros. The shared MCP response
paths use this filtered view, including refused actions and game-over responses.
Simulation/replay stats remain intact, and no inferred upgrade counter is supplied.

CPU information parity is still pending: bots in `packages/detonarium/src/bots.ts`
receive full simulation state and use exact bomb ranges for danger/escape planning.
This API change restricts the LLM player; it does not change bot behaviour or claim
equal information between the LLM and CPU opponents.

Regression checks and remaining bot audit:

1. Increase a rival's private stats in a fixture; no upgrade totals or enemy bomb
   ranges may appear in any agent-visible response, including action results.
2. Own stats and visible board, flames and pickup events remain usable.
3. Pickup events across multi-tick macros identify the actor and tick without
   reporting a derived rival stat total.
4. Audit bot planning against hidden versus observed upgrades and document its
   knowledge model. Unobserved private stats must not masquerade as observations.
5. Seeded replay reconstruction and simulation remain deterministic.

Precise avoidance is legitimate when supported by observations. Remove privileged
knowledge rather than forcing bad moves, random deaths or false uncertainty.

## Next production handoff

Follow [narration and round presentation](narration-and-rounds.md): label every
presenter and agent clip, hand off both speaker bundles, and include an opening
splash plus introductions/transitions for each game. Agent narration should come
from the dedicated spoken field, with a friendly voice and situational humour.
Use a fresh take/production directory for replacement games and generated audio.
