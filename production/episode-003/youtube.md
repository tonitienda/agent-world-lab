# Episode 003 — YouTube packaging

Video: `production/output/episode-003.mp4` (4:53, 1080p30). Chapter times come from the
rendered timeline. The music credit is copied from `validation.json` (`credits`), so take
it from there again if the music changes.

## Title

**Claude Opus 5.5 vs Stockfish 1500: just the board, no hints**

Chosen for search: it leads with both player names. Considered:

- Can Claude beat Stockfish with no list of legal moves?
- An AI plays chess blind to the rules: Claude vs Stockfish 1500

## Description

```
Claude Opus 5.5 plays white against Stockfish capped at Elo 1500, roughly an average club player. Claude gets no list of legal moves and no hints, only the board. When it tries an illegal move, the move is rejected and counted, and it has to try again. In between moves you hear Claude explain its plans in its own words.

The win bar and the move grades come from a full-strength Stockfish analysis run after the game. Neither player saw it during play.

Next: Claude vs Stockfish 2000.

Chapters
0:00 Claude vs Stockfish 1500
0:14 The Elephant Gambit
0:32 Queens off, a pawn up
1:08 Doubled pawns
1:50 First illegal move: Re6 through its own bishop
2:34 Stockfish blunders
3:00 Two illegal moves in a row
3:18 Trading down
3:47 Pushing the h-pawn
4:06 Promotion
4:25 Checkmate
4:33 Final stats

Final position: 57. Rc6#. 1-0, checkmate in 57 moves, with 3 illegal attempts.

Music
"Clean Soul" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/

#chess #AI #Claude
```

## Tags

```
Claude, Claude Opus 5.5, Anthropic, AI chess, AI plays chess, LLM chess, language model chess, Stockfish, Stockfish 1500, AI vs Stockfish, Claude vs Stockfish, illegal moves, chess engine, Elephant Gambit, AI agent, The Agent Terrarium, AI experiment
```

## Notes

- YouTube chapters need the first at 0:00, at least three chapters, and each one at least
  10 s long. The 10 s end card (4:43) has no chapter of its own, so Final stats runs to the end.
- Add the end-screen elements (video tiles, subscribe) over 4:43–4:53. The lower three
  quarters of the end card are left plain for them.
- Both blocked rook moves ran into Claude's own bishop: Re6 (bishop on e3) and Rxg5
  (bishop on g3). Its next try, Rc1+, was rejected as ambiguous because both rooks could
  reach c1. It then wrote Rac1+.
