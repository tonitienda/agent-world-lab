# Survival environment validation

Validated on 27 October 2026 with Node 22.21.1, Minecraft Java 1.21.4,
Mineflayer 4.39.0 and mineflayer-pathfinder 2.4.5.

## Executed checks

| Check                                                                | Result                                |
| -------------------------------------------------------------------- | ------------------------------------- |
| `npm run check`                                                      | Passed                                |
| `npm test`                                                           | 39 tests passed, no failures or skips |
| Prettier checks on new/expanded TypeScript modules and configuration | Passed                                |
| `git diff --check`                                                   | Passed                                |
| `node --check packages/minecraft-recorder/index.cjs`                 | Passed                                |
| `docker compose config -q`                                           | Passed                                |
| Both reset CLI presets in dry-run mode                               | Passed; no reset performed            |
| `npm run integration:survival -- --capture`                          | Passed, exit status 0                 |
| Both resulting MP4s decoded with FFmpeg `-xerror`                    | Passed                                |

The repository has no configured lint command. Type checking, formatting checks,
syntax checks and diff whitespace checks were run separately.

The integration command owned temporary Docker containers on random loopback
ports, with isolated data directories. It exercised:

- Mining wood and collecting its drop; crafting planks and a crafting table.
- Crafting wooden pickaxe/axe, equipping the pickaxe, and harvesting stone.
- Crafting, placing and operating a furnace, including fuel, input, progress and
  withdrawing a completed iron ingot.
- Crafting/placing a chest, depositing and retrieving items, and inspecting
  inventory while its container window remained open.
- Opening a wooden door and verifying its changed block state.
- Reducing hunger in the fixture, consuming bread, and verifying increased food.
- Observing a controlled hostile husk, attacking it, and verifying server-side damage.
- Missing resources, invalid quantities/slots/actions, unknown entities and
  unreachable targets.
- Existing `integration.ts` and `bot-actions-smoke.ts` against the disposable server.
- Real MCP registration and argument validation, intention/attempt/failure event
  ordering, and `completed`, `stopped`, and `aborted` finalization.
- Both cameras, with observer follow telemetry and final MP4s.
- A separately generated normal overworld with seed `12345`, checking properties,
  actual `level.dat` generator/seed and a bounded natural-spawn observation.

Superflat generation was also checked against its actual `level.dat`. Resource
blocks, extra recipe inputs, food and the hostile mob were controlled fixtures;
the normal overworld received no resource grants or spawn adjustments.

The final camera files were H.264, 426×240, with 471 POV frames and 413 observer
frames. Capture timings remain approximate, as recorded in camera metadata.
Temporary artifacts from the final successful run:

`/private/tmp/awl-survival-fixture-CsNVrK/captures/2026-10-27T19-49-21-468Z/`

Unit tests additionally cover reset refusal before any server/data operation,
archiving, both presets, verification failure, stale/malformed locks, concurrent
idempotent finalization, retaining the other camera after an encoder failure,
recording overwrite protection, visibility/reach validation, container inventory
views and the food-registry ID mismatch. Production/planner tests include a failed
craft with public narration and POV footage.

## Compatibility findings and limits

Repeated crafting needs server inventory reconciliation; each batch now checks
its actual output. Container inventory must be read from the active window.
Minecraft-data food IDs differ from item IDs for this protocol, so food lookup
uses names. Vanilla normalizes empty normal-world generator settings to `{}`;
verification accepts that representation and still checks the actual generator.

Arbitrary terrain, water routes and structure layouts are not comprehensively
covered. Canceled navigation can be retried; uncertain protocol-operation timeouts
require finalization. Successful `drop`, `use_item` and generic `interact_entity`
paths were not separately exercised in the live fixture. A short item activation
is not an aimed/charged weapon interface. Trade, brewing and enchanting windows
need additional specialized interfaces. See README for the full tool contract.

The existing experiment server remained healthy on its original localhost port.
Read-only preflight confirmed connectivity but reported its preset configuration
as unverified because it has no new reset manifest. Its world was not reset,
its recordings were not deleted, and its sessions were not terminated. Existing
local edits were retained. No branches, commits or pushes were created.

These results verify mechanisms in controlled fixtures; they do not guarantee
that an autonomous agent can establish a self-sufficient base before a deadline.
