/** Read-only browser observation of the installed scenario; no agent or recorder. */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import mineflayer from 'mineflayer';
import {acquireLock} from '../src/session/lock.js';
const root=resolve(import.meta.dirname,'..');
const episode=resolve(process.argv[2]??'');
const ready=process.argv[3];
if(!ready||!episode.startsWith(join(root,'episodes')+'/'))throw Error('Expected managed episode directory and readiness file');
const require=createRequire(import.meta.url);
const {startViewer}=require('../packages/minecraft-recorder/viewer-server.cjs') as {startViewer:(bot:unknown,options:{port:number;firstPerson:boolean})=>Promise<{port:number;close:()=>Promise<void>}>};
const release=acquireLock('scenario preview session');
const bot=mineflayer.createBot({host:'127.0.0.1',port:Number(process.env.MC_PORT??25565),username:'emergence-player',auth:'offline'});
const viewers:Array<{port:number;close:()=>Promise<void>}>=[];
let server:ReturnType<typeof createServer>|undefined;
let closed=false;
async function close(){if(closed)return;closed=true;for(const viewer of viewers)await viewer.close();if(server)await new Promise<void>(r=>server!.close(()=>r()));await new Promise<void>(r=>{const t=setTimeout(()=>{bot.end();r()},2000);bot.once('end',()=>{clearTimeout(t);r()});bot.quit();});release();}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void close().then(()=>process.exit(0));});
const escape=(value:unknown)=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
try{
 bot.on('error',e=>console.error('Preview:',e.message));
 await new Promise<void>((r,j)=>{const t=setTimeout(()=>j(Error('Preview bot spawn timed out')),60000);bot.once('spawn',()=>{clearTimeout(t);r()});bot.once('error',e=>{clearTimeout(t);j(e)});bot.once('end',()=>{clearTimeout(t);j(Error('Preview disconnected'))});});
 await bot.waitForChunksToLoad();
 viewers.push(await startViewer(bot,{port:0,firstPerson:true}));
 viewers.push(await startViewer(bot,{port:0,firstPerson:false}));
 const goal=process.env.EMERGENCE_PREVIEW_GOAL??readFileSync(join(episode,'goal.md'),'utf8');
 const manifest=JSON.parse(readFileSync(join(episode,'scenario/manifest.json'),'utf8'));
 const evidence=JSON.parse(readFileSync(join(episode,'.verification.json'),'utf8'));
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>Scenario review</title><style>body{font:17px system-ui;background:#101d26;color:#edf1ea;margin:32px}h1{margin-bottom:8px}.views{display:grid;grid-template-columns:1fr 1fr;gap:16px}iframe{width:100%;height:480px;border:1px solid #59777b}pre{white-space:pre-wrap;background:#20323c;padding:18px}li{margin:10px 0}a{color:#9ccec9}</style></head><body><h1>Check the scenario before the agent plays</h1><p>This is an observation-only preview. Return to the terminal to approve or stop.</p><div class="views"><div><h2>Player view</h2><iframe title="Player view" src="http://127.0.0.1:${viewers[0].port}"></iframe></div><div><h2>Orbit view</h2><iframe title="Orbit view" src="http://127.0.0.1:${viewers[1].port}"></iframe></div></div><h2>The player's entire goal</h2><pre>${escape(goal)}</pre><h2>What to check</h2><ol><li>Does the player start where you intended, without already completing the challenge?</li><li>Can you identify the destination or landmark described in the goal?</li><li>Are the promised resources visible or present, with room to try different approaches?</li><li>Does the world look usable in both cameras, without missing terrain or a blocked view?</li></ol><h2>Automated evidence</h2><pre>${escape(JSON.stringify(evidence,null,2))}</pre><h2>Registered spawn and targets (operator only)</h2><pre>${escape(JSON.stringify({spawn:manifest.spawn,targets:manifest.targets},null,2))}</pre><p>Drag the orbit view to inspect the scene. This does not prove the challenge is solvable; no playing agent is running.</p></body></html>`;
 server=createServer((request,response)=>{if(request.url!=='/'){response.writeHead(404).end();return}response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(html);});
 await new Promise<void>((r,j)=>{server!.once('error',j);server!.listen(0,'127.0.0.1',r);});
 const port=(server.address() as {port:number}).port;
 writeFileSync(ready,JSON.stringify({url:`http://127.0.0.1:${port}/`,pid:process.pid}));
 console.log('Scenario browser preview ready. No gameplay actions or recordings are being made.');
}catch(e){await close();throw e;}
