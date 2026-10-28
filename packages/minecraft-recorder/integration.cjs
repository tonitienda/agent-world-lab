// Real viewer + Chromium + FFmpeg, with a generated in-memory world. Never connects
// to Minecraft and cannot reset or change an existing world or episode.
const {EventEmitter} = require('node:events');
const {mkdtempSync, readFileSync, statSync, mkdirSync, writeFileSync, chmodSync, existsSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {spawnSync, execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const {Vec3} = require('vec3');
const version = '1.16.4';
const Chunk = require('prismarine-chunk')(version);
const data = require('minecraft-data')(version);
const {start} = require('./index.cjs');
const {createFollowController,terrainSnapshot} = require('./follow-camera.cjs');
const columns = new Map();
function column(cx,cz) {
  const key = `${cx},${cz}`;
  if (!columns.has(key)) {
    const chunk = new Chunk();
    for(let x=0;x<16;x++)for(let z=0;z<16;z++){
      const wx=cx*16+x,wz=cz*16+z;
      for(let y=60;y<=63;y++)chunk.setBlockStateId(new Vec3(x,y,z),data.blocksByName.stone.defaultState);
      // Long narrow tunnel, low ceiling, and an end wall. Rendered and queried
      // from exactly the same block data as the camera's collision solver.
      if(wz>=5&&wz<=15){
        if(wx===-1||wx===1||wz===15)for(let y=64;y<=66;y++)chunk.setBlockStateId(new Vec3(x,y,z),data.blocksByName.stone.defaultState);
        if(wx>=-1&&wx<=1)chunk.setBlockStateId(new Vec3(x,66,z),data.blocksByName.stone.defaultState);
      }
    }
    columns.set(key,chunk);
  }
  return columns.get(key);
}
const bot = new EventEmitter();
bot.version=version;bot.username='camera-fixture';bot.game={dimension:'overworld'};
bot.entity={position:new Vec3(.5,64,.5),yaw:Math.PI,pitch:0};bot.entities={};bot.inventory={items:()=>[]};
bot.world={getColumnAt:async p=>column(Math.floor(p.x/16),Math.floor(p.z/16))};
bot.blockAt=p=>{
  const block=column(Math.floor(p.x/16),Math.floor(p.z/16)).getBlock(new Vec3(((p.x%16)+16)%16,p.y,((p.z%16)+16)%16));
  block.position=p;return block;
};
(async()=>{
 const folder=mkdtempSync(join(tmpdir(),'awl-three-cameras-'));
 console.log('Integration artifacts:',folder);
 const failEncoder=process.argv.includes('--fail-encoder');
 if(failEncoder){
  const ffmpeg=execFileSync('which',['ffmpeg'],{encoding:'utf8'}).trim();
  const bin=join(folder,'bin');mkdirSync(bin);
  const wrapper=join(bin,'ffmpeg');
  writeFileSync(wrapper,`#!/usr/bin/env node
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
if(args.at(-1).endsWith('observer.partial.mp4')){process.stderr.write('injected encoder failure');process.exit(91);}
const r=spawnSync(${JSON.stringify(ffmpeg)},args,{stdio:'inherit'});process.exit(r.status ?? 1);
`);
  chmodSync(wrapper,0o755);process.env.PATH=bin+':'+process.env.PATH;
 }
 let finalizationError;
 // Exercise partial startup failure and port reuse before opening a browser.
 const {startViewer}=require('./viewer-server.cjs');
 const port=Number(process.env.RECORD_VIEWER_PORT || 3007);
 const occupied=await startViewer(bot,{port:port+1,firstPerson:false});
 try {
  await assert.rejects(start(bot,{output:join(folder,'agent-pov.mp4'),width:640,height:360}),/EADDRINUSE/);
 } finally {await occupied.close();}
 const reused=await startViewer(bot,{port,firstPerson:false});
 await reused.close();
 const controller=createFollowController();
 let finish;
 try {
  finish=await start(bot,{output:join(folder,'agent-pov.mp4'),width:640,height:360});
  // Walk into the tunnel, turn, climb and descend in open air, then teleport.
  for(let i=0;i<160;i++){
    if(i<100){bot.entity.position=new Vec3(.5,64,.5+i*.12);bot.entity.yaw=Math.PI;}
    else if(i<120)bot.entity.yaw=Math.PI+(i-100)/20*Math.PI;
    else bot.entity.position=new Vec3(5.5,64+Math.sin((i-120)/40*Math.PI)*2,2.5);
    bot.emit('move');
    const pose=controller.step(terrainSnapshot(bot),.05);
    assert.ok(pose.position.every(Number.isFinite));
    await new Promise(resolve=>setTimeout(resolve,50));
  }
 } finally {
  if(finish){
   const pending=finish();assert.equal(finish(),pending,'concurrent finalization shares completion');
   try{await pending;}catch(error){if(!failEncoder)throw error;finalizationError=error;}
  }
 }
 if(failEncoder){
  assert.ok(finalizationError instanceof AggregateError);
  assert.match(String(finalizationError.errors[0]),/FFmpeg observer failed/);
  assert.ok(!existsSync(join(folder,'observer.mp4')),'failed encode cannot publish final MP4');
 }
 const metadata=JSON.parse(readFileSync(join(folder,'metadata.json'),'utf8'));
 assert.equal(metadata.cameraTimings.length,3);
 assert.equal(metadata.status,failEncoder?'failed':'completed');
 assert.ok(metadata.followTelemetry.updates>0);
 assert.ok(metadata.followTelemetry.obstructedFrames>0,'browser camera encountered terrain');
 assert.ok(metadata.followTelemetry.minimumDistance<2,'browser camera pulled closer');
 const durations=[];
 for(const name of ['agent-pov','observer','follow']){
  assert.ok(statSync(join(folder,name+'.webm')).size>0,'recoverable raw video');
  if(failEncoder && name==='observer')continue;
  const result=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',join(folder,name+'.mp4')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);durations.push(Number(result.stdout));
  const decoded=spawnSync('ffmpeg',['-v','error','-xerror','-i',join(folder,name+'.mp4'),'-f','null','-'],{encoding:'utf8'});
  assert.equal(decoded.status,0,decoded.stderr);
  const content=spawnSync('python3',[join(__dirname,'../../scripts/check-video.py'),join(folder,name+'.mp4')],{encoding:'utf8'});
  assert.equal(content.status,0,content.stderr);console.log(name,content.stdout.trim());
 }
 assert.ok(Math.max(...durations)-Math.min(...durations)<.15,`shared recording duration: ${durations}`);
 assert.ok(metadata.cameraTimings.every(t=>t.captureOpenedAt===metadata.startedAt&&t.rawTrimSeconds>0));
 assert.equal(bot.listenerCount('move'),0,'viewer listeners released');
 console.log('PASS: cameras, terrain fixture, synchronization, encoding, recovery and cleanup', {durations,failEncoder});
})().catch(error=>{console.error(error);process.exitCode=1;});
