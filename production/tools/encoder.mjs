import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {outputResolution} from './pipeline.mjs';
export function waitForEncoderDrain(stream,timeout=30000){
 return new Promise((resolve,reject)=>{
  if(stream.destroyed){reject(Error('FFmpeg input closed while uploading a frame'));return;}
  const cleanup=()=>{clearTimeout(timer);stream.off('drain',drained);stream.off('error',failed);stream.off('close',closed);};
  const drained=()=>{cleanup();resolve();};
  const failed=error=>{cleanup();reject(error);};
  const closed=()=>failed(Error('FFmpeg input closed while uploading a frame'));
  const timer=setTimeout(()=>failed(Error('FFmpeg input stalled while uploading a frame')),timeout);
  stream.once('drain',drained);stream.once('error',failed);stream.once('close',closed);
 });
}
export function encoderPlugin(production,episode,prepared){
 let encoder,completed,stderr='',frames=0;
 const output=join(production,'output',episode+'.mp4'),partial=join(production,'output',episode+'.rendering.mp4');
 return {name:'emergence:encoder',configureServer(server){
  server.httpServer?.on('close',()=>encoder?.kill());
  server.middlewares.use('/__episode-export/',async(req,res)=>{
   if(req.method!=='POST'){res.statusCode=405;res.end();return;}
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.statusCode=403;res.end();return;}
   try{
    const action=req.url?.split('?')[0].replace(/^\//,'');
    if(action==='start'){
     if(encoder)throw Error('An export is already running');
     const chunks=[];for await(const c of req)chunks.push(c);
     const {fps,width,height}=JSON.parse(Buffer.concat(chunks).toString());
     const resolution=outputResolution(prepared.plan);
     if(fps!==prepared.plan.fps||width!==resolution.width||height!==resolution.height)throw Error('Use the edit-plan fps and output resolution');
     mkdirSync(join(production,'output'),{recursive:true});stderr='';frames=0;
     encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-i',prepared.soundtrack,'-map','0:v:0','-map','1:a:0','-t',String(prepared.duration),'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',partial],{stdio:['pipe','ignore','pipe']});
     encoder.stderr.on('data',c=>{stderr=(stderr+c).slice(-16384);});
     encoder.stdin.on('error',()=>{});
     completed=once(encoder,'close');
     // Preserve the failure for finish(), while handling an early spawn error.
     completed.catch(()=>{});
    }else if(action==='frame'){
     if(!encoder||encoder.exitCode!==null)throw Error('Encoder is not running: '+stderr);
     for await(const c of req){if(!encoder.stdin.write(c))await waitForEncoderDrain(encoder.stdin);}
     frames++;if(frames%250===0)console.log(`Motion Canvas: ${frames} frames (${(frames/prepared.plan.fps).toFixed(1)}s)`);
    }else if(action==='finish'){
     if(!encoder)throw Error('No export started');
     encoder.stdin.end();const [code]=await completed;encoder=undefined;
     if(code!==0)throw Error('FFmpeg failed: '+stderr);
     if(frames<Math.round(prepared.duration*prepared.plan.fps))throw Error('Incomplete Motion Canvas render');
     renameSync(partial,output);console.log('Rendered '+output);
    }else if(action==='abort'){
     encoder?.kill();encoder=undefined;rmSync(partial,{force:true});
    }else throw Error('Unknown export action');
    res.end('ok');
   }catch(e){res.statusCode=500;res.end(String(e));}
  });
 }};
}
