# Agent World Lab — instructions for implementation agents

This repository is an extensible virtual-world agent lab, not a Minecraft-only bot.

- Keep `src/core` free of Minecraft imports and assumptions.
- Add new environments under `src/environments/<id>`, registered in `src/environments/index.ts`.
- Do not give experiment agents privileged world state (entire map, global block lookup, arbitrary teleportation).
- Tools must respect normal game physics, inventories, reachability and survival rules.
- Always enforce action, time and cost budgets **in the future experiment runner**, never just in prompts.
- Preserve human-readable observations and structured action failures.
- Never expose offline-mode Minecraft to public networks or ship proprietary assets.
- Run `npm run check`, `npm test` and `npm run smoke` when a real server is available.
- Store runtime state under `data/` and never commit world saves, secrets or raw recordings.
