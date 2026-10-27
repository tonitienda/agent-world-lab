/** Source time is seconds from the earliest captureOpenedAt, never session startedAt. */
export type Camera = {id:string; file:string; offsetSeconds?:number};
export type Voice = {line:number; audio:string; at:number};
export type Segment = {
  id?:string; kind:'intro'|'shot'|'outro'; duration:number; text?:string;
  narration?:Voice[]; transition?:number;
  shot?:{kind:'full'|'split'|'pip'; cameras:string[]; start:number; duration:number; label?:string};
};
export type EpisodePlan = {version?:number; title?:string; fps?:number; cameras:Camera[]; segments:Segment[]};
export const sourceTime = (camera:Camera, start:number) => start+(camera.offsetSeconds??0);
export const durationOf = (plan:EpisodePlan) => plan.segments.reduce((n,s)=>n+s.duration,0);
