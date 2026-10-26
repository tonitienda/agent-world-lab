import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const args=process.argv.slice(2);
const force=args.includes('--force');
const positional=args.filter(a=>a!=='--force');
if(positional.length<1||positional.length>2||args.filter(a=>a==='--force').length>1)
 throw Error('Usage: npm run episode:plan -- <session-directory> [episode-id] [--force]');
const session=resolve(positional[0]);
const episode=positional[1]??'episode-001';
if(!/^episode-[a-zA-Z0-9-]+$/.test(episode))throw Error('Expected episode name like episode-001');
const out=resolve('production',episode);
const artifacts=['edit-plan.json','narration.txt','narration-manifest.json'];
const existing=artifacts.filter(name=>existsSync(join(out,name)));
if(existing.length>0&&!force){
 console.warn('WARNING: Existing episode files not overwritten: '+existing.join(', ')+'. Use --force to regenerate.');
 if(existing.length!==artifacts.length)throw Error('Partial episode output exists; use --force to regenerate all three files consistently.');
}
const media=resolve('production/public',episode,'video');
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
for(const name of names){
 const destination=join(media,name+'.mp4');
 if(!existsSync(destination))copyFileSync(join(session,name+'.mp4'),destination);
}
const segments:any[]=[{kind:'intro',duration:7,text:'An AI agent enters Minecraft. What will it try?'}];
const comments:Array<{segmentIndex:number;text:string;at:number}>=[];
const startTime=origin;
const allTimed=events.map((e,i)=>{
 const raw=e.kind??e.action??'event';
 const detail=e.payload??e.details??{};
 const t=Date.parse(e.at??'');
 return {index:i,kind:raw,detail,second:Number.isFinite(t)&&Number.isFinite(startTime)?(t-startTime)/1000:NaN};
});
const intentions=allTimed.filter(e=>e.kind==='report_intention');
const valid=intentions.filter(e=>typeof e.detail?.args?.summary==='string'&&e.detail.args.summary.trim().length>0);
const invalid=intentions.length-valid.length;
const outside=valid.filter(e=>!Number.isFinite(e.second)||e.second<clipFloor||e.second>=usable);
const timed=allTimed.filter(e=>Number.isFinite(e.second)&&e.second>=clipFloor&&e.second<usable);
let selected=valid.filter(e=>Number.isFinite(e.second)&&e.second>=clipFloor&&e.second<usable);
console.log('Episode '+episode);
console.log('  Events loaded:             '+events.length);
console.log('  Intentions found:          '+intentions.length);
console.log('  Malformed/empty intentions:'+invalid);
console.log('  Intentions outside video:  '+outside.length);
console.log('  Intentions within video:   '+selected.length);
if(invalid>0)console.warn('WARNING: '+invalid+' intention event(s) have no nonempty details.args.summary.');
if(outside.length>0)console.warn('WARNING: '+outside.length+' intention event(s) have invalid/out-of-range timestamps.');
if(intentions.length>0&&selected.length===0)
 throw Error('No usable intentions: all report_intention events were malformed or outside the recording window.');
if(selected.length>20)console.warn('WARNING: Only the first 20 intent events are eligible for clips.');
// Intent events are the voice track; do not allocate extra clips for the
// subsequent tool results or silently drop commentary after the sixth action.
if(selected.length===0)selected=timed.filter(e=>/move_to$|mine$|place$/i.test(e.kind));
// Begin a shot before the action so viewers see the lead-in, not just its result.
const preroll=3;
let last=clipFloor;
let includedIntentions=0;
for(const e of selected.slice(0,20)){
 const clipStart=Math.max(last,clipFloor,Math.min(usable-2,e.second-preroll));
 const duration=Math.min(9,usable-clipStart);
 if(duration<1.5)continue;
 const interaction=/mine|place|result|error/i.test(e.kind) || /mine|place/.test(String(e.detail.args?.action??''));
 // Movement is best established in the tracking observer shot; close-up
 // mining/placement uses POV, with a three-second lead-in before the action.
 const camera=interaction?'agent-pov':'observer';
 segments.push({kind:'shot',duration,shot:{kind:'full',cameras:[camera],start:clipStart,duration,label:e.kind==='report_intention'?String(e.detail.args?.action??'Agent commentary'):e.kind}});
 // Let the agent speak in its own words, rather than inventing commentary.
 // These are public, deliberately brief statements recorded by report_intention.
 if(e.kind==='report_intention'){
   const summary=String(e.detail.args?.summary??'').trim();
   if(summary){comments.push({segmentIndex:segments.length-1,text:summary.slice(0,300),at:e.second});includedIntentions++;}
 }
 last=clipStart+duration;
}
if(intentions.length>0&&includedIntentions===0)throw Error('No intention narration survived clip selection.');
if(selected.length>includedIntentions)console.warn('WARNING: '+(selected.length-includedIntentions)+' usable intentions omitted by clip budget/timing.');
console.log('  Intentions selected:       '+includedIntentions);
if(segments.length===1)segments.push({kind:'shot',duration:Math.min(usable-clipFloor,8),shot:{kind:'split',cameras:names,start:clipFloor,duration:Math.min(usable-clipFloor,8)}});
segments.push({kind:'outro',duration:6,text:'What prompt or scenario should we try next? Leave a comment.'});
const plan={version:1,title:'Emergent — Pilot episode',cameras:names.map(id=>({id,file:id+'.mp4',offsetSeconds:offsets[names.indexOf(id)]})),segments};
if(force||!existsSync(join(out,'edit-plan.json')))writeFileSync(join(out,'edit-plan.json'),JSON.stringify(plan,null,2)+'\n');
// One text file: one spoken line per segment that calls for narration.
// IDs match ElevenLabs batch output 001.mp3, 002.mp3, etc.
const voiceLines=[
 {segmentIndex:0,text:'We gave Claude one simple goal in Minecraft: explore, find something interesting, and try to collect it.'},
 ...comments,
 {segmentIndex:segments.length-1,text:'What should we ask the next agent to try? Leave your prompts and scenarios in the comments.'}
];
if(force||!existsSync(join(out,'narration.txt')))writeFileSync(join(out,'narration.txt'),voiceLines.map(line=>line.text).join('\n')+'\n');
if(force||!existsSync(join(out,'narration-manifest.json')))writeFileSync(join(out,'narration-manifest.json'),JSON.stringify(voiceLines.map((line,i)=>({
 line:i+1,segmentIndex:line.segmentIndex,text:line.text,audio:String(i+1).padStart(3,'0')+'.mp3'
})),null,2)+'\n');
console.log('  Narration lines:           '+voiceLines.length);
console.log('Prepared',out,'using videos',lengths,'seconds; clips:',segments.length);
console.log('Narration: '+join(out,'narration.txt')+'. Export audio as 001.mp3, 002.mp3, etc.');
