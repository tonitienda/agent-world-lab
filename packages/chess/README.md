# agent-chess

Chess matches between LLM agents and UCI engines, recorded as replays and MP4s.

- `ChessMatch` (chess.js rules): records moves, think times, public intentions and
  illegal attempts. Illegal input never changes the position; an optional streak
  limit forfeits the game.
- `parseMove` accepts SAN or UCI and forgives notation noise only (`+`, `#`, `!?`,
  `0-0`, `e8Q`). Piece letters stay case-sensitive (`bxc3` is not `Bxc3`).
- `UciEngine` speaks UCI to `$STOCKFISH_PATH` or the pinned Stockfish 17.1 WASM
  build from npm, optionally capped with `UCI_Elo` (1320-3190).
- `agentView` is all an agent sees: board, FEN, movetext, whose turn. No legal-move
  list, no evaluation.
- `renderFrame` draws a 1920x1080 SVG frame (board + players, moves, intention) with
  sliding moves, castling, fading captures and a check glow, plus the video overlays:
  win bar, captured pieces and material lead, callout banner, thinking indicator, and
  a rejected move's red ✗ with the piece(s) it meant to move.
- `analyseReplay` rates every position with full-strength Stockfish after the game
  (never shown to the players) and grades moves with Lichess's thresholds.
- `buildStory` turns a replay plus analysis into the edit: intro, narration beats before
  key agent moves and before any move the agent explained (its `rationale`, voiced in full
  while the slide keeps the one-line `intention`), slow motion with plain-language callouts at turning points, quiet
  moves played fast, rejected moves shown, outro. `renderIntro`/`renderOutro` draw the
  cards (the outro has stats and a win-chance graph).

```sh
npm run chess:record -- data/chess/rec-001 --engines 1500,2000   # engine vs engine video
npm run chess:play -- --elo 1500 --side white                    # Claude vs Stockfish, then video
```

The recorder writes `board.mp4`, `replay.json`, `analysis.json` (cached; set
`CHESS_ANALYSIS_DEPTH`, default 18, 0 to skip) and `narration.json` (card and cue start
times for the voice track). `CHESS_TITLE` and `CHESS_NEXT` set the title and the outro hook.

A move's rationale comes from `make_move`'s optional `rationale`, or else from the text the
agent wrote before the call: `scripts/chess-rationale.ts` harvests it from the transcript
(`chess:play` does this before recording). `scripts/chess-narration.ts <video dir>
<production dir>` turns `narration.json` into the episode's `narration.txt` and
`narration-manifest.json`, with presenter lines over the intro and outro cards; it warns
when a line won't fit its slot.

Rendering needs `rsvg-convert` and `ffmpeg`; pieces use the Apple Symbols (or DejaVu
Sans) chess glyphs.
