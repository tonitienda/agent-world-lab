# Next terrarium research — 2026-11-07

## Decision

Investigate **OpenTTD first**, with a bounded cooperative transport challenge.
The [initial live spike passed](openttd-spike-results.md); its results and remaining
integration work are preserved separately from these original hypotheses.
Minecraft covers open-world survival/building; Chess and Detonarium already cover
competition. Transport adds persistent systems, shared planning, resource allocation,
and visible consequences of coordination failures.

This is an editorial/engineering hypothesis, not evidence of audience demand.

| Candidate | Strength | Video risk | Multi-agent experiments |
| --- | --- | --- | --- |
| Transport Tycoon / OpenTTD | Visible network growth, bottlenecks, debt and recovery | Routine profitable operation becomes repetitive | Shared company; rival companies; cooperating teams competing |
| Civilization | Expansion, alliances, betrayal and war | Turning points require substantial context; full campaigns are long | Independent civilizations with diplomacy; councils controlling one civilization |
| D&D | Personalities, creative solutions and conflicting motives | Exposition and dialogue can dominate; flexible adjudication confounds evaluation | Cooperative party; asymmetric knowledge; optional agent DM backed by authoritative state/dice |
| Small Overcooked-style simulation | Short rounds, interdependent work, obvious coordination failures | Shallower world; likely requires a custom environment | Fast pipeline benchmark for delegation, communication and recovery |

## Proposed transport pilot

- Small map, a few towns and eventually one short industrial chain.
- Start with two agents sharing one company and negotiating responsibility.
- One measurable objective: deliver a fixed cargo quantity by a deadline without bankruptcy.
- Approximately 30 decision rounds as a starting hypothesis; advance the simulation
  explicitly between rounds. This would be our wrapper, not a native game mode.
- Target a 6–10 minute edit: plan, first route, largest setback, outcome.
- Accelerate routine operation; retain the causal connection between decisions and consequences.
- Compare one agent with two under comparable total inference budgets and the same
  scenario. Track deliveries, profitability, duplicate work, conflicting actions,
  and recovery. Do not treat a single seeded run as a general result.
- Later: two cooperating teams running rival companies.

Civilization should start with a small map, fixed turn limit and contested objective.
D&D should start with a rescue/heist one-shot and a hard ending condition, rather
than a full campaign. An authoritative rules engine should own state and dice.

## OpenTTD engineering findings

OpenTTD has two scripting surfaces: company AIs (NoAI) and world Game Scripts (NoGo),
written in Squirrel. The admin TCP protocol can pass JSON to a Game Script through
`GSEventAdminPort`; replies use `GSAdmin.Send`. `GSCompanyMode` lets a Game Script
perform ordinary company actions. This suggests an external Node/LLM → admin port
→ restricted Game Script bridge, without giving the agent arbitrary console access.

Important questions for the spike:

1. Does a Game Script process requests while the simulation is paused?
2. Can it build roads/stops/depot/vehicle/orders in company mode while paused?
3. Can we advance a bounded amount of simulation time and pause again?
4. Can observations verify vehicle movement, cargo and financial consequences?
5. Can we save states and obtain real game images for eventual video production?

The admin protocol alone is not a gameplay API. NoAI is not a ready-made external
LLM interface. `GSAdmin.Send` has a 1450-byte JSON limit, requiring bounded replies.
Use version-matched APIs; development docs can expose methods absent in stable releases.
Seed plus action logs are useful evidence, but are not yet a demonstrated deterministic
replay contract for OpenTTD. Preserve saves, version, configuration and script hashes.

## Sources

Checked 2026-11-07; implementation spike pins OpenTTD 15.3 and OpenGFX 8.0.

- [OpenTTD stable downloads and checksums](https://www.openttd.org/downloads/openttd-releases/latest)
- [OpenGFX downloads and checksums](https://www.openttd.org/downloads/opengfx-releases/latest)
- [AI scripting overview](https://wiki.openttd.org/en/Development/Script/Main%20Page)
- [Game Script overview](https://wiki.openttd.org/en/Manual/Game%20script)
- [Admin port overview](https://wiki.openttd.org/en/Development/Server%20admin%20port)
- [15.3 admin protocol](https://github.com/OpenTTD/OpenTTD/blob/15.3/docs/admin_network.md)
- [15.3 packet definitions](https://github.com/OpenTTD/OpenTTD/blob/15.3/src/network/core/tcp_admin.h)
- [15.3 Game Script loop](https://github.com/OpenTTD/OpenTTD/blob/15.3/src/game/game_core.cpp)
- [15.3 paused game loop](https://github.com/OpenTTD/OpenTTD/blob/15.3/src/openttd.cpp)
- [GSAdmin reply size limit](https://docs.openttd.org/gs-api/classGSAdmin)

These sources establish engine capabilities, not comparative video performance.
See [the spike](../../packages/openttd/README.md) for actual validation and limitations.
