# Narration and round presentation

These requirements apply to future The Agent Terrarium episodes across agents and
games. Preserve existing takes and their text/audio mappings. A fresh recording or
replacement audio set gets its own production/take directory.

## Speakers and audio handoff

- **Agent**: public commentary actually supplied by the playing agent, using its
  `narration` field where supported. Technical intentions and rationales are log
  material, not automatic voiceover. Older providers may use a public `intent` or
  `report_intention`; select its speakable commentary, not internal deliberation.
- **Presenter**: human/editor-authored introductions, rules, game transitions,
  verified results and closing remarks. Never attribute these words to Claude or
  another playing agent. The earlier “Two games: a draw and a win…” summary was
  presenter copy, not a recorded Claude statement.
- Keep the manifest authoritative: every clip has its speaker, exact spoken text,
  exact output filename, source/provenance and placement. Label editorial rewrites
  explicitly; do not present newly written words as verbatim recorded agent speech.
- Deliver a readable recording sheet with **all** clips in episode order, clearly
  labelled AGENT or PRESENTER, including splash-screen speech and the ending.
  Show counts for each speaker and a total. Do not rely on JSON alone to disclose
  speaker changes.
- Also provide separate, speech-only `narration-agent.txt` and
  `narration-presenter.txt`, with a filename mapping for each. Keep the master
  `narration.txt` if useful. Preserve global manifest IDs when splitting speakers;
  the first presenter clip is not necessarily `1_Chapter_1.wav`.
- Generate one whole clip per manifest entry. Intro, rules, transition and outro
  clips are part of the required audio set even though the playing agent did not
  say them. Check the exact filename set before declaring audio ready.
- Agree the spoken script and speaker mapping before generating audio. Re-probe
  every replacement recording and rebuild timing from its actual length; never
  trim speech to an old estimated pause.

## Friendly speech with a sense of humour

Speak like a friendly person sharing a game with the viewer. Use contractions,
short sentences and one useful idea at a time. Show curiosity, uncertainty and
occasional amusement at what actually happens. A light, situational sense of humour
is part of the voice; it should not sound like a tactical report read aloud.

Routine commentary is usually 3–8 words. A meaningful plan or correction is usually
one sentence, around 20 words or fewer. Avoid coordinates, numbered lanes, tick
arithmetic, tool names, parenthetical asides and inventories of possible moves.
Use visible landmarks. Keep detailed calculations in a separate technical summary.

Examples of delivery, not lines to repeat:

- Routine: “Around the corner. Much healthier.”
- Plan: “I'll block the passage, then leave before the fireworks.”
- Real mistake: “I've blocked my own exit. Excellent planning.”
- Uncertainty: “That blast might reach me. I'll give it some room.”

Let jokes come from real setbacks or observations. No joke quota, forced catchphrase,
mockery, invented events or risky moves staged for entertainment. Do not announce
success before the tools establish it, imply cross-game memory that was not supplied,
or sound certain about information the agent has not observed. Apply the same
conversational standard to presenter copy. Read all copy aloud before audio handoff.

## Splash screens

Include these deliberately in the edit plan:

1. **Opening**: The Agent Terrarium branding, episode/game title, the actual agent
   and a short objective. A darkened initial scenario frame is a useful background.
   Keep the result unrevealed.
2. **Game/round introductions**: a clear “Game 1”, “Game 2”, etc. card before each
   round. Between games, use a brief transition card so viewers recognise the reset.
   A verified previous result can appear here; do not preview the next outcome.
3. **Ending**: a restrained result/thanks treatment after the last verified result.

Cards can use presenter speech or be silent. Include any speech in the presenter
bundle and manifest. Allow roughly 2–3 seconds for a silent transition; for a voiced
card, fit the full measured clip plus breathing room. Keep cards readable, avoid
redundant long introductions, and retain gameplay during ordinary agent commentary.

This is a production requirement, not a claim that existing builders insert cards.
The current Detonarium two-game builder emits one continuous board shot and needs
an implementation change to create these interstitial segments.
