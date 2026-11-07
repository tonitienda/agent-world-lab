# Characters

Named on-screen characters that agent seats can wear, so viewers can tell at a
glance which player is Claude and which is Codex. [roster.json](roster.json) is
the single source of truth. It sets each character's name, family, accent
colour, narration voice and skin palette.

| id | Name | Family | Look | Voice |
| --- | --- | --- | --- | --- |
| `ada` | Ada | Claude | clay-orange tunic, ivory sash, long dark hair | thoughtful, warm planner with dry wit |
| `juno` | Juno | Claude | ivory shirt, dusty-blue bands, sage trousers | brisk, curious explorer |
| `bram` | Bram | Codex | black hoodie, green zip, graphite trousers | terse, upbeat, step-by-step engineer |
| `otto` | Otto | Codex | white shirt, green chevron, black trousers | friendly, methodical instructor |

Claude characters use only the Anthropic palette (`#141413`, `#faf9f5`,
`#b0aea5`, `#e8e6dc`, `#d97757`, `#6a9bcc`, `#788c5d`). Codex characters use
only the OpenAI palette (`#000000`, `#0f0f0f`, `#ffffff`, `#f1f1f1`, `#10a37f`,
`#666666`, `#8f8f8f`). The face and hands colour (`palette.skin`) is the one
exception. A test enforces this. The skins are original: they use colour
blocking and one simple torso pattern (sash, bands, zip or chevron), with no
logos and no lettering.

## Picking characters in `episode.yaml`

Add `character:` to an agent. The agent `id` stays the Minecraft username. The
character only changes what viewers see and hear.

```yaml
play: together
agents:
  - id: ada
    harness: claude
    model: configured-default
    goal_file: goal-ada.md
    character: ada
  - id: bram
    harness: codex
    model: configured-default
    goal_file: goal-bram.md
    character: bram
```

Rules, checked when `episode.yaml` loads:

- The character must exist in the roster.
- Its family must match the agent's `harness`. A Claude character needs
  `harness: claude`, a Codex character needs `harness: codex`.
- Two agents may not play the same character.
- Casting is presentation, not scenario identity. The frozen-scenario hash
  ignores `character`, so you can add or change characters on a frozen episode
  without refreezing.

What a character changes in a take:

- **Prompt.** A `## Your character` section with the character's voice is
  appended after the shared goal. It changes the take's goal hash like any goal
  edit.
- **Cameras.** `emergence run` passes every seat the whole cast as
  `EMERGENCE_CAST` (username → name, family, accent, skin). Each recorder then
  dresses its own player and every other cast member it sees, in all three
  cameras.
  - Each player gets the character's skin and a dark nametag with an accent bar
    ("Ada · Claude").
  - A badge at the top right of each video names whose seat it is.
  - `metadata.json` records the cast, and `castTelemetry` records which
    usernames each camera dressed.

Solo takes work too: the single `emergence-player` seat wears its agent's
character.

## Detonarium (episode-004)

The Detonarium runner reads the same roster. Add `character:` under `player:`.
It must be a Claude character, because Detonarium plays Claude:

```yaml
player:
  harness: claude
  model: claude-opus-5-5
  character: ada
```

The agent is then named "Ada · Claude" on the board and in observations, and the
character's voice is appended to the prompt. Slot 0 already uses the Claude
accent `#d97757`.

## Why skins live in the cameras, not on the server

The local server is vanilla and `ONLINE_MODE=FALSE`, so no player has a skin
there, and nobody watches through a real Minecraft client. The prismarine-viewer
cameras are the only renderer, and they normally draw everyone with one shared
`steve.png`. The recorder (`packages/minecraft-recorder/cast.cjs`) patches two
pinned anchors in the viewer bundle, the same way the follow and observer
cameras do, and swaps the texture per username. If an upstream bundle changes
those anchors, the recorder fails loudly, but only when a cast is configured.
Showing skins to real clients would need a Paper server with a skin plugin
(for example SkinsRestorer) serving these same PNGs.

## Adding or changing a character

1. Edit `roster.json`. `pattern` is one of `sash`, `bands`, `zip` or `chevron`,
   `hair_style` is `short`, `long` or `hood`, and `sleeves` is `short` or `long`.
2. Regenerate the skins with `go test ./characters -update`. Never edit the PNGs
   by hand: `go test ./characters` fails if they are stale.
3. Run `npm test`, which checks the TypeScript roster reader and the recorder
   patch.
