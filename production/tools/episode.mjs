import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {prepare} from './pipeline.mjs';
const production=fileURLToPath(new URL('..',import.meta.url));
const episode=process.env.EPISODE_ID??'episode-001';
const prepared=prepare(production,episode);
console.log(`Validated ${episode}: ${prepared.duration}s, ${prepared.schedule.length} narration clips`);
if(process.argv.includes('--render')){
 const {createServer}=await import('vite');
 const require=createRequire(import.meta.url);
 let chromium;
 try{({chromium}=await import('playwright'));}
 catch{({chromium}=require('../../packages/minecraft-recorder/node_modules/playwright'));}
 const server=await createServer({root:production,configFile:join(production,'vite.config.ts'),server:{port:9000,strictPort:false}});
 let browser;
 try{
  await server.listen();const address=server.httpServer.address();
  browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();page.on('pageerror',e=>console.error('Browser error:',e));page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  if(process.argv.includes('--preview-check')){
   const failures=[];page.on('pageerror',e=>failures.push(e.message));
   await page.goto(`http://127.0.0.1:${address.port}/`);
   await page.waitForTimeout(4000);
   const track=await page.request.get(`http://127.0.0.1:${address.port}/${episode}/generated/soundtrack.wav`);
   if(failures.length||!track.ok()||await page.locator('canvas').count()===0)throw Error('Editor preview failed: '+failures.join('; '));
   await page.screenshot({path:'/tmp/emergence-review/editor-preview.png'});
   console.log('Editor preview opened, canvas present, soundtrack served, no page errors');
  }else{
  await page.goto(`http://127.0.0.1:${address.port}/render.html`);
  const result=await page.evaluate(async({episode,duration,fps})=>{
   const {default:project}=await import(`/${episode}/project.ts?project`);
   const {renderEpisode}=await import('/src/render-client.ts');
   return renderEpisode(project,episode,duration,fps);
  },{episode,duration:prepared.duration,fps:prepared.plan.fps});
  if(result!==0)throw Error('Motion Canvas render failed (result '+result+')');
  console.log('Complete:',resolve(production,'output',episode+'.mp4'));
  }
 }finally{await browser?.close();await server.close();}
}
