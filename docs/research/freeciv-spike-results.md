# Freeciv spike results — 2026-11-08

**Outcome: feasible.** Two scripted players ("Claude" and "Codex") joined a
headless Freeciv 3.1.4 server as real human players over the JSON protocol,
next to two built-in AIs. They founded cities, handed units to Freeciv's own
auto-explore and auto-worker agents, whispered privately, controlled when
each turn ended, made contact, and signed a treaty through the real diplomacy
packets. The runner also produced a map image and a savegame. There were no
model calls, no GUI automation and no patches to game logic.

Run: `npm run freeciv:build` once, then `npm run freeciv:spike`
(`FREECIV_SPIKE_TURNS=30` by default).
Evidence (ignored runtime data): `data/freeciv-spikes/2026-11-08T18-57-03.300Z/`.

## Observed results

| Measurement | Result |
| --- | --- |
| Server | Freeciv 3.1.4 built from source in Docker (241 MB image), `json-protocol=true`, port bound to 127.0.0.1 |
| World | mapseed/gameseed 7, size 1 (26×52), 2 agent players + 2 Easy AIs, classic ruleset |
| Join | Both clients accepted as **human** players (playerno 0, 1); starting units Settlers, Workers, Diplomat, Explorer |
| Found city | `UNIT_DO_ACTION` with `ACTION_FOUND_CITY` (27): Claudepolis (24,43), Codexpolis (3,1) |
| Delegation | `UNIT_SERVER_SIDE_AGENT_SET`: Explorer to auto-explore, Workers to auto-worker |
| Private chat | `"Codex: <text>"` reached Codex as `[c …]*Oscar II* <text>[/c]` |
| Turn control | `timeout 0`: a turn ends only when both agents send `PLAYER_PHASE_DONE`. 30 turns took 21–121 ms of server time each |
| Contact | Natural contact on turn 31 (the auto-explorers met). Initial state: war |
| Treaty | Meeting, then ceasefire and mutual-embassy clauses, both accept: **war → ceasefire** |
| Scoreboard (T31) | Claude 1 city / 12 units / score 10; Codex 1 / 12 / 7; AIs 3 and 2 cities, score 12 each |
| Capture | `mapimg` PPM converted to PNG (borders, cities, units), `save` → `.sav.xz` |

## Integration lessons

- **The Debian package is not enough.** It speaks only the binary protocol. We
  build from source with `-Djson-protocol=true -Dack_experimental=true`, so
  meson accepts the build.
- **Delta compression is still on in JSON mode.** It omits unchanged fields and
  folds booleans into a `fields` bitmask. The Dockerfile patches `packets.def`
  so every packet is `no-delta`, and each JSON packet then carries all its
  fields. As a result, **stock Freeciv clients cannot join this server**. That
  is acceptable while it's local-only and only our clients connect.
- Framing: a uint16 big-endian length (including the 2-byte header), JSON
  with `pid`, then a NUL. The server switches a connection to JSON when the
  first packet parses as JSON. Use the capability string
  `+Freeciv-3.1-network city-original rsdesc32 obsinv ids32`, and the `*32` id
  fields.
- Players get the nation's leader name ("Oscar II"), not the username. Address
  agents by username: private messages accept either.
- **Console quirks:** stdout is block-buffered without a TTY (we run it under
  `stdbuf -oL`), and the console reads only one line per stdin wakeup. The
  runner appends a `lua print(marker)` after each command and sends empty lines
  until the marker appears.
- Console Lua (`lua …`) is a useful **trusted god-mode**: read-only queries
  (scores, units), `edit.unit_teleport`, `edit.create_city` and so on. It has
  **no diplomacy API**, so treaties, war and peace must go through the client
  packets.
- `set saveturns 0` did not stop autosaves; use `set autosaves ""` next time.
- `mapimg` supports only PPM in this build; ffmpeg converts it.

## Why this fits "social play"

The diplomacy packets are a real negotiation surface. Clauses cover tech, gold,
maps, cities, ceasefire, peace, alliance, shared vision and embassies. Both
sides must accept, and the server enforces the result. Chat gives private and
public channels. Agreements are non-binding in spirit: a pact can be cancelled
later (`DIPLOMACY_CANCEL_PACT`), with reputation effects. Built-in AIs give a
cheap third and fourth party, so alliances and betrayal become possible.

## Recommended next increment

1. Finish `rivalView` in `packages/freeciv/src/briefing.ts` (what an agent
   knows about its rivals), then expose `observe` / `found_city` /
   `set_production` / `set_research` / `auto_*` / `whisper` / `say` /
   `propose_treaty` / `end_turn` as MCP tools, with the console kept inside the
   trusted runner.
2. Add city production, research goals and tax rates (`CITY_CHANGE`,
   `PLAYER_TECH_GOAL`, `PLAYER_RATES`). These are the remaining "leader-level"
   levers.
3. Track each agent's private reasoning next to its public messages, for
   episode narration.
4. Video: one `mapimg` per turn becomes a time-lapse, as in the OpenTTD camera
   study.
