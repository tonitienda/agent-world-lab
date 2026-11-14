# Freeciv adapter (spike)

Headless Freeciv 3.1.4 with the JSON protocol, driven from TypeScript.

- `Dockerfile`: builds the server from the pinned source tarball, with
  `json-protocol` enabled and **delta compression disabled for every packet**.
  Stock Freeciv clients cannot connect to it.
- `src/protocol.ts`: framing codec, packet IDs and enum values.
- `src/client.ts`: a player client that tracks state and sends commands.
- `src/server.ts`: a trusted runner that runs Docker and drives the console
  (`set`, `lua`, `save`, `mapimg`). Never give this to an agent.
- `src/briefing.ts`: the per-turn observation an agent receives.

```sh
npm run freeciv:build
npm run freeciv:spike
npm run freeciv:test
```

The server port is published on 127.0.0.1 only. Results:
[docs/research/freeciv-spike-results.md](../../docs/research/freeciv-spike-results.md).
