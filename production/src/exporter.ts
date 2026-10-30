import {ObjectMetaField, type Project, type RendererSettings, type Plugin} from '@motion-canvas/core';
async function post(action:string,body?:BodyInit){
 const r=await fetch('/__episode-export/'+action,{method:'POST',body,signal:AbortSignal.timeout(120000)});
 const message=await r.text();
 if(!r.ok)throw Error(message);
}
class EpisodeExporter{
 static id='emergence/mp4';static displayName='The Agent Terrarium MP4';
 static meta(){return new ObjectMetaField('MP4',{});}
 static async create(_project:Project,settings:RendererSettings){return new EpisodeExporter(settings);}
 constructor(private settings:RendererSettings){}
 async start(){await post('start',JSON.stringify({fps:this.settings.fps,width:this.settings.size.x*this.settings.resolutionScale,height:this.settings.size.y*this.settings.resolutionScale}));}
 async handleFrame(canvas:HTMLCanvasElement){
  // Avoid Blob-backed fetch requests: Chromium's Blob storage can run out
  // during long exports even though each individual upload has completed.
  // Keep only this frame's PNG bytes alive, and await the encoder's response
  // before Motion Canvas renders the next frame (including pipe backpressure).
  const data=canvas.toDataURL('image/png');
  if(!data.startsWith('data:image/png;base64,'))throw Error('Frame encoding failed');
  const binary=atob(data.slice(data.indexOf(',')+1));
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  await post('frame',bytes);
 }
 async stop(result:number){await post(result===0?'finish':'abort');}
}
export const episodeExporter:Plugin={name:'emergence/export',exporters:()=>[EpisodeExporter]};
