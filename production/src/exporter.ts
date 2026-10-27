import {ObjectMetaField, type Project, type RendererSettings, type Plugin} from '@motion-canvas/core';
async function post(action:string,body?:BodyInit){
 const r=await fetch('/__episode-export/'+action,{method:'POST',body});
 if(!r.ok)throw Error(await r.text());
}
class EpisodeExporter{
 static id='emergence/mp4';static displayName='Emergence MP4';
 static meta(){return new ObjectMetaField('MP4',{});}
 static async create(_project:Project,settings:RendererSettings){return new EpisodeExporter(settings);}
 constructor(private settings:RendererSettings){}
 async start(){await post('start',JSON.stringify({fps:this.settings.fps,width:this.settings.size.x*this.settings.resolutionScale,height:this.settings.size.y*this.settings.resolutionScale}));}
 async handleFrame(canvas:HTMLCanvasElement){
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Frame encoding failed')),'image/png'));
  await post('frame',blob);
 }
 async stop(result:number){await post(result===0?'finish':'abort');}
}
export const episodeExporter:Plugin={name:'emergence/export',exporters:()=>[EpisodeExporter]};
