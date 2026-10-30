import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const planner=resolve('scripts/episode-plan.ts');
const tsxLoader=import.meta.resolve('tsx');
function fixture(events:unknown[]){
 const dir=mkdtempSync(join(tmpdir(),'episode-plan-'));
 const session=join(dir,'session'),bin=join(dir,'bin');
 mkdirSync(session);mkdirSync(bin);
 writeFileSync(join(session,'events.json'),JSON.stringify(events));
 writeFileSync(join(session,'metadata.json'),JSON.stringify({startedAt:'2026-01-01T00:00:00.000Z'}));
 for(const name of ['agent-pov','observer'])writeFileSync(join(session,name+'.mp4'),'placeholder');
 const ffprobe=join(bin,'ffprobe');
 writeFileSync(ffprobe,'#!/bin/sh\necho 30\n');chmodSync(ffprobe,0o755);
 const run=(args:string[]=[])=>spawnSync(process.execPath,['--import',tsxLoader,planner,session,'episode-test',...args],{
  cwd:dir,env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8'
 });
 return {dir,run,out:join(dir,'production/episode-test')};
}
const at=(second:number)=>new Date(Date.parse('2026-01-01T00:00:00Z')+second*1000).toISOString();
const intent=(second:number,summary:string)=>({at:at(second),action:'report_intention',details:{args:{summary}}});

test('reports counts and regenerates all narration artifacts only with --force',()=>{
 const f=fixture([intent(5,'First thought'),intent(13,'Second thought'),intent(35,'Too late'),{at:at(18),action:'report_intention',details:{args:{}}}]);
 try{
  const first=f.run();
  assert.equal(first.status,0,first.stderr);
  assert.match(first.stdout,/Intentions found:\s+4/);
  assert.match(first.stdout,/Malformed\/empty intentions:\s*1/);
  assert.match(first.stdout,/Intentions outside video:\s+1/);
  assert.match(first.stdout,/Intentions selected:\s+2/);
  const narration=join(f.out,'narration.txt'),manifest=join(f.out,'narration-manifest.json');
  assert.match(readFileSync(narration,'utf8'),/First thought/);
  assert.deepEqual(JSON.parse(readFileSync(manifest,'utf8')).map((line:{audio:string})=>line.audio),['1_Chapter_1.wav','2_Chapter_1.wav','3_Chapter_1.wav','4_Chapter_1.wav']);
  writeFileSync(narration,'manual version\n');
  const rerun=f.run();
  assert.equal(rerun.status,0,rerun.stderr);
  assert.match(rerun.stderr,/Existing episode files not overwritten/);
  assert.equal(readFileSync(narration,'utf8'),'manual version\n');
  const forced=f.run(['--force']);
  assert.equal(forced.status,0,forced.stderr);
  assert.match(readFileSync(narration,'utf8'),/First thought/);
  assert.equal(JSON.parse(readFileSync(manifest,'utf8')).length,4);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('fails visibly if all reported intentions are unusable',()=>{
 const f=fixture([intent(50,'After recording')]);
 try{
  const result=f.run();
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/No usable intentions/);
  assert.equal(existsSync(join(f.out,'narration.txt')),false);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('refuses partially populated output without force',()=>{
 const f=fixture([intent(5,'Explore')]);
 try{
  mkdirSync(f.out,{recursive:true});writeFileSync(join(f.out,'narration.txt'),'manual');
  const result=f.run();
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Partial episode output exists/);
  assert.equal(readFileSync(join(f.out,'narration.txt'),'utf8'),'manual');
  assert.equal(f.run(['--force']).status,0);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});


test('extracts every intention even when preview edit plan only uses first 20',()=>{
 const f=fixture(Array.from({length:25},(_,i)=>intent(3+i,`Thought ${i+1}`)));
 try{
  const result=f.run();
  assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(readFileSync(join(f.out,'narration-manifest.json'),'utf8'));
  assert.equal(manifest.length,27);
  assert.equal(manifest[25].text,'Thought 25');
  assert.equal(manifest[25].audio,'26_Chapter_1.wav');
  assert.equal(manifest[25].eventIndex,24);
  assert.equal(manifest[25].segmentIndex,null);
  assert.match(readFileSync(join(f.out,'narration.txt'),'utf8'),/Thought 25/);
  const plan=JSON.parse(readFileSync(join(f.out,'edit-plan.json'),'utf8'));
  assert.ok(plan.segments.length<=22);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('new survival decisions retain public intent and POV footage even when the action fails',()=>{
 const summary='I will check whether these materials can become a pickaxe.';
 const f=fixture([
  {at:at(5),action:'report_intention',details:{args:{summary,action:'craft'}}},
  {at:at(5),action:'craft_start',details:{args:{item:'wooden_pickaxe',count:1}}},
  {at:at(7),action:'craft',details:{result:{ok:false,message:'Missing ingredients'}}}
 ]);
 try{
  const result=f.run();assert.equal(result.status,0,result.stderr);
  const plan=JSON.parse(readFileSync(join(f.out,'edit-plan.json'),'utf8'));
  assert.deepEqual(plan.segments[1].shot.cameras,['agent-pov']);
  const narration=JSON.parse(readFileSync(join(f.out,'narration-manifest.json'),'utf8'));
  assert.equal(narration[1].text,summary);
  assert.equal(narration.length,3);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('three-camera sessions expose follow and use it for movement while preserving narration',()=>{
 const f=fixture([intent(5,'I will explore the cave.')]);
 try{
  const session=join(f.dir,'session');
  writeFileSync(join(session,'follow.mp4'),'placeholder');
  writeFileSync(join(session,'metadata.json'),JSON.stringify({startedAt:at(0),cameras:[{name:'agent-pov'},{name:'observer'},{name:'follow'}],cameraTimings:['agent-pov','observer','follow'].map(name=>({name,captureOpenedAt:at(0),readyAt:at(0)}))}));
  const result=f.run();assert.equal(result.status,0,result.stderr);
  const plan=JSON.parse(readFileSync(join(f.out,'edit-plan.json'),'utf8'));
  assert.deepEqual(plan.cameras.map((c:any)=>c.id),['agent-pov','observer','follow']);
  assert.deepEqual(plan.cameras.map((c:any)=>c.offsetSeconds),[0,0,0]);
  assert.deepEqual(plan.segments[1].shot.cameras,['follow']);
  assert.match(readFileSync(join(f.out,'narration.txt'),'utf8'),/I will explore the cave\./);
  assert.ok(existsSync(join(f.dir,'production/public/episode-test/video/follow.mp4')));
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('a declared third camera cannot be silently omitted',()=>{
 const f=fixture([intent(5,'I will explore.')]);
 try{
  writeFileSync(join(f.dir,'session/metadata.json'),JSON.stringify({startedAt:at(0),cameras:[{name:'follow'}]}));
  // The fake ffprobe accepts any path; use a strict stand-in for this failure case.
  const probe=join(f.dir,'bin/ffprobe');
  writeFileSync(probe,'#!/bin/sh\nfor arg do case "$arg" in *follow.mp4) exit 1;; esac; done\necho 30\n');
  const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/follow.mp4/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('orchestration extraction preserves valid out-of-window intentions and original event references',()=>{
 const f=fixture([intent(5,'First thought'),intent(35,'After the camera ended'),{action:'report_intention',details:{args:{summary:'Untimed but public'}}}]);
 try{
  const result=f.run(['--preserve-all-intentions','--link-media']);
  assert.equal(result.status,0,result.stderr);
  const m=JSON.parse(readFileSync(join(f.out,'narration-manifest.json'),'utf8'));
  assert.deepEqual(m.slice(1,-1).map((v:any)=>[v.eventIndex,v.text]),[[0,'First thought'],[1,'After the camera ended'],[2,'Untimed but public']]);
  assert.equal(m[2].segmentIndex,null);
  assert.equal(m[3].at,null);
  assert.equal(readFileSync(join(f.dir,'session/agent-pov.mp4'),'utf8'),'placeholder');
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('guided opening uses a concise goal excerpt consistently in narration and the manifest',()=>{
 const f=fixture([intent(5,'I will inspect this tree.')]);
 const previous=process.env.EMERGENCE_GOAL_TEXT;
 const goal='You are on an island.\n\nReach the far bank.\nUse your own strategy.';
 try{
  process.env.EMERGENCE_GOAL_TEXT=goal;
  const result=f.run(['--preserve-all-intentions']);assert.equal(result.status,0,result.stderr);
  const lines=readFileSync(join(f.out,'narration.txt'),'utf8').trimEnd().split('\n');
  const manifest=JSON.parse(readFileSync(join(f.out,'narration-manifest.json'),'utf8'));
  assert.equal(lines.length,manifest.length);assert.equal(lines[0],'You are on an island. Reach the far bank. Use your own strategy.');assert.equal(manifest[0].text,'You are on an island. Reach the far bank. Use your own strategy.');
 }finally{if(previous===undefined)delete process.env.EMERGENCE_GOAL_TEXT;else process.env.EMERGENCE_GOAL_TEXT=previous;rmSync(f.dir,{recursive:true,force:true});}
});
