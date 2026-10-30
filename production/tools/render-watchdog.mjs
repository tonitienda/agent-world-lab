// Browser progress also detects stalls before the first exported frame. A timer
// in Node remains effective if Chromium's JavaScript thread itself is stuck.
export async function watchRender(page,render,{timeoutMs=120000,intervalMs=15000,totalFrames=0,log=console.log}={}){
 let lastProgress=Date.now(),lastFrame=0,lastPrintedFrame=-1,lastPrintedAt=Date.now(),checking=false,peakPlayers=0;
 await page.exposeFunction('__terrariumRenderProgress',(frame,stats)=>{peakPlayers=Math.max(peakPlayers,stats?.peak??0);if(frame!==lastFrame){lastProgress=Date.now();lastFrame=frame;}});
 let timer;
 const stalled=new Promise((_,reject)=>{
  timer=setInterval(async()=>{
   if(checking)return;
   const idle=Date.now()-lastProgress;
   if(lastFrame!==lastPrintedFrame){
    const now=Date.now(),rate=(lastFrame-Math.max(0,lastPrintedFrame))*1000/Math.max(1,now-lastPrintedAt);
    log(`Render heartbeat: frame ${lastFrame}${totalFrames?'/'+totalFrames:''} (${rate.toFixed(1)} frames/s)`);
    lastPrintedFrame=lastFrame;lastPrintedAt=now;
   }
   else if(idle>=30000)log(`Render waiting at frame ${lastFrame} (${Math.round(idle/1000)}s without progress)`);
   if(idle<timeoutMs)return;
   checking=true;
   let details='Browser did not respond to diagnostics';
   let diagnosticTimer;
   try{
    details=JSON.stringify(await Promise.race([
     page.evaluate(async()=>{const {videoDiagnostics}=await import('/src/episode-video.ts');return videoDiagnostics();}),
     new Promise((_,reject)=>{diagnosticTimer=setTimeout(()=>reject(Error('diagnostic timeout')),5000);}),
    ]));
   }catch(error){details+=': '+error.message;}finally{clearTimeout(diagnosticTimer);}
   reject(Error(`Render stalled for ${Math.round(idle/1000)}s near frame ${lastFrame}. Video state: ${details}`));
  },intervalMs);
 });
 try{const result=await Promise.race([Promise.resolve().then(render),stalled]);log(`Video players: peak ${peakPlayers}`);return result;}
 finally{clearInterval(timer);}
}
