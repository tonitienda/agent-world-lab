import {Renderer,Vector2,type Project} from '@motion-canvas/core';
import {videoResourceStats} from './episode-video';
export async function renderEpisode(project:Project,episode:string,duration:number,fps:number,resolution={width:1920,height:1080}){
 project.logger.onLogged.subscribe(entry=>{if(entry.level==='error')console.error(entry.message,entry.stack);});
 const renderer=new Renderer(project);let result:number|undefined;
 let lastReport=-Infinity;
 const progress=(globalThis as typeof globalThis & {__terrariumRenderProgress?:(frame:number,stats:ReturnType<typeof videoResourceStats>)=>Promise<void>}).__terrariumRenderProgress;
 renderer.onFrameChanged.subscribe(frame=>{
  if(progress&&performance.now()-lastReport>=1000){lastReport=performance.now();void progress(frame,videoResourceStats()).catch(()=>{});}
 });
 renderer.onFinished.subscribe(r=>result=r);
 await renderer.render({name:episode,size:new Vector2(1920,1080),resolutionScale:resolution.width/1920,colorSpace:'srgb',background:'#101d26',fps,range:[0,duration],exporter:{name:'emergence/mp4',options:{}}});
 return result;
}
