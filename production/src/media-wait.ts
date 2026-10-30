export interface MediaWaitTarget{
 currentSrc?:string;src:string;currentTime:number;readyState:number;seeking:boolean;
 error:{message:string}|null;
 addEventListener(type:string,listener:()=>void):void;
 removeEventListener(type:string,listener:()=>void):void;
}

// Install listeners before starting a seek; errors and missing browser events
// must reject the resource dependency rather than stall the renderer forever.
export function waitForMedia(video:MediaWaitTarget,operation:string,ready:()=>boolean,start?:()=>void,timeout=30000):Promise<void>{
 return new Promise((resolve,reject)=>{
  const events=['loadeddata','canplay','seeked'];
  let settled=false;
  const cleanup=()=>{if(settled)return;settled=true;clearTimeout(timer);for(const event of events)video.removeEventListener(event,check);video.removeEventListener('error',failed);};
  const check=()=>{if(!settled&&ready()){cleanup();resolve();}};
  const failed=()=>{cleanup();reject(Error(`Video ${operation} failed: ${video.currentSrc||video.src}: ${video.error?.message??'media error'}`));};
  const timer=setTimeout(()=>{cleanup();reject(Error(`Video ${operation} timed out: ${video.currentSrc||video.src} at ${video.currentTime.toFixed(3)}s (readyState=${video.readyState}, seeking=${video.seeking})`));},timeout);
  for(const event of events)video.addEventListener(event,check);
  video.addEventListener('error',failed);
  try{start?.();if(video.error)failed();else check();}catch(error){cleanup();reject(error);}
 });
}

