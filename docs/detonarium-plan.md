# Detonarium and Chess plan

Next two episodes:

- **Episode 003 — Detonarium**: our own bomb-arena game. One LLM agent vs
  three CPU bots, best-of-N rounds.
- **Episode 004 — Chess**: the agent vs Stockfish at a fixed rating
  (`chess.js` for rules).

Both need the same pipeline generalization (see "Pipeline work"). Detonarium
goes first by choice; it is built so the engine itself is reusable by others.

## Detonarium engine

Lives in `packages/detonarium/` as an isolated, dependency-free package. It
must not import anything from `src/` or know about LLMs, MCP or video. Once the
API settles (after episode 003 ships) it is extracted to its own public repo
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
