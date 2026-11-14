import {resolveTarget, type CameraPlan, type Recording, type Shot, type VisualTarget} from './camera.js';

export type NarrationCue = {
  eventId: number;
  heading: string;
  camera: Shot['camera'];
  target?: VisualTarget;
  inset?: {target: VisualTarget; label: string};
};
type RecordedAction = {id: number; beforeCapture?: number; afterCapture?: number; args: {narration?: string}};

/** Explicit editorial subjects grounded in entity IDs, not guesses from queue thresholds. */
export function applyNarrationCameras(recording: Recording, plan: CameraPlan, actions: RecordedAction[], cues: NarrationCue[]) {
  const audit = [];
  const seen = new Set<number>();
  for (const cue of cues) {
    if (seen.has(cue.eventId)) throw new Error(`Duplicate narration camera for event ${cue.eventId}`);
    seen.add(cue.eventId);
    const action = actions.find(action => action.id === cue.eventId);
    if (!action?.args.narration || action.beforeCapture === undefined || action.afterCapture === undefined)
      throw new Error(`Narration camera requires a recorded spoken action: ${cue.eventId}`);
    const start = action.beforeCapture, end = action.afterCapture;
    if (end < start || !recording.captures[start] || !recording.captures[end]) throw new Error('Invalid narration capture bounds');
    for (let i = start; i <= end; i++) {
      const capture = recording.captures[i]!;
      const shot = plan.shots.find(shot => shot.capture === i);
      if (!shot) throw new Error(`Missing camera sample ${i}`);
      const focus = cue.target ? resolveTarget(capture, cue.target) : undefined;
      if (cue.inset) resolveTarget(capture, cue.inset.target); // Missing subjects must not silently switch to a different stop.
      Object.assign(shot, {camera: cue.camera, focus, narrationHeading: cue.heading,
        narrationEvent: cue.eventId, inset: cue.inset, subject: cue.target?.kind === 'station' ? cue.target.id : undefined,
        vehicle: cue.target?.kind === 'vehicle' ? cue.target.id : undefined});
    }
    audit.push({eventId: cue.eventId, narration: action.args.narration, firstCapture: start, lastCapture: end,
      camera: cue.camera, target: cue.target, inset: cue.inset,
      firstDate: recording.captures[start]!.snapshot.date, lastDate: recording.captures[end]!.snapshot.date});
  }
  return audit;
}
