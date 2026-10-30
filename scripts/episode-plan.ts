import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync,linkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
// @ts-ignore Shared Node-only opening-copy helper.
import {summarizeGoal} from '../production/tools/intro.mjs';

const introGoal=summarizeGoal(process.env.EMERGENCE_GOAL_TEXT??'Explore, find something interesting, and try to collect it.');

const args=process.argv.slice(2);
const force=args.includes('--force');
const preserveAll=args.includes('--preserve-all-intentions');
const linkMedia=args.includes('--link-media');
const positional=args.filter(a=>!['--force','--preserve-all-intentions','--link-media'].includes(a));
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
 cameras?:Array<{name:string}>; startedAt?:string; cameraTimings?:Array<{name:string;captureOpenedAt:string;readyAt:string}>
};
// Legacy sessions remain usable; declared follow recordings must exist and probe successfully.
if(metadata.cameras?.some(c=>c.name==='follow') || existsSync(join(session,'follow.mp4')))names.push('follow');
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
 if(!existsSync(destination)){
   if(linkMedia){try{linkSync(join(session,name+'.mp4'),destination);}catch(e){if((e as NodeJS.ErrnoException).code!=='EXDEV')throw e;copyFileSync(join(session,name+'.mp4'),destination);}}
   else copyFileSync(join(session,name+'.mp4'),destination);
 }
}
const segments:any[]=[{kind:'intro',duration:7,text:introGoal}];
const clipSegmentsByEvent=new Map<number,number>();
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
if(intentions.length>0&&selected.length===0&&!preserveAll)
 throw Error('No usable intentions: all report_intention events were malformed or outside the recording window.');
if(selected.length>20)console.warn('WARNING: Preview edit plan contains at most 20 intention shots; all valid intentions remain in narration.');
// Intent events are the voice track; do not allocate extra clips for the
// subsequent tool results or silently drop commentary after the sixth action.
if(selected.length===0)selected=timed.filter(e=>/^(move_to|mine|place|craft|equip|drop|interact_block|interact_entity|open_container|transfer_item|eat|attack|use_item)$/i.test(e.kind));
// Begin a shot before the action so viewers see the lead-in, not just its result.
const preroll=3;
let last=clipFloor;
let includedIntentions=0;
for(const e of selected.slice(0,20)){
 const clipStart=Math.max(last,clipFloor,Math.min(usable-2,e.second-preroll));
 const duration=Math.min(9,usable-clipStart);
 if(duration<1.5)continue;
 const interaction=/mine|place|craft|equip|drop|interact|container|transfer|eat|attack|use_item|result|error/i.test(e.kind) || /mine|place|craft|equip|drop|interact|container|transfer|eat|attack|use_item/.test(String(e.detail.args?.action??''));
 // Movement uses the follow camera when available; close-up
 // mining/placement uses POV, with a three-second lead-in before the action.
 const camera=interaction?'agent-pov':names.includes('follow')?'follow':'observer';
 segments.push({kind:'shot',duration,shot:{kind:'full',cameras:[camera],start:clipStart,duration,label:e.kind==='report_intention'?String(e.detail.args?.action??'Agent commentary'):e.kind}});
 // Let the agent speak in its own words, rather than inventing commentary.
 // These are public, deliberately brief statements recorded by report_intention.
 if(e.kind==='report_intention'){
   const summary=String(e.detail.args?.summary??'').trim();
   if(summary){clipSegmentsByEvent.set(e.index,segments.length-1);includedIntentions++;}
 }
 last=clipStart+duration;
}
if(intentions.length>0&&includedIntentions===0&&!preserveAll)throw Error('No intention narration survived clip selection.');
if(selected.length>includedIntentions)console.warn('WARNING: '+(selected.length-includedIntentions)+' intention(s) have no preview clip; their narration is still extracted.');
console.log('  Intentions selected:       '+includedIntentions);
if(segments.length===1)segments.push({kind:'shot',duration:Math.min(usable-clipFloor,8),shot:{kind:'split',cameras:names.slice(0,2),start:clipFloor,duration:Math.min(usable-clipFloor,8)}});
segments.push({kind:'outro',duration:6,text:'What prompt or scenario should we try next? Leave a comment.'});
const plan={version:1,title:'The Agent Terrarium',fps:60,resolution:{width:3840,height:2160},cameras:names.map(id=>({id,file:id+'.mp4',offsetSeconds:offsets[names.indexOf(id)]})),segments};
if(force||!existsSync(join(out,'edit-plan.json')))writeFileSync(join(out,'edit-plan.json'),JSON.stringify(plan,null,2)+'\n');
// Extract every valid, in-range intention independently of preview clip selection.
// IDs match ElevenLabs chapter exports: 1_Chapter_1.wav, 2_Chapter_1.wav, etc.
const voiceLines=[
 {segmentIndex:0,text:introGoal},
 ...(preserveAll?valid:selected.filter(e=>e.kind==='report_intention')).map(e=>({
   segmentIndex:clipSegmentsByEvent.get(e.index)??null,
   eventIndex:e.index,
   at:e.second,
   text:String(e.detail.args.summary).trim()
 })),
 {segmentIndex:segments.length-1,text:'What should we ask the next agent to try? Leave your prompts and scenarios in the comments.'}
];
if(force||!existsSync(join(out,'narration.txt')))writeFileSync(join(out,'narration.txt'),voiceLines.map(line=>preserveAll?line.text.replace(/\s+/g,' ').trim():line.text).join('\n')+'\n');
if(force||!existsSync(join(out,'narration-manifest.json')))writeFileSync(join(out,'narration-manifest.json'),JSON.stringify(voiceLines.map((line,i)=>({
 line:i+1,segmentIndex:line.segmentIndex,eventIndex:'eventIndex' in line?line.eventIndex:null,at:'at' in line?line.at:null,text:line.text,audio:`${i+1}_Chapter_1.wav`
})),null,2)+'\n');
console.log('  Narration lines:           '+voiceLines.length+' ('+(voiceLines.length-2)+' intentions + intro/outro)');
console.log('Prepared',out,'using videos',lengths,'seconds; clips:',segments.length);
console.log('Narration: '+join(out,'narration.txt')+'. Export audio as 1_Chapter_1.wav, 2_Chapter_1.wav, etc.');
