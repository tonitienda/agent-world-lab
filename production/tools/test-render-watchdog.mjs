import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchRender} from './render-watchdog.mjs';
test('watchdog rejects a stalled browser with frame and video diagnostics',async()=>{
 let report;
 const page={exposeFunction:async(_name,fn)=>{report=fn;},evaluate:async()=>[{src:'follow.mp4',time:124.3,seeking:true}]};
 await assert.rejects(watchRender(page,()=>{report(8501,{peak:4});return new Promise(()=>{});},{timeoutMs:30,intervalMs:5,log:()=>{}}),/stalled.*8501.*follow.mp4/);
});
test('watchdog accepts advancing frames and stops its timer on completion',async()=>{
 let report;const logs=[];
 const page={exposeFunction:async(_name,fn)=>{report=fn;}};
 let progress;
 try{
  const result=await watchRender(page,()=>new Promise(resolve=>{
   let frame=0;progress=setInterval(()=>{report(++frame,{peak:3});if(frame===8)resolve(0);},15);
  }),{timeoutMs:100,intervalMs:5,log:message=>logs.push(message)});
  assert.equal(result,0);clearInterval(progress);
  assert.ok(logs.includes('Video players: peak 3'));
  const count=logs.length;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(logs.length,count);
 }finally{clearInterval(progress);}
});
