/** Source time is seconds from the earliest captureOpenedAt, never session startedAt. */
export type Camera = {id:string; file:string; offsetSeconds?:number};
export type Voice = {line:number; audio:string; at:number};
/** `hold` freezes the source frame at `start` for that many output seconds, then playback resumes linearly. */
export type Shot = {kind:'full'|'split'|'pip'; cameras:string[]; start:number; duration:number; hold?:number; label?:string};
export type Segment = {
  id?:string; kind:'intro'|'shot'|'outro'; duration:number; text?:string;
  narration?:Voice[]; transition?:number;
  background?:{camera:string;time:number};
  shot?:Shot;
};
export type EpisodePlan = {version?:number; title?:string; fps?:number; resolution?:{width:number;height:number}; cameras:Camera[]; segments:Segment[]};
export const sourceTime = (camera:Camera, start:number) => start+(camera.offsetSeconds??0);
export const heldSourceTime = (camera:Camera, shot:Shot, elapsed:number) =>
  sourceTime(camera,shot.start)+Math.min(shot.duration,Math.max(0,elapsed-(shot.hold??0)));
export const durationOf = (plan:EpisodePlan) => plan.segments.reduce((n,s)=>n+s.duration,0);
