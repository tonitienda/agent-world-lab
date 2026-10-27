import {Renderer,Vector2,type Project} from '@motion-canvas/core';
export async function renderEpisode(project:Project,episode:string,duration:number,fps:number){
 project.logger.onLogged.subscribe(entry=>{if(entry.level==='error')console.error(entry.message,entry.stack);});
 const renderer=new Renderer(project);let result:number|undefined;
 renderer.onFinished.subscribe(r=>result=r);
 await renderer.render({name:episode,size:new Vector2(1920,1080),resolutionScale:1,colorSpace:'srgb',background:'#101d26',fps,range:[0,duration],exporter:{name:'emergence/mp4',options:{}}});
 return result;
}
