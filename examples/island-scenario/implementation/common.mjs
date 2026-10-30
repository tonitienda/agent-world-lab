import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
export const root=process.env.EMERGENCE_REPO;
if(!root||process.env.AGENT_ID!=='emergence-player')throw Error('Run through emergence with the fixed snapshot player identity');
export const require=createRequire(join(root,'package.json'));
const mineflayer=require('mineflayer');
export const {Vec3}=require('vec3');
const exec=promisify(execFile);
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function wait(check,timeout=30000){const deadline=Date.now()+timeout;let last;do{try{await check();return;}catch(e){last=e;await delay(200);}}while(Date.now()<deadline);throw last??Error('Timed out');}
export async function connect(){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:Number(process.env.MC_PORT??25565),username:process.env.AGENT_ID,auth:'offline'});
 bot.on('error',e=>console.error(e.message));
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Spawn timeout')),60000);bot.once('spawn',()=>{clearTimeout(timer);resolve()});bot.once('error',e=>{clearTimeout(timer);reject(e)});bot.once('end',()=>{clearTimeout(timer);reject(Error('Disconnected before spawn'))});});await bot.waitForChunksToLoad();return bot;}catch(e){bot.end();throw e;}
}
export async function close(bot){await new Promise(resolve=>{const t=setTimeout(()=>{bot.end();resolve()},3000);bot.once('end',()=>{clearTimeout(t);resolve()});bot.quit();});}
export async function command(text){await exec('docker',['compose','exec','-T','--user','1000','minecraft','mc-send-to-console',text],{cwd:root,timeout:10000});}
export async function fill(x1,y1,z1,x2,y2,z2,block){for(let x=x1;x<=x2;x+=16)await command(`fill ${x} ${y1} ${z1} ${Math.min(x+15,x2)} ${y2} ${z2} ${block}`);}
export async function capabilities(){return (await import(pathToFileURL(join(root,'src/environments/minecraft/adapter.ts')).href)).minecraftCapabilities;}
export async function recorderPrerequisites(){
 require.resolve('./packages/minecraft-recorder/index.cjs');
 // This require resolves from the recorder package's own dependency tree.
 const rr=createRequire(join(root,'packages/minecraft-recorder/index.cjs'));
 const {chromium}=rr('playwright');
 const {existsSync}=await import('node:fs');
 if(!existsSync(chromium.executablePath()))throw Error('Install recorder Chromium: cd packages/minecraft-recorder && npx playwright install chromium');
 await exec('ffmpeg',['-version']);await exec('ffprobe',['-version']);
}
