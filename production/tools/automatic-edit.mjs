/** Renderable draft. Whole voices and chronological source coverage; when speech
 * outruns the recorded action, the shot holds a real frame before resuming rather
 * than replaying footage or covering the world with a card. Human preview approval
 * remains required. */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {probe,validate} from './pipeline.mjs';
import {summarizeGoal} from './intro.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round=(seconds,fps)=>Math.ceil((seconds-1e-8)*fps)/fps;
const lead=planning=>planning?2:0;
// POV for close interaction, follow for movement and construction, observer for geography.
const ROLE={mine:'agent-pov',craft:'agent-pov',inventory:'agent-pov',place:'follow',move_to:'follow',survey:'observer',observe:'observer'};
export function preferredCamera(action,available){
 const wanted=ROLE[action]??'follow';
 return available.includes(wanted)?wanted:available.includes('follow')?'follow':available[0];
}
/** Picks one voice segment's layout from the event log.
 * preferred: camera for `action` (see ROLE); previous: prior shot's cameras, undefined after a title card;
 * previousAction: prior line's planned action; beat: every completed action in this line's window,
 * e.g. ['move_to','mine']; held: seconds this shot freezes before resuming; payoff: the last line before the outro. */
export function chooseShot({action,preferred,previous,previousAction,beat,held,payoff,available}){
 const has=id=>available.includes(id),wide=has('observer')&&preferred!=='observer';
 const full=id=>({kind:'full',cameras:[id]}),pip=(main,inset)=>({kind:'pip',cameras:[main,inset]});
 // The goal moment: geography and the character side by side.
 if(payoff&&wide&&has('follow'))return {kind:'split',cameras:['observer','follow']};
 // After a title card, establish where we are before going close.
 if(!previous&&wide)return full('observer');
 // Construction reads best wide, with the hands inset; mixed beats need both views.
 if(wide&&(action==='place'&&previousAction!=='place'||new Set(beat).size>1))
  return pip(action==='place'?'observer':'follow',preferred==='follow'?'agent-pov':preferred);
 // A long freeze on the same angle looks stuck: cut to a different view of the same moment.
 if(held>1&&previous?.length===1&&previous[0]===preferred)
  return wide?pip('observer',preferred):full(available.find(id=>id!==preferred)??preferred);
 return full(preferred);
}
export function draftEdit({draft,manifest,events,metadata,audio,video,title}){
 const fps=60,resolution={width:3840,height:2160},cameras=draft.cameras,available=cameras.map(c=>c.id);
 if(!cameras?.length||!manifest.length)throw Error('Missing camera or narration manifest');
 const opened=cameras.map(c=>metadata.cameraTimings?.find(t=>t.name===c.id)).filter(Boolean);
 const origin=opened.length===cameras.length?Math.min(...opened.map(t=>Date.parse(t.captureOpenedAt))):Date.parse(metadata.startedAt??'');
 const ready=opened.length===cameras.length?Math.max(...opened.map(t=>Date.parse(t.readyAt))):origin;
 const floor=Math.max(0,Number.isFinite(ready)&&Number.isFinite(origin)?(ready-origin)/1000:0,...cameras.map(c=>-(c.offsetSeconds??0)));
 const end=Math.min(...cameras.map(c=>video(c.file).duration-(c.offsetSeconds??0)));
 if(!(end>floor))throw Error('No common camera coverage');
 const planningOf=line=>typeof events[line?.eventIndex]?.details?.args?.action==='string';
 const cueStart=line=>line.at-.35-lead(planningOf(line));
 const warnings=[],segments=[];let cursor=floor,previous,previousAction;
 for(const [i,line] of manifest.entries()){
  const measured=audio(line.audio);if(!measured.audio)throw Error(`No audio stream in ${line.audio}`);
  const voice=round(.35+measured.duration+.3,fps);
  const segment={id:`voice-${line.line}`,kind:i===0?'intro':i===manifest.length-1?'outro':'intro',duration:voice,text:i===0?summarizeGoal(line.text):line.text,narration:[{line:line.line,audio:line.audio,at:.35}]};
  if(i===0)segment.background={camera:available.includes('observer')?'observer':available[0],time:floor+Math.min(.25,(end-floor)/2)};
  if(i>0&&i<manifest.length-1){
   const event=events[line.eventIndex],action=event?.details?.args?.action,planning=typeof action==='string';
   const timed=Number.isFinite(line.at);
   // Never before the cameras are ready, never replaying, never past the shared end.
   const start=Math.min(Math.max(cursor,floor,timed?cueStart(line):cursor),end-.1);
   const after=events.slice(line.eventIndex+1),nextIntention=after.findIndex(e=>e.action==='report_intention');
   const attempt=nextIntention<0?after:after.slice(0,nextIntention);
   const completion=planning?attempt.find(e=>e.action===action||e.action===action+'_error'):undefined;
   const completionAt=completion&&Number.isFinite(origin)?(Date.parse(completion.at)-origin)/1000:NaN;
   // Source this voice must show (its action through completion) and may show (up to the
   // point where the next timed plan needs its own lead).
   const need=Number.isFinite(completionAt)&&completionAt>=start?completionAt-start+.3:timed?Math.max(0,line.at-start+1):0;
   const next=manifest.slice(i+1,-1).find(l=>Number.isFinite(l.at));
   const allowed=next?Math.max(need,cueStart(next)-start):Infinity;
   const duration=round(Math.max(voice,need),fps);
   const played=Math.min(duration,allowed,end-start);
   const hold=round(duration-played,fps);
   const beat=attempt.filter(e=>!e.action.endsWith('_start')&&e.action!=='report_intention').map(e=>e.action);
   const {kind,cameras:chosen}=chooseShot({action,preferred:preferredCamera(action,available),previous,previousAction,beat,held:hold,payoff:i===manifest.length-2,available});
   segment.kind='shot';segment.duration=duration;delete segment.text;
   segment.shot={kind,cameras:chosen,start,duration,...(hold>0?{hold}:{}),label:''};
   cursor=start+duration-hold;previous=chosen;previousAction=action;
   if(!timed)warnings.push(`Line ${line.line}: untimed utterance holds the nearest context frame.`);
   else if(start>line.at+.01)warnings.push(`Line ${line.line}: earlier speech used this action's footage; this line follows its action by ${(start-line.at).toFixed(1)}s.`);
   else if(planning&&line.at-start-.35<1.5)warnings.push(`Line ${line.line}: limited anticipation footage; check whether speech precedes the action.`);
   if(start>=end-.1)warnings.push(`Line ${line.line}: coverage exhausted; holds the final recorded frame.`);
  }else previous=previousAction=undefined;
  segments.push(segment);
 }
 const plan={version:2,title,fps,resolution,cameras,segments};
 validate(plan,manifest,relative=>relative.startsWith('audio/')?audio(relative.slice(6)):video(relative.slice(6)));
 return {plan,warnings};
}
export function automaticEdit(production,episode){
 if(!/^episode-[a-zA-Z0-9-]+$/.test(episode))throw Error('Invalid episode ID');
 const folder=join(production,episode),pub=join(production,'public',episode);
 const source=JSON.parse(readFileSync(join(folder,'source.json'),'utf8'));
 const run=JSON.parse(readFileSync(source.run,'utf8'));
 const manifest=JSON.parse(readFileSync(join(folder,'narration-manifest.json'),'utf8'));
 const events=JSON.parse(readFileSync(source.events,'utf8')),metadata=JSON.parse(readFileSync(source.metadata,'utf8'));
 const planPath=join(folder,'edit-plan.json'),current=JSON.parse(readFileSync(planPath,'utf8'));
 const stampPath=join(folder,'automatic-edit.json'),stamp=existsSync(stampPath)?JSON.parse(readFileSync(stampPath,'utf8')):undefined;
 if(current.version===2&&(!stamp||stamp.planHash!==hash(current))){console.log('Keeping your existing v2 editorial plan.');return;}
 const audioCache=new Map(),videoCache=new Map();
 const audio=name=>{if(!audioCache.has(name))audioCache.set(name,probe(join(pub,'audio',name)));return audioCache.get(name)},video=name=>{if(!videoCache.has(name))videoCache.set(name,probe(join(pub,'video',name)));return videoCache.get(name)};
 const draftPath=join(folder,'edit-plan.v1.json');
 if(current.version===1&&!existsSync(draftPath))writeFileSync(draftPath,JSON.stringify(current,null,2)+'\n',{flag:'wx'});
 const draft=current.version===1?current:JSON.parse(readFileSync(draftPath,'utf8'));
 const title=process.env.EMERGENCE_EPISODE_TITLE??run.goal_prompt??manifest[0].text;
 const {plan,warnings}=draftEdit({draft,manifest,events,metadata,audio,video,title});
 const text=JSON.stringify(plan,null,2)+'\n';writeFileSync(planPath+'.draft',text);renameSync(planPath+'.draft',planPath);
 writeFileSync(stampPath,JSON.stringify({version:1,planHash:hash(plan),warnings},null,2)+'\n');
 writeFileSync(join(folder,'automatic-edit-report.md'),`# Automatic draft — review required\n\nAll ${manifest.length} original voice clips are kept whole and in manifest order.\nSource intervals are chronological and do not replay previously selected footage.\nWhere speech outruns the action, a shot holds a real frame (\`hold\`) before resuming.\nThis is a draft; watch the preview before approving the final render.\n\n${warnings.length?warnings.map(w=>'- '+w).join('\n'):'No coverage or short-lead warnings.'}\n`);
 console.log(`Prepared v2 draft: ${plan.segments.reduce((n,s)=>n+s.duration,0).toFixed(2)}s; ${warnings.length} review warning(s).`);
 for(const warning of warnings)console.log('REVIEW:',warning);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))automaticEdit(fileURLToPath(new URL('..',import.meta.url)),process.env.EPISODE_ID??'episode-001');
