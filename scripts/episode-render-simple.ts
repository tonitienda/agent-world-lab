import {mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";

type Camera={id:string;file:string;offsetSeconds?:number};
type Segment={kind:"intro"|"outro"|"shot";duration:number;text?:string;shot?:{kind:string;cameras:string[];start:number;label?:string}};
type Plan={cameras:Camera[];segments:Segment[]};
const production=resolve("production");
const episode=process.env.EPISODE_ID??"episode-001";
if(!/^episode-[a-zA-Z0-9-]+$/.test(episode))throw Error("Invalid EPISODE_ID");
const generated=join(production,episode);
const plan=JSON.parse(readFileSync(join(generated,"edit-plan.json"),"utf8")) as Plan;
const media=join(production,"public",episode,"video");
const output=resolve(process.argv[2]??join(production,"output","episode-001.mp4"));
const musicPath=process.env.EPISODE_MUSIC ? resolve(process.env.EPISODE_MUSIC) : undefined;
const narrationDir=join(production,"public",episode,"audio");
const narrationManifest=join(generated,"narration-manifest.json");
const lines=existsSync(narrationManifest)?JSON.parse(readFileSync(narrationManifest,"utf8")) as Array<{line:number;segmentIndex:number;audio:string}>:[];
const temp=mkdtempSync(join(tmpdir(),"emergent-render-"));
mkdirSync(resolve(output,".."),{recursive:true});
function ffmpeg(args:string[]){
 const cmd=spawnSync("ffmpeg",["-hide_banner","-loglevel","error","-y",...args],{encoding:"utf8"});
 if(cmd.status!==0)throw Error("ffmpeg failed: "+(cmd.stderr||cmd.error?.message||cmd.status));
}
function probe(file:string){
 const r=spawnSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",file],{encoding:"utf8"});
 const d=Number(r.stdout?.trim());
 if(r.status!==0||!Number.isFinite(d))throw Error("Invalid media: "+file);
 return d;
}
const quote=(s:string)=>s.replaceAll("'","'\\''");
const seconds=(n:number)=>n.toFixed(3);
let time=0;
const audio:Array<{path:string;start:number}>=[];
const segments:string[]=[];
try{
 if(!plan.segments.length)throw Error("Empty edit plan");
 for(let index=0;index<plan.segments.length;index++){
  const seg=plan.segments[index];
  if(!Number.isFinite(seg.duration)||seg.duration<=0)throw Error("Invalid segment duration "+index);
  const path=join(temp,String(index).padStart(3,"0")+".mp4");
  const common=["-an","-r","30","-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart",path];
  if(seg.kind==="shot"){
   const id=seg.shot?.cameras[0];
   const camera=plan.cameras.find(c=>c.id===id);
   if(!camera)throw Error("Missing primary camera for shot "+index);
   const input=join(media,camera.file);
   const from=(seg.shot?.start??0)+(camera.offsetSeconds??0);
   const length=probe(input);
   if(from<0||from+seg.duration>length+0.15)throw Error(`Shot ${index} exceeds source ${camera.file}: ${seconds(from)} + ${seconds(seg.duration)} > ${seconds(length)}`);
   if(seg.shot?.kind!=="full")console.warn(`Shot ${index}: using only primary camera ${id} in simple render (multi-view remains in Motion Canvas editor)`);
   ffmpeg(["-ss",seconds(from),"-i",input,"-t",seconds(seg.duration),"-vf","scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",...common]);
  }else{
   const card=join(temp,`card-${index}.txt`);
   writeFileSync(card,seg.kind==="intro"?"EMERGENT\n\n"+(seg.text??""):seg.text??"WHAT SHOULD WE TRY NEXT?");
   ffmpeg(["-f","lavfi","-i","color=c=0x10212b:s=1920x1080:r=30","-t",seconds(seg.duration),"-vf",`drawtext=textfile='${card.replaceAll("'","\\'")}':fontcolor=white:fontsize=54:line_spacing=18:x=(w-text_w)/2:y=(h-text_h)/2`,...common]);
  }
  segments.push(path);
  for(const narration of lines.filter(line=>line.segmentIndex===index)){
   const preferred=join(narrationDir,narration.audio);
   const elevenLabs=join(narrationDir,`${narration.line}_Chapter_1.wav`);
   const voice=existsSync(preferred)?preferred:elevenLabs;
   if(existsSync(voice)){
    const length=probe(voice);
    if(length>seg.duration-0.6)console.warn(`Narration ${narration.audio} is longer than segment ${index}; review overlap/timing`);
    audio.push({path:voice,start:time+0.3});
   }else console.warn("No voice clip (silent segment):",narration.audio);
  }
  time+=seg.duration;
 }
 const concat=join(temp,"concat.txt");
 writeFileSync(concat,segments.map(file=>"file '"+quote(file)+"'").join("\n")+"\n");
 const silent=join(temp,"silent.mp4");
 ffmpeg(["-f","concat","-safe","0","-i",concat,"-c","copy",silent]);
 if(!musicPath&&!audio.length){
  ffmpeg(["-i",silent,"-c","copy",output]);
 }else{
  const args=["-i",silent];
  const streams:string[]=[];
  if(musicPath){
   if(!existsSync(musicPath))throw Error("Missing music: "+musicPath);
   args.push("-stream_loop","-1","-i",musicPath);
   streams.push("[1:a]volume=0.12[music]");
  }
  let index=musicPath?2:1;
  for(const voice of audio){
   args.push("-i",voice.path);
   const ms=Math.round(voice.start*1000);
   streams.push(`[${index}:a]adelay=${ms}:all=1,volume=1[n${index}]`);
   index++;
  }
  const outputs=[...(musicPath?["[music]"]:[]),...audio.map((_,i)=>`[n${i+(musicPath?2:1)}]`)];
  const mix=outputs.length===1?`${outputs[0]}anull[aout]`:`${outputs.join("")}amix=inputs=${outputs.length}:normalize=0:dropout_transition=0[aout]`;
  ffmpeg([...args,"-filter_complex",streams.join(";")+";"+mix,"-map","0:v:0","-map","[aout]","-c:v","copy","-c:a","aac","-b:a","192k","-t",seconds(time),output]);
 }
 console.log("Rendered:",output);
 console.log("Length:",seconds(time),"seconds; narration clips:",audio.length,"music:",musicPath?"yes":"no");
 console.log("Validate and watch before uploading. Multi-camera layouts, transitions, and ducking remain for Motion Canvas production.");
}finally{
 rmSync(temp,{recursive:true,force:true});
}
