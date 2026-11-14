# Episode 009 — Forest to Market

The first solo OpenTTD episode remains as delivered. This follow-up is assigned to
**episode-009**; episode-008 is reserved for the separate chess episode. Use
**Forest to Market** on screen; episode identifiers belong in internal paths and
metadata only.

## Challenge

Claude must build a timber supply chain: **forest → river crossing → sawmill → town**.
The sawmill needs incoming wood before it can produce the goods required by the
second delivery target. Road layout, crossing location, capital allocation and the
split between wood and goods trucks are the player's decisions.

The simultaneous finish conditions are 120 tonnes of wood delivered to
the designated sawmill, 28 crates of its goods delivered to Eastmere, at least 8,000
cash and positive combined truck operating profit within 240 economy days. Start
with 40,000 cash and a 40,000 loan, with no additional borrowing and at most six
trucks. See [goal.md](goal.md) for the player brief and
[scenario.json](scenario.json) for the machine-readable specification.

The clean baseline met these thresholds on day 228. Claude recovered from a
road connection failure and met every condition on day 199. The delivered
video and narration sources are described in the [production notes](../../production/episode-009/README.md).

## Prepared native environment

Verified with OpenTTD 15.3, seed 11, on a 128×128 map:

- Forest at (38,64), producing wood, west of a four-tile-wide river.
- Sawmill at (82,64), accepting wood and producing goods, east of the river.
- Eastmere at (102,92), on the sawmill's bank, with 47 vacant goods-accepting sites.
- No initial goods production, player vehicles or prebuilt river crossing.
- Starting company retains its full 40,000 cash and 40,000 loan after fixture setup.
- Buyable wood trucks carry 20 tonnes and cost 4,839; goods trucks carry 14 crates
  and cost 4,388. The tested eight-tile crossing quotes 1,030 for a wooden bridge
  before approaches. Faster bridges cost more.

Random disasters, industry closure and random production changes are disabled.
The supply-chain dependencies and budget create the difficulty; no scripted
mid-game sabotage is planned.

Run a fresh preparation (requires the existing local OpenTTD runtime):

```sh
npm run openttd:prepare-freight -- --out data/openttd-preparations/forest-to-market-new
```

The command refuses to overwrite an existing folder. It constructs the world,
checks cargo compatibility and placement, surveys vehicles and bridge choices,
then saves a native initial game, screenshot and verification report. Fixture
construction is a trusted setup operation, outside the player's action tools.
The successful local preparation is `data/openttd-preparations/forest-to-market-03/`.
Its tracked factual snapshot is [environment-verification.json](environment-verification.json).

## Readiness and calibration

**Clean scripted baseline passed on day 228.** See
[calibration notes](calibration.md) for the measured result.

The scripted baseline can survey and build freight stops and bridges, buy and
order trucks, and query cargo queues and actual deliveries. Claude has a separate restricted freight interface with the session caps and
explicit narration subjects for camera direction.

Calibration must use a fresh saved world per attempt and record days, capital
spent, cash minimum, loan, fleet operating profit, per-leg deliveries and queues:

| Check | Required evidence |
| --- | --- |
| Competent balanced baseline | Completes both delivery targets and financial conditions within the deadline using legal player actions. |
| Upstream-only baseline | Fails the goods condition even if the wood target passes. |
| Poor fleet split | Shows a measurable queue or idle capacity on one leg; an informed change improves throughput. |
| Full infrastructure budget | Roads, crossing, stations, depot, trucks, running costs and interest leave a feasible cash reserve. |
| Outcome accounting | Waiting or loaded cargo cannot satisfy delivery targets; unrelated income cannot satisfy freight counters. |

Adjust the provisional targets, budget or distances from those results before
freezing the brief. If the balanced run can simply build once and wait, revise the
constraints to create a real allocation decision. Do not prescribe mistakes or
force the recorded agent to struggle. Do not put the calibration solution into
the player prompt.

## Editorial and multi-agent potential

Potential story milestones: choosing the crossing, committing capital, first wood
arrival, first goods production, a measured bottleneck, fleet adjustment and the
verified result. Let the actual run determine which milestones occur. Camera
subjects can follow the bridge during construction, the mill's input/output, a
waiting freight stop or a truck; narrated queues can use a close-up or inset.

Keep this next experiment solo. A later collaborative version can split upstream
wood supply and crossing construction from downstream goods distribution, sharing
the company budget and negotiating the sawmill's input/output balance.

## Presentation follow-up

The episode-007 review is captured in [presentation-plan.md](presentation-plan.md):
recognisable native vehicles, readable movement, event-synchronised cash feedback
and sounds, and a controlled graphics-set comparison are required before filming.
Release planning is tracked in [release-plan.json](../../production/release-plan.json).
