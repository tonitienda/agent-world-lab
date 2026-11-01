/** Disposable server only. Never mounts or changes the experiment world. */
import assert from "node:assert/strict";
import {execFileSync, execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtempSync, existsSync, copyFileSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import mineflayer, {type Bot} from "mineflayer";
import pathfinderModule from "mineflayer-pathfinder";
import {Vec3} from "vec3";
import {prepareRavine, verifyBotRavine, waitUntil, RAVINE} from "../src/environments/minecraft/ravine.js";
import {worldSettings} from "../src/environments/minecraft/world-config.js";
import {tempRoot} from "./temp-root.js";

const root=resolve(import.meta.dirname,"..");
if(process.env.EULA!=="TRUE" && !(existsSync(join(root,".env")) && /^\s*EULA\s*=\s*["']?TRUE["']?\s*$/m.test(readFileSync(join(root,".env"),"utf8"))))throw Error("Accept the Minecraft EULA with EULA=TRUE before running fixtures");
const folder=mkdtempSync(join(tempRoot,"awl-ravine-fixture-"));
const name=`awl-ravine-${process.pid}-${Date.now()}`;
const docker=(...args:string[])=>execFileSync("docker",args,{encoding:"utf8",timeout:30000,stdio:["ignore","pipe","pipe"]}).trim();
const exec=promisify(execFile);
const command=async(text:string)=>{await exec("docker",["exec","--user","1000",name,"mc-send-to-console",text],{timeout:10000});};
const username="ravine-fixture";
let bot:Bot|undefined;
async function disconnect(){
 if(!bot)return;
 const old=bot;bot=undefined;
 await new Promise<void>(resolve=>{const timer=setTimeout(()=>{old.end();resolve();},3000);old.once("end",()=>{clearTimeout(timer);resolve();});old.quit();});
}
async function connect(port:number){
 const b=mineflayer.createBot({host:"127.0.0.1",port,username,auth:"offline"});
 bot=b;
 b.on("error",error=>console.error("Fixture bot:",error));
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Fixture spawn timed out")),60000);b.once("spawn",()=>{clearTimeout(timer);resolve();});b.once("error",e=>{clearTimeout(timer);reject(e);});});
 return b;
}
console.log("Disposable ravine fixture:",folder,name);
try{
 const jar=join(root,"data/minecraft/minecraft_server.1.21.4.jar");
 if(existsSync(jar))copyFileSync(jar,join(folder,"minecraft_server.1.21.4.jar"));
 docker("run","-d","--name",name,"--label","agent-world-lab.disposable=true","-p","127.0.0.1::25565","-v",`${folder}:/data`,
  "-e","EULA=TRUE","-e","VERSION=1.21.4","-e","ONLINE_MODE=FALSE","-e","MODE=survival","-e","DIFFICULTY=peaceful","-e","LEVEL_TYPE=minecraft:flat",
  "-e",`GENERATOR_SETTINGS=${worldSettings("superflat","12345").generatorSettings}`,"-e","SEED=12345","-e","SPAWN_PROTECTION=0","-e","ENABLE_RCON=FALSE","-e","CREATE_CONSOLE_IN_PIPE=TRUE","-e","MEMORY=1G","itzg/minecraft-server:java21");
 let healthy=false;
 for(let i=0;i<120;i++){
  try{docker("exec",name,"mc-health");healthy=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,2000));}
 }
 assert.ok(healthy,"Disposable server did not become healthy");
 const port=Number(docker("port",name,"25565/tcp").split(":").at(-1));
 console.log("Preparing course with RCON disabled");
 await prepareRavine(await connect(port),command);
 await disconnect();
 console.log("Verifying persisted start after reconnect");
 let b=await connect(port);
 await waitUntil(()=>verifyBotRavine(b),30000);
 await command("setblock 15 95 0 stone");
 await waitUntil(()=>assert.equal(b.blockAt(new Vec3(15,95,0))?.name,"stone"));
 assert.throws(()=>verifyBotRavine(b),/Ravine mismatch/);
 console.log("Rebuilding after marker tampering");
 await prepareRavine(b,command);
 verifyBotRavine(b);
 // Test-only supplies, not part of the actual challenge. Prove vanilla placement
 // and navigation can cross the eight-block gap and reach the landing pad alive.
 await command(`give ${username} oak_planks 8`);
 await waitUntil(()=>assert.ok(b.inventory.items().find(i=>i.name==="oak_planks"&&i.count===8)));
 b.loadPlugin(pathfinderModule.pathfinder);
 const movements=new pathfinderModule.Movements(b);
 movements.canDig=false;movements.allow1by1towers=false;movements.scafoldingBlocks=[];
 b.pathfinder.setMovements(movements);
 await b.equip(b.inventory.items().find(i=>i.name==="oak_planks")!,"hand");
 await b.pathfinder.goto(new pathfinderModule.goals.GoalBlock(3,96,0));
 for(let x=4;x<=11;x++){
  await b.placeBlock(b.blockAt(new Vec3(x-1,95,0))!,new Vec3(1,0,0));
  await waitUntil(()=>assert.equal(b.blockAt(new Vec3(x,95,0))?.name,"oak_planks"));
  await b.pathfinder.goto(new pathfinderModule.goals.GoalBlock(x,96,0));
 }
 await b.pathfinder.goto(new pathfinderModule.goals.GoalBlock(15,96,0));
 assert.ok(b.health>0);assert.ok(b.entity.position.distanceTo(new Vec3(RAVINE.goal.x,RAVINE.goal.y,RAVINE.goal.z))<1);
 console.log("PASS: deterministic geometry, marker validation, persisted empty-inventory survival start, idempotent rebuild and live bridge crossing");
 writeFileSync(join(folder,"result.json"),JSON.stringify({ok:true,goal:RAVINE.goal,position:b.entity.position,health:b.health},null,2));
}finally{
 await disconnect();
 try{writeFileSync(join(folder,"docker-console.log"),docker("logs",name));}catch{}
 try{docker("rm","-f",name);}catch{}
 console.log("Fixture artifacts retained:",folder);
}
