import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Node-only JavaScript production helpers.
import {validate,sessionPath} from '../production/tools/pipeline.mjs';
import {sourceTime} from '../production/src/timeline.js';
const manifest=[1,2].map(line=>({line,audio:`${line}_Chapter_1.wav`}));
const fixture=()=>({version:2,fps:25,cameras:[{id:'pov',file:'pov.mp4',offsetSeconds:0},{id:'observer',file:'observer.mp4',offsetSeconds:-3.318}],segments:[{kind:'shot',duration:8,narration:[{line:1,audio:'1_Chapter_1.wav',at:.35}],shot:{kind:'pip',cameras:['pov','observer'],start:10,duration:8}}]});
const media=(file:string)=>({duration:file.startsWith('audio/')?5:40,audio:file.startsWith('audio/')});
test('narration filename mapping remains exact, including double digit line numbers',()=>{
 const catalogue=JSON.parse(readFileSync('production/episode-001/narration-manifest.json','utf8'));
 for(const v of catalogue)assert.equal(v.audio,`${v.line}_Chapter_1.wav`);
 const p=fixture();p.segments[0].narration[0].audio='2_Chapter_1.wav';assert.throws(()=>validate(p,manifest,media),/mapping/);
});
test('measured narration drives segment length and breathing room',()=>{
 const p=fixture();assert.equal(validate(p,manifest,media).duration,8);
 assert.throws(()=>validate(p,manifest,(f:string)=>f.startsWith('audio/')?{duration:8,audio:true}:media(f)),/exceeds/);
 p.segments[0].narration.push({line:2,audio:'2_Chapter_1.wav',at:3});assert.throws(()=>validate(p,manifest,media),/overlap/);
});
test('camera synchronization applies signed media offset to every selected camera',()=>{
 assert.equal(sourceTime({id:'observer',file:'observer.mp4',offsetSeconds:-3.318},10),6.682);
 const p=fixture();p.segments[0].shot.start=2;assert.throws(()=>validate(p,manifest,media),/Source bounds/);
});
test('all cameras must remain in recording bounds through the entire shot',()=>{
 const p=fixture();p.segments[0].shot.start=34;assert.throws(()=>validate(p,manifest,media),/Source bounds/);
 assert.throws(()=>validate(fixture(),manifest,(f:string)=>{if(f==='video/observer.mp4')throw Error('Missing asset');return media(f);}),/Missing asset/);
 assert.throws(()=>validate(fixture(),manifest,(f:string)=>{if(f.startsWith('audio/'))throw Error('Missing narration');return media(f);}),/Missing narration/);
});
test('declarative plan rejects malformed layouts, camera IDs, duration mismatch and semantic reorder',()=>{
 for(const mutate of [
  (p:any)=>p.segments[0].shot.kind='grid',
  (p:any)=>p.segments[0].shot.cameras[1]='missing',
  (p:any)=>p.segments[0].shot.duration=4,
  (p:any)=>p.segments[0].duration=NaN,
  (p:any)=>p.cameras[0].file='../outside.mp4',
  (p:any)=>p.segments[0].narration.push({line:1,audio:'1_Chapter_1.wav',at:6}),
 ]){const p=fixture();mutate(p);assert.throws(()=>validate(p,manifest,media));}
});
test('real edit includes construction, payoff and every supported layout',()=>{
 const p=JSON.parse(readFileSync('production/episode-001/edit-plan.json','utf8'));
 const m=JSON.parse(readFileSync('production/episode-001/narration-manifest.json','utf8'));
 const result=validate(p,m,(f:string)=>({duration:f.startsWith('audio/')?1:400,audio:f.startsWith('audio/')}));
 assert.equal(result.duration,163.92);
 assert.equal(p.segments[0].kind,'intro');
 assert.equal(p.segments[0].id,'title');
 assert.equal(p.segments[0].narration[0].audio,'1_Chapter_1.wav');
 assert.ok(p.segments.every((s:any)=>s.id!=='hook'));
 assert.equal(m[0].text,readFileSync('production/episode-001/narration.txt','utf8').split('\n')[0]);
 assert.deepEqual([...new Set(p.segments.filter((s:any)=>s.shot).map((s:any)=>s.shot.kind))].sort(),['full','pip','split']);
 assert.ok(result.schedule.some((v:any)=>v.line===53));
 assert.match(sessionPath(process.cwd(),'episode-001'),/data/);
});
test('episode camera offsets agree with the local recording metadata when available',async(t)=>{
 const {existsSync}=await import('node:fs');
 const path='data/mcp-sessions/episode-001/metadata.json';
 if(!existsSync(path)){t.skip('Local recording metadata is not committed');return;}
 const metadata=JSON.parse(readFileSync(path,'utf8'));
 const plan=JSON.parse(readFileSync('production/episode-001/edit-plan.json','utf8'));
 const origin=Math.min(...metadata.cameraTimings.map((c:any)=>Date.parse(c.captureOpenedAt)));
 for(const camera of plan.cameras){
  const timing=metadata.cameraTimings.find((c:any)=>c.name===camera.id);
  assert.ok(timing);assert.equal(camera.offsetSeconds,(origin-Date.parse(timing.captureOpenedAt))/1000);
 }
});
test('legacy simple renderer honors v2 narration references without changing v1 compatibility',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');
 const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'production-simple-'));
 try{
  const episode=join(dir,'production/episode-test'),mediaDir=join(dir,'production/public/episode-test/audio'),bin=join(dir,'bin');
  mkdirSync(episode,{recursive:true});mkdirSync(mediaDir,{recursive:true});mkdirSync(bin);
  writeFileSync(join(episode,'edit-plan.json'),JSON.stringify({version:2,cameras:[],segments:[{kind:'intro',duration:3},{kind:'outro',duration:3,narration:[{line:2,audio:'2_Chapter_1.wav',at:.45}]}]}));
  writeFileSync(join(episode,'narration-manifest.json'),JSON.stringify([{line:1,segmentIndex:0,audio:'1_Chapter_1.wav'}]));
  for(const n of [1,2])writeFileSync(join(mediaDir,`${n}_Chapter_1.wav`),'placeholder');
  writeFileSync(join(bin,'ffprobe'),'#!/bin/sh\necho 1\n');chmodSync(join(bin,'ffprobe'),0o755);
  writeFileSync(join(bin,'ffmpeg'),'#!/usr/bin/env python3\nimport os,sys,json\nwith open(os.environ["FFMPEG_TEST_LOG"],"a") as f:f.write(json.dumps(sys.argv[1:])+"\\n")\nopen(sys.argv[-1],"w").close()\n');chmodSync(join(bin,'ffmpeg'),0o755);
  const log=join(dir,'calls.jsonl');
  const run=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/episode-render-simple.ts')],{cwd:dir,env:{...process.env,EPISODE_ID:'episode-test',PATH:bin+':'+process.env.PATH,FFMPEG_TEST_LOG:log},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const calls=readFileSync(log,'utf8');assert.match(calls,/2_Chapter_1.wav/);assert.doesNotMatch(calls,/1_Chapter_1.wav/);assert.match(calls,/adelay=3450/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('planning speech leads the action while footage still includes its completion',async()=>{
 const {existsSync}=await import('node:fs');
 const p=JSON.parse(readFileSync('production/episode-001/edit-plan.json','utf8'));
 const timing=JSON.parse(readFileSync('production/episode-001/narration-timing.json','utf8'));
 const eventPath='data/mcp-sessions/episode-001/events.json';
 const events=existsSync(eventPath)?JSON.parse(readFileSync(eventPath,'utf8')):undefined;
 for(const cue of timing.cues){
  const segment=p.segments.find((s:any)=>s.id===cue.segment);
  const voice=segment.narration.find((v:any)=>v.line===cue.line);
  assert.equal(segment.shot.start,cue.sourceStart);
  const lead=cue.sourceActionAt-segment.shot.start-voice.at;
  assert.ok(lead>=cue.targetLead-1e-6,`line ${cue.line} starts too late`);
  assert.ok(cue.sourceActionAt>=segment.shot.start);
  assert.ok(cue.sourceActionAt<segment.shot.start+segment.duration);
  if(events){
   const event=events[cue.eventIndex];assert.equal(event.action,cue.action);
   const origin=Date.parse(p.synchronization.origin);
   assert.ok(Math.abs((Date.parse(event.at)-origin)/1000-cue.sourceActionAt)<.001);
   const completion=events.slice(cue.eventIndex+1).find((e:any)=>e.action===cue.action.replace('_start',''));
   assert.ok(completion);
   assert.ok((Date.parse(completion.at)-origin)/1000<=segment.shot.start+segment.duration,`line ${cue.line} loses action completion`);
  }
 }
 assert.ok(timing.cues.length>=17);
});

test('follow is selectable in every production layout and checked for bounds',()=>{
 for(const kind of ['full','pip','split']){
  const p=fixture();
  p.cameras.push({id:'follow',file:'follow.mp4',offsetSeconds:0});
  p.segments[0].shot={...p.segments[0].shot,kind,cameras:kind==='full'?['follow']:['follow','pov']};
  assert.equal(validate(p,manifest,media).cameras.length,3);
  p.cameras[2].offsetSeconds=-20;
  assert.throws(()=>validate(p,manifest,media),/Source bounds/);
 }
});
