// Sustained browser/FFmpeg regression: no Minecraft, agents or episode assets.
// Run from the repository root: node --test production/tools/test-exporter.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {encoderPlugin} from './encoder.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('../../packages/minecraft-recorder/node_modules/playwright');
const production=fileURLToPath(new URL('..',import.meta.url));
test('exporter uploads 6000 PNGs without Blobs, completes responses, and encodes 4K', {timeout:300000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'terrarium-exporter-'));
 const soundtrack=join(dir,'silence.wav');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','101',soundtrack]);
 const prepared={plan:{fps:60,resolution:{width:320,height:180}},soundtrack,duration:100};
 const server=await createServer({root:production,configFile:false,plugins:[encoderPlugin(dir,'stress',prepared)],server:{host:'127.0.0.1',port:0}});
 let browser;
 try{
  await server.listen();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/render.html`);
  async function render(width,height,frames){
   return page.evaluate(async({width,height,frames})=>{
    const {episodeExporter}=await import('/src/exporter.ts');
    const Exporter=episodeExporter.exporters()[0];
    const exporter=await Exporter.create({}, {fps:60,size:{x:width,y:height},resolutionScale:1});
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    // Fail immediately if the browser Blob path is reintroduced.
    canvas.toBlob=()=>{throw Error('Blob encoding is forbidden in frame export');};
    const context=canvas.getContext('2d');
    const image=context.createImageData(width,height);
    let seed=42;
    for(let i=0;i<image.data.length;i+=4){
     seed=(Math.imul(seed,1664525)+1013904223)|0;
     image.data[i]=seed>>>24;image.data[i+1]=seed>>>16;image.data[i+2]=seed>>>8;image.data[i+3]=255;
    }
    context.putImageData(image,0,0);
    const nativeFetch=window.fetch;
    let responses=0;
    window.fetch=async(...args)=>{
     if(args[1]?.body instanceof Blob)throw Error('Blob request body');
     const response=await nativeFetch(...args);
     const read=response.text.bind(response);
     response.text=async()=>{const text=await read();responses++;return text;};
     return response;
    };
    try{
     await exporter.start();
     for(let i=0;i<frames;i++){
      context.fillStyle=`rgb(${i%256},0,0)`;context.fillRect(0,0,8,8);
      await exporter.handleFrame(canvas);
     }
     await exporter.stop(0);
     return {responses};
    }finally{window.fetch=nativeFetch;}
   },{width,height,frames});
  }
  assert.equal((await render(320,180,6000)).responses,6002);
  function probe(){return JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames,r_frame_rate','-of','json',join(dir,'output/stress.mp4')],{encoding:'utf8'})).streams[0];}
  assert.deepEqual(probe(),{width:320,height:180,r_frame_rate:'60/1',nb_read_frames:'6000'});
  prepared.plan.resolution={width:3840,height:2160};prepared.duration=3/60;
  assert.equal((await render(3840,2160,3)).responses,5);
  assert.deepEqual(probe(),{width:3840,height:2160,r_frame_rate:'60/1',nb_read_frames:'3'});
 }finally{await browser?.close();await server.close();rmSync(dir,{recursive:true,force:true});}
});
