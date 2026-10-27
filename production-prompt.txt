# Task: Produce Emergence Episode 001 in Motion Canvas

You are working on the **Emergence / agent-world-lab** project.

Your task is to take an already recorded Minecraft agent experiment and produce a complete, coherent, watchable episode using the existing Motion Canvas project.

**You are responsible for both the editorial decisions and the technical implementation.** Do not simply render the automatically generated edit plan without evaluating it.

## 1. Existing assets

The episode ID is `episode-001`. Design the implementation so future episodes can reuse the same workflow.

The following assets already exist locally:

- `data/<episode>/events.json` — chronological record of the agent's actions, intentions, observations, and results. This is local data and is not committed to Git.
- `production/public/<episode>/video/` — recorded agent POV and observer camera videos.
- `production/public/<episode>/audio/` — ElevenLabs narration WAV files.
- `production/<episode>/` — existing Motion Canvas episode project, narration text, narration manifest, and generated edit plan.

ElevenLabs audio filenames follow this pattern:

`1_Chapter_1.wav`, `2_Chapter_1.wav`, etc.

**Do not rename, replace, or regenerate any existing audio or video assets.**

First inspect the repository to establish the actual file locations and available scripts. The current code may use `data/mcp-sessions/<episode>` instead of `data/<episode>`; support the actual local layout without assuming the files have been committed.

Do not reset Minecraft or execute another agent experiment.

## 2. Understand what happened

Read the complete `events.json`, not only the first 20 intentions.

Reconstruct the experiment chronologically, including:

- The agent's objective and initial plan.
- What it actually attempted.
- Successful and failed actions.
- Unexpected observations.
- Changes in strategy.
- Meaningful intermediate achievements.
- The final outcome.

Distinguish intentions from actions and verified results. An intention is not proof that the agent successfully performed something.

Identify the narrative arc of the experiment.

For this episode, the agent attempts to collect dirt, learns how dropped items behave, builds an elevated platform with stairs, and eventually climbs onto it.

Use the recording to confirm what can actually be shown.

Preserve authentic agent behavior, including mistakes and recovery. Do not fabricate dialogue, observations, achievements, or actions.

## 3. Make editorial decisions

Create an intentional edit rather than showing every action.

Prioritize moments that advance the story, reveal interesting behavior, demonstrate agent reasoning, or show meaningful interactions with the world.

Remove repetitive operations where they don't contribute to understanding.

A possible story structure is:

1. Hook: Show an interesting moment or the eventual outcome.
2. Setup: Establish the agent's goal and environment.
3. First interaction: Mining dirt and discovering how collection works.
4. Progress: Gathering enough building material.
5. Construction: Building the stairs and platform.
6. Payoff: Climbing onto the finished platform.
7. Ending: Brief conclusion and viewer invitation.

Treat this as a starting point, not a rigid script. Base the final choices on the actual experiment.

Avoid long stretches of repetitive digging or walking.

Do not make the video excessively long just because many events were recorded. Prefer a concise, interesting first episode.

## 4. Narration and audio synchronization

Use the existing narration manifest and ElevenLabs WAV files.

The audio is already generated. Preserve the correspondence between narration lines and audio filenames.

You may omit entire narration clips if their associated moments are editorially unnecessary, but do not reorder their meanings, edit their spoken words, splice individual words, or silently substitute new narration.

If a selected sentence needs more time than the associated action takes, use additional appropriate footage, a reaction shot, or an establishing shot.

**Let the actual audio duration drive the minimum duration of each corresponding timeline segment.**

Use `ffprobe` or equivalent to determine WAV durations.

Do not truncate narration because of an arbitrary nine-second segment limit.

Provide a small amount of breathing room between narration segments.

Ensure that speech never overlaps accidentally.

Retain meaningful Minecraft audio where available. Avoid unwanted duplicated audio when two camera recordings are shown simultaneously.

Add background music only if an appropriate licensed asset already exists and can be identified. Otherwise deliver a complete episode without music; do not block production.

## 5. Camera direction

We have two recordings of the same experiment:

- Agent POV: Useful for interactions, mining, placement and what the agent sees.
- Observer: Useful for character movement, establishing geography, construction progress, and showing the agent in the environment.

Use both deliberately.

Support at least:

- Full-screen agent POV.
- Full-screen observer.
- Picture-in-picture.
- Split screen when it adds useful information.

Do not overuse split screen.

Align the camera footage using the existing recording metadata and offsets.

Do not assume the videos start at exactly the same world timestamp.

Transitions between cameras should be visually coherent. Ensure the observer shot actually shows the character or relevant action; use POV when the observer view is uninformative.

When useful, retain footage immediately before and after an action rather than cutting at the exact event timestamp.

## 6. Motion Canvas implementation

Build on the existing project in `production/<episode>/`.

Inspect the current scene implementation, project configuration, edit-plan format, render scripts, and existing tests before modifying anything.

Implement missing functionality needed to produce the episode in Motion Canvas, especially:

- Loading and playing the existing narration WAV files.
- Synchronizing narration with the video.
- Supporting camera changes and multi-camera layouts.
- Using the edit plan as the declarative timeline.
- Reusable transitions and basic title/outro cards.
- Rendering the complete episode to MP4, using FFmpeg for final encoding/muxing if necessary.

Prefer reusable components and episode-independent logic rather than hardcoding episode-001 throughout the system.

Keep the edit plan human-readable and manually editable. I want the ability to review and adjust editorial decisions later without rewriting the scene code.

If Motion Canvas preview or export cannot reproduce the final synchronized result, fix that integration rather than silently switching to the existing simplified single-camera renderer.

Do not regress the existing simple renderer.

## 7. Outputs

Produce:

**A. Editorial timeline**

`production/<episode>/edit-plan.json`

The final selected shots, camera layouts, source timestamps, durations, and narration references.

**B. Editorial report**

`production/<episode>/editorial-report.md`

Document:

- What happened in the experiment.
- Why you selected the main moments.
- What you omitted and why.
- Camera decisions.
- Narration/audio mapping.
- Any limitations in the recordings.
- Any unresolved synchronization or rendering concerns.

**C. Motion Canvas project**

An updated, functional Motion Canvas episode using the chosen edit.

**D. Rendered video**

`production/output/<episode>.mp4`

The video must include the selected footage and existing ElevenLabs narration.

**E. Validation**

Add or update automated tests covering at least:

- Narration-to-audio filename mapping.
- Audio duration and segment duration consistency.
- Camera synchronization.
- Source timestamp bounds.
- Missing asset handling.
- Validity of the declarative edit plan.

Run the relevant checks and render the video if local dependencies and assets permit.

## 8. Quality requirements

This is the first proper episode of Emergence. It establishes the production quality viewers should expect from the channel.

The episode should feel like an observation of an autonomous agent interacting with a simulated world, not a random compilation of Minecraft actions.

Maintain an observational, curious tone. Avoid exaggerated YouTube editing, unnecessary visual effects, or pretending the agent is more intelligent or successful than the recording demonstrates.

Pay attention to:

- Narrative clarity.
- Visual continuity.
- Readable titles.
- Smooth camera transitions.
- Audio levels.
- Correct synchronization.
- A satisfying ending.

There must be no black frames, unexplained freezes, silent narration gaps caused by missing files, or footage outside valid recording bounds.

## 9. Workflow and constraints

1. Inspect the available assets and current code.
2. Analyze the recorded experiment.
3. Write the editorial report and propose a concrete timeline.
4. Implement the timeline and required Motion Canvas functionality.
5. Validate and render.
6. Inspect the resulting video using available tools.
7. Fix any problems discovered.
8. Report the final output path, duration, validation results, and remaining limitations.

You may modify the existing episode edit plan.

Do not overwrite the original `events.json`, narration recordings, or camera recordings.

Do not regenerate the experiment or call ElevenLabs.

Do not stop after writing a plan or documenting what should be done. Implement the working production pipeline and episode.

If you cannot render due to a genuine environmental limitation, implement and validate everything possible, report the precise blocker, and give the exact command needed to finish locally.

**Success criterion:** I should be able to open the Motion Canvas project, review the edited episode with correctly synchronized narration and cameras, and obtain a final MP4 without manually renaming files, placing audio clips, or editing the timeline myself.