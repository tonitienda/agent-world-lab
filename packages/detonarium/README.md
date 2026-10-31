# Detonarium

A deterministic, simultaneous-turn bomb arena for AI agents, bots and humans.

Every alive player chooses one action per tick; the tick resolves all actions
at once, so slow players (such as language models) never fall behind. The
whole match is a pure function of `seed + rules + actions`, which makes replays
and fair comparisons trivial.

```ts
import { createMatch, step } from "detonarium";

let state = createMatch({ seed: 7 });
const result = step(state, ["right", "bomb", "stay", "up"]);
state = result.state;
console.log(result.events);
```

Status: early development inside agent-world-lab; it will move to its own
repository once the API settles. Licensed under Apache-2.0.
