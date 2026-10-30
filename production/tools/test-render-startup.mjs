// Real CLI startup with an empty Vite cache and synthetic local media.
// node --test production/tools/test-render-startup.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linkSync,mkdtempSync,mkdirSync,cpSync,symlinkSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const production=fileURLToPath(new URL('..',import.meta.url));
for(const stress of [false,true])test(stress?'CLI renders 9060 frames with 60 camera cuts and bounded players':'CLI renders with cold dependency cache without optimizer navigation', {timeout:300000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'terrarium-render-startup-'));
 const fixture=join(root,'production'),episode='episode-startup-check';
 try{
  mkdirSync(fixture);
  for(const name of ['src','tools'])cpSync(join(production,name),join(fixture,name),{recursive:true});
  for(const name of ['render.html','package.json'])cpSync(join(production,name),join(fixture,name));
  const config=readFileSync(join(production,'vite.config.ts'),'utf8').replace('return {plugins:',`return {cacheDir:${JSON.stringify(join(root,'empty-vite-cache'))},plugins:`);
  writeFileSync(join(fixture,'vite.config.ts'),config);
  symlinkSync(join(production,'node_modules'),join(fixture,'node_modules'));
  mkdirSync(join(root,'packages'));
  symlinkSync(fileURLToPath(new URL('../../packages/minecraft-recorder',import.meta.url)),join(root,'packages/minecraft-recorder'));
  const folder=join(fixture,episode),pub=join(fixture,'public',episode);
  mkdirSync(folder);mkdirSync(join(pub,'video'),{recursive:true});mkdirSync(join(pub,'audio'));
  await run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=60:d=3','-c:v','libx264','-pix_fmt','yuv420p',join(pub,'video/observer.mp4')]);
  await run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2',join(pub,'audio/1_Chapter_1.wav')]);
  const plan={version:2,fps:stress?60:15,resolution:{width:320,height:180},cameras:[{id:'observer',file:'observer.mp4',offsetSeconds:0}],segments:[{kind:'intro',duration:1,text:'Startup regression',background:{camera:'observer',time:0},narration:[{line:1,audio:'1_Chapter_1.wav',at:0.25}]}]};
  if(stress){
   linkSync(join(pub,'video/observer.mp4'),join(pub,'video/follow.mp4'));
   plan.cameras.push({id:'follow',file:'follow.mp4',offsetSeconds:0});
   for(let i=0;i<60;i++){
    const kind=['full','pip','split'][i%3];
    plan.segments.push({kind:'shot',duration:2.5,shot:{kind,cameras:kind==='full'?['follow']:['observer','follow'],start:.1234567,duration:2.5,hold:.25}});
   }
  }
  writeFileSync(join(folder,'edit-plan.json'),JSON.stringify(plan));
  writeFileSync(join(folder,'narration-manifest.json'),JSON.stringify([{line:1,audio:'1_Chapter_1.wav',text:'Startup regression'}]));
  writeFileSync(join(folder,'scene.tsx'),`import plan from './edit-plan.json';import {createEpisodeScene,type EpisodePlan} from '../src/scenes/episode';export default createEpisodeScene(plan as EpisodePlan,'${episode}');`);
  writeFileSync(join(folder,'project.ts'),"import {makeProject} from '@motion-canvas/core';import scene from './scene?scene';import {episodeExporter} from '../src/exporter';export default makeProject({scenes:[scene],plugins:[episodeExporter]});");
  const result=await run(process.execPath,[join(fixture,'tools/episode.mjs'),'--render'],{env:{...process.env,EPISODE_ID:episode},timeout:280000});
  assert.match(result.stdout,/Complete:/);
  if(stress){const peak=Number(result.stdout.match(/Video players: peak (\d+)/)?.[1]);assert.ok(peak>0&&peak<=4,`Unbounded video players: ${peak}`);}
  assert.doesNotMatch(result.stdout+result.stderr,/optimized dependencies changed|Execution context was destroyed|asynchronous property before the node was ready/);
  const {stdout}=await run('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames','-of','json',join(fixture,'output',episode+'.mp4')]);
  assert.deepEqual(JSON.parse(stdout).streams[0],{width:320,height:180,nb_read_frames:stress?'9060':'15'});
 }finally{rmSync(root,{recursive:true,force:true});}
});
