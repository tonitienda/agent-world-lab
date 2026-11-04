# Next Detonarium video — production and gameplay brief

Recorded preferences: 4 November 2026. This is the work plan for the next video,
not an implementation or a request to start a new experiment. Preserve Episode
004 and its published/as-is export, raw sessions and supplied audio.

The next video should have a complete sound-effects layer, more capable opponents,
and the production improvements learned from Episode 004. Proposed lineup:
**one LLM agent + two normal CPU bots + one substantially smarter CPU bot**.
Use the agent/model chosen for that recording; the workflow must not depend on Claude.

## Starting point

- Episode 004 take 2 has narration, opening/round/ending cards and moving slow
  motion. Its soundtrack has **no sound effects or music**.
- `scripts/detonarium-episode.ts` measures audio, builds cards and game sources,
  and writes a shared Motion Canvas edit. `narrationMode: flow` retimes the replay
  under speech with brief lead-ins instead of long routine freezes.
- Supported bot kinds are currently `passive`, `wanderer` and `hunter`. There is
  **no implemented smart difficulty/type** yet. The previous lineup was three hunters.
- The LLM API hides rival range/capacity and enemy bomb range. Visible flames,
  bomb countdowns and tick-labelled pickup events remain available. CPU bots
  still receive full simulation state; equal-information CPU planning is pending.
- The current Claude plan has supported two completed games per recording batch;
  attempts at three have hit its usage limit. Plan for **two completed games**
  initially. Two games are a small recorded sample, not a best-of-three tournament
  or evidence of a general win rate.

## 1. Sound effects — required before the next final export

Implement an event-driven soundtrack, reusable for future recorded games. This
is a required part of the next video, rather than another deferred polish pass.

| Cue | Intended treatment |
| --- | --- |
| Bomb placement | A short, clear placement click/pop |
| Explosion / chain reaction | An arcade blast with a little low-end weight; cluster overlapping blasts to avoid a wall of noise |
| Elimination | A distinct, brief cue that reads separately from the explosion |
| Arena collapse | A restrained impact/rumble at the visible falling cell |
| Pickup | A small positive chime, distinct from placement |
| Slow-motion entry / release | A subtle descending whoosh and a short release as normal play resumes |
| Round/result card | Optional restrained transition or result cue; no loud effect on every title |

Use a coherent original or appropriately licensed sound set. Preserve asset source,
licence and attribution in an asset manifest. Avoid copying a commercial game's
signature effects. Do not purchase assets or call paid sound-generation services
without specific authorization. Music is optional; it must not delay sound effects.

Synchronization and mixing requirements:

- Derive sounds from actual replay events and the **final retimed video clock**.
  A raw tick-to-seconds conversion is wrong once speech changes playback speed.
  Align onset to the visible animation, including the start of a blast, rather
  than blindly using a settled tick boundary.
- Produce an inspectable cue sheet: event/tick identity, video frame/time, asset
  and gain. Same source event gets one cue; repeated render frames and holds must
  not retrigger it. Rebuild the cue sheet whenever WAV durations or retiming change.
- For chain reactions and simultaneous deaths, preserve the event identities but
  control stacked volume. Do not add repeated full-volume bangs per flame cell.
- Retiming may change the effects' treatment, but never pitch-shift or speed up
  narration. Distinguish the editing whoosh from an in-world event. A held frame
  must not falsely suggest the game or a fuse keeps advancing.
- Keep narration intelligible. Set effects below speech, tame peaks, and duck
  effects under narration where useful. Judge the mix by listening as well as levels.
- Preview and final export must use the same sound schedule and mix. Do not ship
  a silent board as the final output or rely on sounds present only in a preview.

Acceptance: render a short recorded/stand-in sample containing placement, explosion,
elimination, collapse and slow-motion entry/release. Listen and inspect alignment.
Rebuild with a longer replacement voice clip and confirm the effects move with the
visible events, with no double triggers, narration overlap or clipping.

## 2. Stronger bots and a mixed lineup

Keep four total players: two normal opponents, one stronger opponent, one LLM.
Start with `hunter` as the normal baseline. A possible new bot name is `strategist`;
that name is a **proposal, not a supported flag or configuration value yet**.

The stronger bot should improve decisions rather than gain extra health, shorter
fuses, more starting upgrades or hidden knowledge. Prioritize:

1. **Escape reliability:** plan through chain reactions and lingering flames;
   avoid self-trapping and account for other players blocking or contesting an exit.
2. **Space control:** recognize bottlenecks, threatened dead ends and body blocks;
   force useful movement instead of dropping speculative bombs without an exit.
3. **Collapse planning:** move inward early enough, retain escape alternatives,
   and avoid pockets about to lose their only exit.
4. **Tactical timing:** consider plausible rival movement over a short lookahead;
   treat simultaneous moves as uncertain rather than assuming perfect prediction.
5. **Resource judgment:** balance upgrades, useful crate clearing and preserving
   mobility. Avoid endless cycles, repeated collision attempts or harmless bomb spam.

All CPU players compete to be the last survivor. Do not secretly make them a
coordinated team against the LLM. Make normal and smarter opponents identifiable
by stable names/labels and restrained visual differences, while keeping the LLM
easy to identify. Do not disclose a future result in those labels or cards.

Information fairness is part of this work, not a consequence of better planning:

- Audit bot danger/escape helpers, which currently read authoritative bomb ranges.
  Target the same observable-information contract as the LLM: own stats known;
  rival upgrades estimated from observed pickups/explosions; uncertainty remains
  when evidence is incomplete. Each bot can maintain its own evidence ledger.
- Do not describe an omniscient bot as simply “very smart.” If any information
  asymmetry remains, document it and disclose it in the video description. Decide
  that knowledge model before recording; do not silently mix difficulty and information.
- Keep simulation state authoritative for replay/rendering, without exposing it
  to the LLM via a helper, file-access tool or response. Retain the existing API
  redaction regression tests.

Implement the new kind consistently in bot types/factories, episode validation,
session harnesses, stand-in mode and replay metadata. Preserve old replay playback.
Record bot kind/version, rules, seed, spawn assignments and information policy.

Evaluate before spending a real LLM recording:

- Use tactical fixtures for blocked exits, short-fuse chains, collapse pockets,
  safe/unsafe pickup races and uncertainty about enemy upgrades.
- Compare the candidate against the current hunter in a fixed, documented batch
  of seeds and rotated spawn positions (for example, 50 all-CPU matches).
- Report wins/draws, survival, self-eliminations and escape failures, plus runtime.
  Check that improvement survives varied maps/positions; do not promote the new
  difficulty based on one lucky game or cherry-picked seeds.
- Keep decisions deterministic for a given seed/call sequence. Replay the chosen
  actions exactly and set a bounded planning cost so the new bot remains practical.

## 3. Carry forward the production lessons

Use [narration and round presentation](narration-and-rounds.md) as the detailed
cross-provider requirements. The following are mandatory for this video:

- **Speech separate from reasoning:** use the recorded public `narration` field
  where supported. Technical intentions/rationales are not automatic voiceover.
- **Friendly and lightly humorous:** short conversational lines, contractions,
  one idea at a time; no coordinate/tick recital. Let humour come from real events,
  without staged mistakes, a joke quota or repeated catchphrases.
- **Cross-game edit:** review both games together for repeated lines and near-identical
  routine exchanges. Keep the variants that advance the story. Do not invent new
  quotes or imply the isolated agent learned/remembers something between games.
- **Presenter vs agent:** clearly label every line, including introductions, rules,
  game transitions, results and thanks. Presenter copy is not something the agent said.
- **Finalize before audio:** after editorial cuts, number the active master script
  consecutively. `narration.txt` line N = clip N = `N_Chapter_1.wav`. Do not repeat
  the old gap-numbering confusion. Update manifest, timing references, speaker
  lists and recording sheet together before handing off the script.
- Supply master/speaker-only narration text, matching `audio-files*.txt` lists and
  a recording sheet/index with voice, filename, exact text and source. Speaker-only
  subsets keep master numbers. Include **all** presenter clips in the total.
- Preserve supplied WAVs. If edits follow audio generation, explicitly map any
  reuse/replacement; do not silently renumber existing recordings or change words.
- **Moving slow motion:** prefer source motion beneath speech to routine long
  freezes. Keep brief plan lead-ins; put rules/results on suitable cards. Preserve
  chronology and show observations after evidence. No loops or invented movement.
- **Splash screens:** channel/objective opening, a clear introduction to each game,
  a between-game card, and a restrained ending. Avoid outcome spoilers at the start.
- Re-probe actual WAV lengths, retime full clips, rebuild sound cues, and keep
  preview/export on the same editable timeline. Never truncate speech to an estimate.
- Retain Claude/agent emphasis and ownership-coloured bombs; make bot difficulty
  readable without clutter. Attribute bomb deaths, self-eliminations and collapse
  accurately rather than crediting every opponent death to the LLM.
- Create a fresh take/production directory. Keep a short preview available during
  lengthy exports. Finish with media decode, frame/audio checks and a real listening
  review of the sound mix. Be clear about sampled versus full perceptual review.

## Work order for the next session

1. Audit existing renderer/audio and bot-information paths; agree the smart bot's
   knowledge model and define its baseline comparison.
2. Implement and verify effects/retiming on existing recordings or a stand-in
   sample. No paid LLM run is needed to develop this layer.
3. Implement/test the smarter bot and required information-policy changes; run
   the documented all-CPU comparison and confirm the mixed lineup loads correctly.
4. Prepare the new episode/take configuration and friendly narration prompt.
   Start with **two games** to fit the current plan. Do not modify Episode 004's
   archived configuration or call the unimplemented bot kind from an example.
5. Record the real agent games only when the above is ready. Preserve every
   attempt and interrupted transcript. A usage limit is an incomplete game,
   not a loss or draw; do not automatically repeat expensive failed runs.
6. Review the full recorded story, prepare the final deduplicated script and
   speaker/file mapping, then have the user generate the complete audio set.
7. Measure audio, rebuild slow motion/cards/SFX, review the mixed video and export.
   Write `youtube.md` for the actual rules, opponents and information policy shown.

## Completion checklist

- [ ] Two normal bots + one demonstrably stronger bot + one LLM works end to end.
- [ ] Bot information policy is implemented/tested or remaining asymmetry disclosed.
- [ ] Placement, explosions, deaths, collapse and slow-motion effects are audible,
      aligned and intelligible under narration in the final encoded file.
- [ ] No duplicate sound triggers on holds/chain reactions; replacement audio retimes SFX.
- [ ] Friendly agent speech is distinct from presenter copy; repetitive lines are edited out.
- [ ] Master lines, filenames, speaker lists and manifest agree with consecutive IDs.
- [ ] Opening, round transitions and ending are present; moving narration is the default.
- [ ] Both completed games and their actual outcomes are represented honestly.
- [ ] Supplied audio, raw recordings, original results and prior published video are preserved.
- [ ] Relevant tests, TypeScript, replay/timeline/media checks and listening review pass.

No bot, sound asset or new experiment is implemented by this document. The next
work session should start with this brief and the linked narration requirements.
