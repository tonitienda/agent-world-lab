import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Vec3} from "vec3";
import {RAVINE, fillCommands, ravineCuboids, expectedRavineBlocks, verifyRavineBlocks, verifyRavineStart, prepareRavine, readRavineManifest, agentName, ravineBriefing, waitUntil} from "../src/environments/minecraft/ravine.js";

test("course has two banks, an eight-block gap, deadly drop, gold marker and reachable wood",()=>{
 const blocks=expectedRavineBlocks();
 assert.equal(blocks.get("3,95,0"),"grass_block");
 assert.equal(blocks.get("12,95,0"),"grass_block");
 for(let x=4;x<=11;x++)for(let y=72;y<=95;y++)assert.equal(blocks.get(`${x},${y},0`),"air");
 assert.equal(blocks.get("8,71,0"),"stone");
 assert.equal(blocks.get("15,95,0"),"gold_block");
 assert.equal(blocks.get("18,99,0"),"emerald_block");
 assert.equal(blocks.get("-1,96,-5"),"oak_log");
 assert.equal(blocks.get("-6,96,6"),"oak_log");
 assert.ok(RAVINE.gap.minX-RAVINE.start.x<3,"gap appears in initial local scan");
 assert.match(ravineBriefing(),/constructed/);assert.match(ravineBriefing(),/15.5, 96, 0.5/);
});
test("all vanilla fill commands stay within the default block limit, including large headroom",()=>{
 for(const command of ravineCuboids().flatMap(fillCommands)){
  const parts=command.split(" ");
  const min=parts.slice(1,4).map(Number),max=parts.slice(4,7).map(Number);
  assert.ok(max.reduce((volume,n,i)=>volume*(n-min[i]+1),1)<=32768);
 }
 assert.throws(()=>fillCommands({min:[1,0,0],max:[0,0,0],block:"air"}),/Invalid/);
});
test("course verification rejects a missing marker, blocked gap, and unloaded terrain",()=>{
 const blocks=expectedRavineBlocks();
 const get=(x:number,y:number,z:number)=>blocks.get(`${x},${y},${z}`);
 assert.ok(verifyRavineBlocks(get).blocksVerified>70000);
 for(const [key,wrong] of [["15,95,0","stone"],["7,95,0","stone"],["3,95,0",undefined]] as const){
  const original=blocks.get(key)!;
  if(wrong)blocks.set(key,wrong);else blocks.delete(key);
  assert.throws(()=>verifyRavineBlocks(get),/Ravine mismatch/);
  blocks.set(key,original);
 }
});
test("starting-state checks require the right position, survival mode, empty inventory and full health/food",()=>{
 const state={position:RAVINE.start,health:20,food:20,environment:{gameMode:"survival"}};
 verifyRavineStart(state,[]);
 for(const changed of [{...state,health:19},{...state,food:19},{...state,position:{x:0,y:64,z:0}},{...state,environment:{gameMode:"spectator"}}])assert.throws(()=>verifyRavineStart(changed,[]));
 assert.throws(()=>verifyRavineStart(state,[{name:"oak_log"}]));
});
test("setup commands are repeatable and do not grant the challenge player building supplies",async()=>{
 const blocks=new Map<string,string>();
 const bot:any={username:"emergent-002",entity:{position:new Vec3(0,64,0),yaw:0},game:{gameMode:"survival"},health:20,food:20,inventory:{items:()=>[]},blockAt:(p:Vec3)=>({name:blocks.get(`${p.x},${p.y},${p.z}`)??"air"})};
 const runs:string[][]=[];
 for(let repeat=0;repeat<2;repeat++){
  const commands:string[]=[];runs.push(commands);
  await prepareRavine(bot,async command=>{
   commands.push(command);const parts=command.split(" ");
   if(parts[0]==="gamemode")bot.game.gameMode=parts[1];
   if(parts[0]==="tp"){bot.entity.position=new Vec3(...parts.slice(2,5).map(Number) as [number,number,number]);bot.entity.yaw=3*Math.PI/2;}
   if(parts[0]==="fill"){
    const [x0,y0,z0,x1,y1,z1]=parts.slice(1,7).map(Number);
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)blocks.set(`${x},${y},${z}`,parts[7].replace("minecraft:","").split("[")[0]);
   }
  });
  verifyRavineBlocks((x,y,z)=>blocks.get(`${x},${y},${z}`));
  assert.ok(!commands.some(c=>c.startsWith("give ")||c.startsWith("op ")));
 }
 assert.deepEqual(runs[0],runs[1]);
 for(const name of ["@a","player;op","bad name","12345678901234567",""])assert.throws(()=>agentName(name));
});
test("scenario manifests reject a stale world, changed geometry, or another recording player",()=>{
 const dir=mkdtempSync(join(tmpdir(),"awl-ravine-manifest-")),file=join(dir,"scenario.json");
 const world={seed:"20261027",verifiedAt:"2026-10-28T10:00:00Z"};
 const manifest={id:RAVINE.id,agent:"emergent-002",verifiedAt:"2026-10-28T10:01:00Z",world,course:RAVINE};
 try{
  writeFileSync(file,JSON.stringify(manifest));
  assert.equal(readRavineManifest(file,world,"emergent-002").id,"ravine-v1");
  assert.throws(()=>readRavineManifest(file,{...world,seed:"4"},"emergent-002"),/stale/);
  assert.throws(()=>readRavineManifest(file,{...world,verifiedAt:"2026-10-29T10:00:00Z"},"emergent-002"),/stale/);
  assert.throws(()=>readRavineManifest(file,world,"other-agent"),/stale/);
  writeFileSync(file,JSON.stringify({...manifest,course:{...RAVINE,start:{x:0,y:0,z:0}}}));
  assert.throws(()=>readRavineManifest(file,world,"emergent-002"),/stale/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("failed live verification cannot wait forever",async()=>{
 await assert.rejects(waitUntil(()=>{throw Error("Missing marker");},1),/Missing marker/);
});
