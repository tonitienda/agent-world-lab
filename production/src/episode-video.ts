import {Video} from '@motion-canvas/2d';
import {DependencyContext} from '@motion-canvas/core';
import {waitForMedia} from './media-wait';

const active=new Set<HTMLVideoElement>();
let peak=0;
export function videoResourceStats(){return {active:active.size,peak};}
export function videoDiagnostics(){
 return [...active].map(v=>({src:v.currentSrc||v.src,time:v.currentTime,readyState:v.readyState,seeking:v.seeking,error:v.error?.message}));
}

// Motion Canvas's stock Video uses a static per-node pool and never unloads
// removed players. Own the media element so a completed shot releases its
// decoder, buffered source and pending network activity when disposed.
export class EpisodeVideo extends Video{
 private media?:HTMLVideoElement;
 private loading?:Promise<void>;
 private seeking?:{time:number;promise:Promise<void>};
 protected video():HTMLVideoElement{
  const src=this.src();
  if(!this.media||this.media.getAttribute('src')!==src){
   this.releaseMedia();
   this.media=document.createElement('video');
   this.media.preload='auto';this.media.src=src;active.add(this.media);peak=Math.max(peak,active.size);
  }
  const video=this.media;
  if(video.readyState<2){
   this.loading??=waitForMedia(video,'load',()=>video.readyState>=2);
   DependencyContext.collectPromise(this.loading);
  }
  return video;
 }
 protected setCurrentTime(time:number){
  const video=this.video();
  if(video.readyState<2)return;
  // Match the completion tolerance: browsers round media timestamps.
  // Re-collecting an already-resolved seek at the same rounded time can
  // exhaust Motion Canvas's resource-resolution iterations.
  if(!video.seeking&&Math.abs(video.currentTime-time)<1e-4)return;
  if(this.seeking?.time!==time){
   this.seeking={time,promise:waitForMedia(video,`seek to ${time.toFixed(3)}s`,()=>!video.seeking&&video.readyState>=2&&Math.abs(video.currentTime-time)<1e-4,()=>{video.currentTime=time;})};
  }
  DependencyContext.collectPromise(this.seeking.promise);
 }
 private releaseMedia(){
  if(this.media){this.media.pause();this.media.removeAttribute('src');this.media.load();active.delete(this.media);}
  this.media=undefined;this.loading=undefined;this.seeking=undefined;
 }
 dispose(){this.releaseMedia();super.dispose();}
}
