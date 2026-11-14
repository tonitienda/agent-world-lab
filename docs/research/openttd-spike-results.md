# OpenTTD spike results — 2026-11-07

**Outcome: feasible.** The live OpenTTD 15.3 spike passed on macOS with OpenGFX
8.0. An external Node process can observe and construct through a restricted JSON
Game Script while the simulation is paused, then advance economy dates and capture
the consequences. No engine patch or GUI automation was required.

Run command: `npm run openttd:spike` after `npm run openttd:setup`.

Local evidence directory (ignored runtime data):
`data/openttd-spikes/2026-11-07T11-03-07.633Z/`.
The manifest preserves the seed, configuration, graphics checksum and script hashes
actually used. The current admin client's protocol-3 handshake was also checked
against the running server after adding explicit version validation.

## Observed results

| Measurement | Result |
| --- | --- |
| World | Seed 7, flat 64×64 heightmap, two generated towns |
| Driver | Scripted heuristic; one idle company; no model calls |
| Built through JSON bridge | Two bus stops, one depot, entrance roads, one bus, two orders |
| Initial cash / loan | 100,000 / 100,000 internal money units |
| Cash after construction | 94,075; construction and vehicle purchase cost 5,925 |
| Time advancement | Six requested 15-day increments; all returned exactly 15 economy dates and paused |
| Passenger deliveries | 31 by day 75; 31 total at day 90 |
| Bus operating profit | +282 at day 75; +264 at day 90 |
| Company cash at day 90 | 93,764; the initial investment has not paid back |
| Capture | Two readable savegames, two minimaps and two real world PNGs |
| Checks | Type checks and all 191 repository tests pass, including six new protocol tests |

The bus carried 31 passengers in transit at day 90 in addition to the 31 already
delivered. Positive vehicle operating profit is **not** a claim of overall company
profitability: capital costs, interest and company spending are separate.

The driver also checked idle date stability and rejection of invalid coordinates
without changing the date or cash balance. Observations, action results and all
six timed snapshots are retained in the run directory. The process shuts down its
own server at the end.

## Integration lessons

- Game Scripts run while the simulation is paused. Company construction works with
  this fixture's `construction.command_pause_level = 3`.
- Use the admin port's Game Script JSON transport and `GSCompanyMode`, rather than
  trying to build routes through console commands. OpenTTD 15.3 advertises admin
  protocol **3**; the version field is one byte.
- Quote script names with spaces in INI group entries. Supply the engine's local
  language, base and compatibility files when using `-X` on macOS.
- Towns are not automatically connected. The baseline uses two stops in one town
  and existing roads; inter-town construction/pathfinding remains separate work.
- A stop's passenger acceptance and production are useful survey fields. Wait long
  enough for the first complete pickup-and-delivery cycle before judging a route.
- `GSAdmin.Send` limits JSON to 1450 bytes. Stream bounded survey records, correlate
  request IDs, and serialize requests.
- RCON completion does not imply that screenshot output is finished. Wait for the
  PNG end marker before asserting capture success or shutting down.
- The console `save` command appends `.sav`; supply a name without that extension.
- Tick-perfect stepping and deterministic replay have not been established. This
  spike controls economy dates and retains actual saves and action logs.

## Recommended next increment

Expose the restricted operations as MCP tools with validated arguments and public
intentions, keeping RCON and credentials inside the trusted runner. Then run one
agent versus two agents sharing a company under comparable total inference budgets.
Add actor attribution and arbitration before simultaneous actions. Freight, rival
companies, robust route planning, save/reload continuation, and video rendering
remain outside this successful integration spike.

See [the research decision](next-terrarium.md) and
[the run instructions and operation contract](../../packages/openttd/README.md).

## Camera study follow-up

A subsequent recorded run, `data/openttd-spikes/2026-11-07T11-28-44.586Z/`, passed
the same gameplay checks using ninety one-day advances. It retained 98 full-world
captures: world context, before/after construction, each operating day and the outcome.
Its `camera-preview.mp4` is a 36.5-second, silent 1920×1080/30fps time-lapse.

The automatic camera plan contains two wide views, six construction views,
29 queue samples, 45 bus-follow samples, eight boarding samples and eight delivery
samples. These are source samples, not separate hard cuts: event close-ups persist
across consecutive samples. A small map inset marks the crop's location.

Town buildings render transparently so foreground buildings cannot hide a stop
or bus. Queue numbers come from `GSStation.GetCargoWaiting`; delivery counts come
from the cargo monitor. The observer's rendering settings do not change gameplay.
The same 31 delivered passengers and +264 bus operating profit were observed at day 90.

`captures.json` preserves source images and observations. `camera-plan.json` is
editable and can be re-rendered without playing again. Cameras are editorial crops
of the isometric world capture; this is not continuous footage or a 3D camera system.
The renderer follows source chronology, labels daily sampling, and retains original
frames. The first camera follow-up has 196 passing repository tests, including
projection, bounds, event priority, dwell and live queue-label checks.
