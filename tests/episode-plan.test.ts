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
