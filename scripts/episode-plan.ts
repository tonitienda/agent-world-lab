import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const session=resolve(process.argv[2]??'');
if(!process.argv[2]) throw Error('Usage: npm run episode:plan -- <session-directory>');
const out=resolve('production/generated');
const media=resolve('production/public/media');
mkdirSync(out,{recursive:true});mkdirSync(media,{recursive:true});
const events=JSON.parse(readFileSync(join(session,'events.json'),'utf8')) as Array<{at?:string;kind?:string;action?:string;details?:any;payload?:any}>;
const names=['agent-pov','observer'];
const metadata=JSON.parse(readFileSync(join(session,'metadata.json'),'utf8')) as {
 startedAt?:string; cameraTimings?:Array<{name:string;captureOpenedAt:string;readyAt:string}>
};
const opened=new Map((metadata.cameraTimings??[]).map(c=>[c.name,Date.parse(c.captureOpenedAt)]));
const origins=names.map(name=>opened.get(name)).filter((n):n is number=>n!==undefined&&Number.isFinite(n));
const origin=origins.length===names.length?Math.min(...origins):Date.parse(metadata.startedAt??'');
if(!Number.isFinite(origin))throw Error('Missing valid recorder time metadata');
const offsets=names.map(name=>origins.length===names.length?(origin-(opened.get(name)??origin))/1000:0);
const latestReady=metadata.cameraTimings?.length===names.length ?
 Math.max(...metadata.cameraTimings.map(c=>Date.parse(c.readyAt))) : origin;
const clipFloor=Math.max(0,(latestReady-origin)/1000);

const probe=(name:string):number=>{
 const result=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nokey=1:noprint_wrappers=1',join(session,name+'.mp4')],{encoding:'utf8'});
 if(result.status!==0)throw Error('Missing or invalid '+name+'.mp4: '+result.stderr);
 const duration=Number(result.stdout.trim()); if(!Number.isFinite(duration)||duration<=0)throw Error('Bad duration for '+name);
 return duration;
};
const lengths=names.map(probe);
const usable=Math.min(...lengths.map((len,i)=>len-offsets[i]));
if(usable-clipFloor<3)throw Error('Recordings too short for episode');
for(const name of names)copyFileSync(join(session,name+'.mp4'),join(media,name+'.mp4'));
const segments:any[]=[{kind:'intro',duration:7,text:'An AI agent enters Minecraft. What will it try?'}];
const comments:Array<{segmentIndex:number;text:string;at:number}>=[];
const startTime=origin;
const timed=events.map((e,i)=>{
 const raw=e.kind??e.action??'event';
 const detail=e.payload??e.details??{};
 const t=Date.parse(e.at??'');
 return {index:i,kind:raw,detail,second:Number.isFinite(t)&&Number.isFinite(startTime)?(t-startTime)/1000:NaN};
}).filter(e=>Number.isFinite(e.second)&&e.second>=clipFloor&&e.second<usable);
let selected=timed.filter(e=>/report_intention|decision|move_to$|mine$|place$|error|finished|spawn/i.test(e.kind));
if(selected.length===0)selected=timed;
let last=clipFloor;
for(const e of selected.slice(0,6)){
 const clipStart=Math.max(last,Math.min(usable-2,e.second));
 const duration=Math.min(5,usable-clipStart);
 if(duration<1.5)continue;
 const interaction=/mine|place|result|error/i.test(e.kind);
 const layout=interaction?'pip':'full';
 segments.push({kind:'shot',duration,shot:{kind:layout,cameras:interaction?['agent-pov','observer']:['observer'],start:clipStart,duration,label:e.kind}});
 const coords=e.detail.args as {x?:number;y?:number;z?:number;summary?:string}|undefined;
 const result=e.detail.result as {ok?:boolean;message?:string}|undefined;
 let sentence:string|undefined;
 if(e.kind==='report_intention' && coords?.summary){
   sentence='Claude states its goal: '+String(coords.summary).slice(0,220);
 }else if(e.kind==='mine'){
   const block=result?.message?.match(/^Mined (.+)$/)?.[1];
   if(result?.ok===true && block) sentence='Claude breaks '+block.replaceAll('_',' ')+'.';
   else if(result?.ok===false) sentence='The attempt to mine a block fails: '+String(result.message??'unknown reason')+'.';
 }else if(e.kind==='place'){
   sentence=result?.ok?'Claude places a block from its inventory.':'Claude tries to place a block, but the attempt fails.';
 }else if(e.kind==='move_to' && result?.ok===false){
   sentence='Claude tries to reach a new position, but cannot get there.';
 }else if(/error/.test(e.kind)){
   sentence='The experiment encounters an error: '+String(e.detail.error??'unknown error').slice(0,160)+'.';
 }
 // Ordinary movement does not merit narration by itself. Silence leaves
 // space to observe the agent rather than reading the tool transcript aloud.
 if(sentence) comments.push({segmentIndex:segments.length-1,text:sentence,at:e.second});
 last=clipStart+duration;
}
if(segments.length===1)segments.push({kind:'shot',duration:Math.min(usable-clipFloor,8),shot:{kind:'split',cameras:names,start:clipFloor,duration:Math.min(usable-clipFloor,8)}});
segments.push({kind:'outro',duration:6,text:'What prompt or scenario should we try next? Leave a comment.'});
const plan={version:1,title:'Emergent — Pilot episode',cameras:names.map(id=>({id,file:id+'.mp4',offsetSeconds:offsets[names.indexOf(id)]})),segments};
writeFileSync(join(out,'edit-plan.json'),JSON.stringify(plan,null,2)+'\n');
// One text file: one spoken line per segment that calls for narration.
// IDs match ElevenLabs batch output 001.mp3, 002.mp3, etc.
const voiceLines=[
 {segmentIndex:0,text:'We gave Claude one simple goal in Minecraft: explore, find something interesting, and try to collect it.'},
 ...comments,
 {segmentIndex:segments.length-1,text:'What should we ask the next agent to try? Leave your prompts and scenarios in the comments.'}
];
writeFileSync(join(out,'narration.txt'),voiceLines.map(line=>line.text).join('\\n')+'\\n');
writeFileSync(join(out,'narration-manifest.json'),JSON.stringify(voiceLines.map((line,i)=>({
 line:i+1,segmentIndex:line.segmentIndex,text:line.text,audio:String(i+1).padStart(3,'0')+'.mp3'
})),null,2)+'\\n');
console.log('Prepared',out,'using videos',lengths,'seconds; clips:',segments.length);
console.log('Narration: one line per clip in production/generated/narration.txt. Export audio as 001.mp3, 002.mp3, etc.');
