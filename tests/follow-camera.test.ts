import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, existsSync} from 'node:fs';
const require = createRequire(import.meta.url);
const {createFollowController, addFollowCamera, terrainSnapshot} = require('../packages/minecraft-recorder/follow-camera.cjs');
const {synchronizationOffset} = require('../packages/minecraft-recorder/sync.cjs');
const state = (pos = {x:0,y:0,z:0}, yaw = 0, boxes:number[][] = []) => ({pos,yaw,boxes});
const length = (a:number[],b:number[]) => Math.hypot(...a.map((v,i)=>v-b[i]));

test('follow starts behind/above the player, including underground, and converges smoothly',()=>{
 const c=createFollowController();
 let p=c.step(state({x:0,y:-32,z:0}),.05);
 assert.ok(p.position[2]>3.9);assert.ok(p.position[1]>-30.75);
 const old=p.position;
 p=c.step(state({x:1,y:-31,z:0},Math.PI/2),.016);
 assert.ok(length(old,p.position)<1);
 for(let n=0;n<120;n++)p=c.step(state({x:1,y:-31,z:0},Math.PI/2),1/60);
 assert.ok(p.position[0]>4.9);assert.ok(Math.abs(p.position[2])<.01);
});
test('turning across the yaw boundary takes the shortest path',()=>{
 const c=createFollowController();c.step(state(undefined,Math.PI-.01),.05);
 const p=c.step(state(undefined,-Math.PI+.01),.016);
 assert.ok(p.position[2]<-3.9);
});
test('walls shorten the boom immediately and removal recovers smoothly',()=>{
 const c=createFollowController();c.step(state(),.05);
 const boxes=[[-5,-5,1,5,5,2]];
 const p=c.step(state(undefined,0,boxes),.016);
 assert.ok(p.position[2]<.83);assert.ok(p.obstructed);
 const out=c.step(state(),.016);
 assert.ok(out.position[2]>p.position[2]);assert.ok(out.position[2]<2);
});
test('low ceilings fall back to a level shoulder view',()=>{
 const p=createFollowController().step(state(undefined,0,[[-5,1.8,-5,5,3,5]]),.05);
 assert.ok(p.position[1]<1.62);assert.ok(p.distance>3.9);
});
test('climbing, descending and teleporting do not leave the target behind',()=>{
 const c=createFollowController();
 for(const y of [4,4.5,5,4.5,0,-32,64]){
  const p=c.step(state({x:0,y,z:0}),.05);
  assert.equal(p.target[1],y+1.25);
  assert.ok(length(p.target,p.position)<8);
  assert.ok(p.position.every(Number.isFinite));
 }
});
test('turns in a narrow tunnel never place the camera through side walls or ceiling',()=>{
 const boxes=[[-2,-2,-8,-.5,4,8],[.5,-2,-8,2,4,8],[-2,2,-8,2,4,8]];
 const c=createFollowController();
 for(let i=0;i<180;i++){
  const p=c.step(state({x:0,y:0,z:-i/100},i/180*Math.PI,boxes),1/60);
  assert.ok(Math.abs(p.position[0])<=.32+.001);
  assert.ok(p.position[1]<=1.82+.001);
 }
});
test('terrain uses collision shapes and treats unloaded blocks as solid',()=>{
 const pos={x:0,y:0,z:0,floored(){return {offset:(x:number,y:number,z:number)=>({x,y,z})};}};
 const snap=terrainSnapshot({entity:{position:pos,yaw:0},blockAt:(p:any)=>p.x===0&&p.y===0&&p.z===0?{shapes:[[0,0,0,1,.5,1]]}:p.x===1?null:{shapes:[]}});
 assert.ok(snap.boxes.some((b:number[])=>b[0]===0&&b[4]===.5));
 assert.ok(snap.boxes.some((b:number[])=>b[0]===1&&b[3]===2));
});
test('follow hook supports the installed upstream bundle and rejects unknown code',t=>{
 const path='packages/minecraft-recorder/node_modules/prismarine-viewer/public/index.js';
 if(!existsSync(path)){t.skip('optional viewer package not installed');return;}
 const patched=addFollowCamera(readFileSync(path,'utf8'));
 assert.match(patched,/window\.__followBridge/);
 // Parsing the actual webpack bundle catches malformed minified insertion.
 assert.doesNotThrow(()=>new Function(patched));
 assert.throws(()=>addFollowCamera('unknown bundle'),/Unsupported/);
 const plain=addFollowCamera('let firstPositionUpdate=true; if (addMesh) {'.replace(' if','    if'));
 assert.match(plain,/viewer.camera.near=.05/);
});
test('sync extraction fails closed and retains a measurable offset',()=>{
 assert.equal(synchronizationOffset('raw.webm',()=>({status:0,stderr:'black_start:4.32 black_end:9.0'})),4.32);
 assert.throws(()=>synchronizationOffset('raw.webm',()=>({status:0,stderr:''})),/gate missing/);
 assert.throws(()=>synchronizationOffset('raw.webm',()=>({status:1,stderr:'bad data'})),/Cannot detect/);
});

test('a turn into a tunnel wall chooses a side view with room for the player',()=>{
 const boxes=[[-2,-2,-8,-.5,4,8],[.5,-2,-8,2,4,8],[-2,2,-8,2,4,8]];
 const p=createFollowController().step(state(undefined,Math.PI/2,boxes),.05);
 assert.ok(p.distance>1.8);assert.ok(Math.abs(p.position[0])<.32);
});
