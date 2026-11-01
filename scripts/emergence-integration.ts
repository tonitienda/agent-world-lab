/** Real CLI -> disposable world -> scripted MCP harness -> three cameras ->
 * extraction -> Motion Canvas -> MP4 validation. No paid model calls.
 * All mutable inputs are copied into a fresh temporary repository; existing
 * worlds, episodes and recordings are never mounted or modified. */
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,symlinkSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tempRoot} from './temp-root.js';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const source=resolve(import.meta.dirname,'..');
const guided=process.argv.includes('--guided');
if(!existsSync(join(source,'.env'))||!/^\s*EULA\s*=\s*["']?TRUE["']?\s*$/m.test(readFileSync(join(source,'.env'),'utf8')))throw Error('This fixture requires the existing local Minecraft EULA acceptance');
const root=mkdtempSync(join(tempRoot,'emergence-e2e-'));
console.log('DISPOSABLE orchestration repository:',root);
const project='emergence-e2e-'+process.pid;
async function freePort(){const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return port;}
const port=await freePort();
for(const entry of ['src','scripts','production/src','production/tools','production/package.json','production/vite.config.ts','production/index.html','production/render.html','packages/minecraft-recorder','package.json','compose.yaml','examples/island-scenario']){
 if(entry==='packages/minecraft-recorder'){
  cpSync(join(source,entry),join(root,entry),{recursive:true,filter:p=>!p.includes('node_modules')});
  symlinkSync(join(source,entry,'node_modules'),join(root,entry,'node_modules'),'dir');
 }else cpSync(join(source,entry),join(root,entry),{recursive:true});
}
symlinkSync(join(source,'node_modules'),join(root,'node_modules'),'dir');
symlinkSync(join(source,'production/node_modules'),join(root,'production/node_modules'),'dir');
writeFileSync(join(root,'.env'),'EULA=TRUE\nCOMPOSE_PROJECT_NAME='+project+'\n');
// The fixture never uses the default Compose project, port or /data mount.
writeFileSync(join(root,'compose.yaml'),readFileSync(join(root,'compose.yaml'),'utf8').replace('services:',`name: ${project}\nservices:`));
const bin=join(root,'bin');mkdirSync(bin);
const cli=join(bin,'emergence');cpSync(join(source,'bin/emergence'),cli);chmodSync(cli,0o755);
const harness=join(bin,'claude');
const sdk=fileURLToPath(new URL('../node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js',import.meta.url));
const stdio=fileURLToPath(new URL('../node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js',import.meta.url));
// A scripted protocol client stands in for the model, exercising the actual
// harness subprocess boundary, trusted MCP, recorder and finalization behavior.
writeFileSync(harness,`#!/usr/bin/env node
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(process.argv.includes('--help')){console.log('--print --restricted --settings --disable-slash-commands --no-chrome --tools --strict-mcp-config --setting-sources --no-session-persistence');process.exit(0)}
if(process.argv.includes('auth')){console.log(JSON.stringify({loggedIn:true}));process.exit(0)}
const fs=require('node:fs');
const {Client}=require(${JSON.stringify(sdk)});
const {StdioClientTransport}=require(${JSON.stringify(stdio)});
(async()=>{
 const args=process.argv.slice(2), input=args[args.indexOf('--mcp-config')+1];
 const configuration=JSON.parse(input.startsWith('{')?input:fs.readFileSync(input,'utf8'));
 if(!configuration.mcpServers['agent-world']){console.log(JSON.stringify({decision:'approve',summary:'Known disposable fixture source reviewed by the scripted test harness.',checks:['Local bounded Minecraft fixture operations; this test does not use a paid reviewer.']}));return;}
 const cfg=configuration.mcpServers['agent-world'];
 const client=new Client({name:'disposable-scripted-harness',version:'1.0.0'});
 const transport=new StdioClientTransport({...cfg,env:{...process.env,...cfg.env,RECORD_WIDTH:'320',RECORD_HEIGHT:'180'}});
 try{
  await client.connect(transport,{timeout:180000});
  await client.callTool({name:'observe',arguments:{}},undefined,{timeout:180000});
  await client.callTool({name:'report_intention',arguments:{summary:'I will take a few steps across the island.'}});
  await client.callTool({name:'move_to',arguments:{x:2,y:80,z:0,radius:0,intent:'I will walk toward the edge to inspect the water.'}});
  await new Promise(r=>setTimeout(r,6000));
  await client.callTool({name:'finish_session',arguments:{}},undefined,{timeout:180000});
  console.log('Scripted protocol fixture finished; no model inference was performed.');
 }finally{await client.close();}
})().catch(e=>{console.error(e.message);process.exit(1)});
`);chmodSync(harness,0o755);
const env={...process.env,PATH:bin+':'+process.env.PATH};
async function run(args:string[]){console.log('$ emergence',args.join(' '));const child=spawn(cli,['--root',root,...args],{cwd:root,env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>{output+=b;process.stdout.write(b)});child.stderr.on('data',b=>process.stderr.write(b));const code=await new Promise<number|null>((r,j)=>{child.once('error',j);child.once('exit',r)});assert.equal(code,0,'CLI failed: '+args.join(' '));return output;}
async function runGuided(yaml:string){
 console.log('$ emergence pipeline --design claude --player claude',yaml);
 const child=spawn(cli,['--root',root,'pipeline','--design','claude','--player','claude',yaml],{cwd:root,env,stdio:['pipe','pipe','pipe']});
 let text='',failure:unknown;let processing=Promise.resolve();
 const seen={install:false,world:false,run:false,audio:false,edit:false};
 const require=createRequire(import.meta.url);
 const {chromium}=require('../packages/minecraft-recorder/node_modules/playwright');
 async function preview(url:string,name:string){
  const response=await fetch(url);assert.equal(response.status,200);
  const browser=await chromium.launch({headless:true});
  try{const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(url);await page.waitForTimeout(5000);if(name==='edit'){assert.ok(await page.locator('canvas').count()>0,'Motion Canvas editor has no canvas');}else{assert.ok(page.frames().length>=3,'Scenario preview should embed both camera viewers');}await page.screenshot({path:join(root,name+'-preview.png'),fullPage:false});}finally{await browser.close();}
 }
 async function handle(){
  if(!seen.install&&text.includes('Install this reviewed scenario and prepare the preview? [y/N]')){seen.install=true;child.stdin.write('y\n');}
  if(!seen.world&&text.includes('Does this world match the challenge you want to run? [y/N]')){seen.world=true;const url=text.match(/Open this scenario preview: (http:\/\/[^\s]+)/)?.[1];assert.ok(url);await preview(url,'world');child.stdin.write('y\n');}
  if(!seen.run&&text.includes('Start this recorded take from the approved scenario? [y/N]')){seen.run=true;child.stdin.write('y\n');}
  if(text.includes('Starting the recorded take after your world approval.'))seen.run=true;
  if(!seen.audio&&text.includes('Copy the audio files, then press Enter to check again')){seen.audio=true;const pid='episode-fixture-claude-001',folder=join(root,'production',pid),audio=join(root,'production/public',pid,'audio');const lines=JSON.parse(readFileSync(join(folder,'narration-manifest.json'),'utf8'));for(const line of lines)execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=600:duration=0.5','-c:a','pcm_s16le',join(audio,line.audio)]);child.stdin.write('\n');}
  if(!seen.edit&&text.includes('Render this edit? y = render')){seen.edit=true;const url=text.match(/Open the Motion Canvas edit preview: (http:\/\/[^\s]+)/)?.[1];assert.ok(url);await preview(url,'edit');child.stdin.write('y\n');}
 }
 child.stdout.on('data',b=>{text+=b;process.stdout.write(b);processing=processing.then(()=>failure?undefined:handle()).catch(e=>{failure=e;child.kill('SIGTERM')});});child.stderr.on('data',b=>process.stderr.write(b));
 const timer=setTimeout(()=>{failure=Error('Guided fixture timed out');child.kill('SIGTERM')},600000);
 const code=await new Promise<number|null>((r,j)=>{child.once('error',j);child.once('exit',r)});clearTimeout(timer);await processing;if(failure)throw failure;assert.equal(code,0,'Guided CLI failed');assert.ok(Object.values(seen).every(Boolean),'A guided approval/audio step was skipped');
}
try{
 await run(['episode','new','episode-fixture']);
 const episode=join(root,'episodes/episode-fixture');
 const yaml=readFileSync(join(episode,'episode.yaml'),'utf8').replace('version: "1.21.4"',`version: "1.21.4"\n    port: ${port}`);
 writeFileSync(join(episode,'episode.yaml'),yaml);
 writeFileSync(join(episode,'goal.md'),'Inspect the island, walk a few steps, and finish the session.\n');
 await run(['episode','validate','episode-fixture']);
 const bundle=JSON.parse(execFileSync(process.execPath,[join(root,'examples/island-scenario/bundle.mjs')],{encoding:'utf8'}));
 const manifest=JSON.parse(bundle.files['manifest.json']);manifest.targets['mainland-landmark']={x:2,y:80,z:0};bundle.files['manifest.json']=JSON.stringify(manifest);
 const bundleFile=join(root,'fixture.bundle.json');writeFileSync(bundleFile,JSON.stringify(bundle));
 const generated=await run(['scenario','generate','episode-fixture','--bundle',bundleFile]);
 const digest=generated.match(/Approval digest: ([a-f0-9]{64})/)?.[1];assert.ok(digest);
 if(guided){
  await runGuided(join(episode,'episode.yaml'));
  const r=JSON.parse(readFileSync(join(episode,'runs/claude/take-001/run.json'),'utf8'));assert.equal(r.workflow,'produced');assert.equal(r.objective.outcome,'success');
  const before=readFileSync(join(episode,'runs/claude/take-001/events.json'),'utf8');
  await run(['pipeline',join(episode,'episode.yaml'),'--design','claude','--player','claude']);
  assert.equal(readFileSync(join(episode,'runs/claude/take-001/events.json'),'utf8'),before,'Resume should not repeat the agent');
  console.log('PASS: guided pipeline approvals, actual browser previews, audio pause, automatic whole-voice edit, render, MP4 checks and no-reset resume. Artifacts:',root);
 }else{
 await run(['scenario','validate','episode-fixture','--yes','--approve-code',digest]);
 await run(['scenario','freeze','episode-fixture']);
 await run(['run','episode-fixture','--agent','claude','--yes']);
 await run(['runs','list','episode-fixture']);
 const runFolder=join(episode,'runs/claude/take-001');
 const metadata=JSON.parse(readFileSync(join(runFolder,'run.json'),'utf8'));assert.equal(metadata.infrastructure,'completed');assert.equal(metadata.objective.outcome,'success');
 await run(['extract','episode-fixture','--agent','claude']);
 const pid='episode-fixture-claude-001';
 const production=join(root,'production',pid),audio=join(root,'production/public',pid,'audio');mkdirSync(audio,{recursive:true});
 const narration=JSON.parse(readFileSync(join(production,'narration-manifest.json'),'utf8'));
 // Synthetic tone only: prove the renderer/validation integration without claiming
 // these fixture sounds are generated narration or a publishable finished episode.
 for(const line of narration)execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=600:duration=0.5','-c:a','pcm_s16le',join(audio,line.audio)]);
 const draft=JSON.parse(readFileSync(join(production,'edit-plan.json'),'utf8'));
 const plan={version:2,fps:25,title:'Disposable orchestration fixture',cameras:draft.cameras,segments:narration.map((v:any,i:number)=>({id:'fixture-'+i,kind:i===0?'intro':'shot',duration:1.6,...(i===0?{text:v.text}:{shot:{kind:i===1?'full':i===2?'pip':'split',cameras:i===1?['agent-pov']:i===2?['observer','agent-pov']:['follow','agent-pov'],start:(i-1)*1.6,duration:1.6}}),narration:[{line:v.line,audio:v.audio,at:.3}]}))};
 writeFileSync(join(production,'edit-plan.json'),JSON.stringify(plan));
 await run(['produce','episode-fixture','--agent','claude']);
 await run(['status','episode-fixture']);
 assert.ok(existsSync(join(root,'production/output',pid+'.mp4')));
 console.log('PASS: complete disposable CLI lifecycle with real Minecraft, MCP recording, extraction and Motion Canvas. Scripted harness and synthetic audio; no paid model or voice service. Artifacts:',root);
 }
}finally{
 // Only the unique fixture Compose project is removed. Keep artifacts for diagnosis.
 try{writeFileSync(join(root,'docker-console.log'),execFileSync('docker',['compose','logs','--no-color'],{cwd:root,env:{...env,MC_PORT:String(port)},encoding:'utf8',timeout:30000}));}catch{}
 execFileSync('docker',['compose','down'],{cwd:root,env:{...env,MC_PORT:String(port)},stdio:'inherit',timeout:60000});
}
