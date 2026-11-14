# Forest to Market calibration

The initial 160-tonne and 80-crate targets were too high for the strategies tried.
The new proposed target is **120 tonnes of wood and 28 crates of goods in 240
days**, with the existing 8,000 cash reserve and positive fleet operating profit.
A repair branch met those revised conditions with 12 days to spare.

| Scripted trial | Day | Wood delivered | Goods delivered | Cash | Fleet profit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Four trucks upfront, original town stop | 240 | 120 | 0 | 7,296 | 1,871 |
| Staged purchase, original town stop | 240 | 120 | 0 | 12,056 | 2,244 |
| Staged purchase, town stop repaired | 228 | 120 | 28 | 11,110 | 3,095 |

Both initial trials reached the town with goods aboard. The stop was outside the
required acceptance catchment. The survey now uses the engine's truck stop
radius, which is three tiles in this fixture. A fresh build with the corrected
stop passed the route construction and acceptance checks. The repair branch
continued from a copy of the staged day-120 save, built a stop with verified
acceptance and updated the goods truck's order. The first observed delivery at
day 168 credited 14 crates to Eastmere and 14 crates to the sawmill origin
monitor, with 403 in transport income.

The clean staged run repeated the result from a fresh map and the corrected
stop. At day 228 it had delivered **120 tonnes and 28 crates**, with **11,645
cash**, **3,095 operating profit**, the original loan and three trucks. The
remaining 12 days provide a small margin. Its data is under
`data/openttd-previews/freight-009-clean/`.

The new freight player interface enforces the borrowing, fleet and time limits.
The Claude take starts from an untouched fixture and gets the public objective
and survey tools. The route and checkpoints from calibration are kept outside
the player prompt and the episode.

Raw evidence is in `data/openttd-previews/` under `freight-balanced-03`,
`freight-staged-01`, `freight-corrected-02`, and `freight-construction-check`.
The review screenshots retain the original 160/80 targets used for those trials.

The corrected upfront-purchase comparison reached day 240 with **120 tonnes and
52 crates**, **7,543 cash**, and **3,379 fleet operating profit**. It missed the
cash reserve despite moving more goods than the staged baseline. Both runs used
the same town stop and map. Evidence is under
`data/openttd-previews/freight-009-upfront/`.
