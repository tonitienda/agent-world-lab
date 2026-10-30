import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,writeFileSync,statSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
export function command(bin,args){
 const r=spawnSync(bin,args,{encoding:'utf8',maxBuffer:16*1024*1024});
 if(r.status!==0)throw Error(`${bin}: ${r.error?.message??r.stderr}`);
 return r.stdout;
}
export function probe(path){
 if(!existsSync(path))throw Error(`Missing asset: ${path}`);
 const p=JSON.parse(command('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',path]));
 const duration=Number(p.format.duration);
 if(!Number.isFinite(duration)||duration<=0)throw Error(`Invalid media duration: ${path}`);
 return {duration,audio:p.streams.some(s=>s.codec_type==='audio')};
}
export function sessionPath(root,episode){
 for(const dir of [join(root,'data',episode),join(root,'data/mcp-sessions',episode)])if(existsSync(join(dir,'events.json')))return dir;
 throw Error(`Missing local events.json for ${episode}`);
}
const safeFile=s=>typeof s==='string'&&s.length>0&&basename(s)===s&&!s.includes('..');
export function outputResolution(plan){
 const resolution=plan.resolution??{width:1920,height:1080};
 const {width,height}=resolution;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<320||height<180||width>3840||height>2160||width%2||height%2||width*9!==height*16)throw Error('Invalid output resolution: use an even 16:9 size up to 3840x2160');
 return resolution;
}
export function validate(plan,manifest,media){
 const fail=m=>{throw Error(m)};
 if(plan.version!==2||!Number.isInteger(plan.fps)||plan.fps<1||plan.fps>60||!plan.segments?.length)fail('Invalid declarative edit plan');
 outputResolution(plan);
 if(!Array.isArray(plan.cameras)||!plan.cameras.length)fail('Missing cameras');
 const cams=new Map(), voices=new Map(manifest.map(v=>[v.line,v]));
 for(const c of plan.cameras){
  if(!c.id||cams.has(c.id)||!safeFile(c.file)||!Number.isFinite(c.offsetSeconds??0))fail('Invalid camera');
  const p=media(`video/${c.file}`);cams.set(c.id,{...c,...p});
 }
 let timeline=0,lastLine=0;const schedule=[];
 for(const [index,s] of plan.segments.entries()){
  if(!['shot','intro','outro'].includes(s.kind)||!Number.isFinite(s.duration)||s.duration<=0||Math.abs(s.duration*plan.fps-Math.round(s.duration*plan.fps))>1e-6)fail(`Invalid segment ${index}`);
  if(s.transition!==undefined&&(!Number.isFinite(s.transition)||s.transition<0||s.transition>s.duration))fail('Invalid transition');
  if(s.background){
   const c=cams.get(s.background.camera),time=s.background.time;
   if(s.kind==='shot'||!c||!Number.isFinite(time)||time+(c.offsetSeconds??0)<0||time+(c.offsetSeconds??0)>=c.duration)fail(`Invalid title background ${index}`);
  }
  if(s.kind==='shot'){
   const q=s.shot, count=q?.kind==='full'?1:2;
   if(!q||!['full','pip','split'].includes(q.kind)||!Number.isFinite(q.start)||q.duration!==s.duration||(q.hold!==undefined&&!(Number.isFinite(q.hold)&&q.hold>=0&&q.hold<=s.duration))||q.cameras.length!==count||new Set(q.cameras).size!==count)fail(`Invalid shot ${index}`);
   for(const id of q.cameras){
    const c=cams.get(id);if(!c)fail(`Unknown camera ${id}`);
    const start=q.start+(c.offsetSeconds??0);
    if(start<0||start+s.duration-(q.hold??0)>c.duration+0.001)fail(`Source bounds: segment ${index}, ${id}`);
   }
  }
  let voiceEnd=0;
  for(const v of s.narration??[]){
   const m=voices.get(v.line);
   if(!m||m.audio!==v.audio||!safeFile(v.audio)||v.audio!==`${v.line}_Chapter_1.wav`)fail('Narration filename mapping mismatch');
   if(v.line<=lastLine)fail('Narration meaning reordered or repeated');lastLine=v.line;
   const p=media(`audio/${v.audio}`);
   if(!p.audio||!Number.isFinite(v.at)||v.at<0.25||v.at<voiceEnd+0.25)fail('Narration overlap or missing breathing room');
   voiceEnd=v.at+p.duration;
   if(voiceEnd+0.3>s.duration+0.001)fail(`Narration exceeds segment ${index}`);
   schedule.push({...v,start:timeline+v.at,duration:p.duration});
  }
  timeline+=s.duration;
 }
 return {duration:Number(timeline.toFixed(6)),schedule,cameras:[...cams.values()]};
}
export function prepare(production,episode){
 if(!/^episode-[a-zA-Z0-9-]+$/.test(episode))throw Error('Invalid episode ID');
 const folder=join(production,episode),pub=join(production,'public',episode);
 const plan=JSON.parse(readFileSync(join(folder,'edit-plan.json'))),manifest=JSON.parse(readFileSync(join(folder,'narration-manifest.json')));
 const cache=new Map();const media=rel=>{if(!cache.has(rel))cache.set(rel,probe(join(pub,rel)));return cache.get(rel)};
 const result=validate(plan,manifest,media);
 const out=join(pub,'generated');mkdirSync(out,{recursive:true});
 const fingerprint=createHash('sha256').update(JSON.stringify({plan,manifest,version:1,assets:[...cache.keys()].map(rel=>{const s=statSync(join(pub,rel));return [rel,s.size,s.mtimeMs]})})).digest('hex');
 const stamp=join(out,'soundtrack.sha256');
 writeFileSync(join(folder,'validation.json'),JSON.stringify({...result,sourceAudio:result.cameras.map(c=>({id:c.id,audio:c.audio}))},null,2)+'\n');
 if(existsSync(stamp)&&readFileSync(stamp,'utf8')===fingerprint&&existsSync(join(out,'soundtrack.wav')))return {plan,...result,soundtrack:join(out,'soundtrack.wav')};
 const args=['-hide_banner','-loglevel','error','-y'];const filters=[],mix=[];
 // Only the primary recording contributes game sound, so simultaneous views never double it.
 let index=0,time=0;
 for(const s of plan.segments){
  if(s.kind==='shot'){
   const c=result.cameras.find(c=>c.id===s.shot.cameras[0]);
   // A held frame is silent: game sound resumes only with the picture.
   const hold=s.shot.hold??0;
   if(c.audio&&s.duration-hold>0){
    args.push('-ss',String(s.shot.start+(c.offsetSeconds??0)),'-t',String(s.duration-hold),'-i',join(pub,'video',c.file));
    const tag=`g${index}`;filters.push(`[${index++}:a]aresample=48000,asetpts=PTS-STARTPTS,volume=0.15,adelay=${Math.round((time+hold)*1000)}:all=1[${tag}]`);mix.push(`[${tag}]`);
   }
  }
  time+=s.duration;
 }
 for(const v of result.schedule){
  args.push('-i',join(pub,'audio',v.audio));
  const tag=`n${index}`;
  filters.push(`[${index++}:a]aresample=48000,asetpts=PTS-STARTPTS,loudnorm=I=-18:TP=-2:LRA=7,adelay=${Math.round(v.start*1000)}:all=1[${tag}]`);mix.push(`[${tag}]`);
 }
 if(!mix.length)throw Error('Episode has no audio');
 filters.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95:latency=1,apad,atrim=duration=${result.duration}[out]`);
 command('ffmpeg',[...args,'-filter_complex',filters.join(';'),'-map','[out]','-ar','48000','-ac','2','-c:a','pcm_s16le',join(out,'soundtrack.wav')]);
 writeFileSync(stamp,fingerprint);
 return {plan,...result,soundtrack:join(out,'soundtrack.wav')};
}
