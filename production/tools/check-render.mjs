import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {command,probe} from './pipeline.mjs';
const production=fileURLToPath(new URL('..',import.meta.url)),episode=process.env.EPISODE_ID??'episode-001';
if(!/^episode-[a-zA-Z0-9-]+$/.test(episode))throw Error('Invalid episode ID');
const output=join(production,'output',episode+'.mp4');
const plan=JSON.parse(readFileSync(join(production,episode,'edit-plan.json')));
const validation=JSON.parse(readFileSync(join(production,episode,'validation.json')));
const streams=JSON.parse(command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]));
const video=streams.streams.find(s=>s.codec_type==='video'),audio=streams.streams.find(s=>s.codec_type==='audio');
if(!video||!audio||video.width!==1920||video.height!==1080||video.avg_frame_rate!==`${plan.fps}/1`||Math.abs(Number(streams.format.duration)-validation.duration)>.08)throw Error('Final stream format or duration mismatch');
if(Number(video.nb_frames)!==Math.round(validation.duration*plan.fps))throw Error('Wrong video frame count');
const decode=spawnSync('ffmpeg',['-hide_banner','-i',output,'-vf','blackdetect=d=0.04:pix_th=0.04:pic_th=0.98','-af','silencedetect=noise=-45dB:d=0.25','-f','null','-'],{encoding:'utf8',maxBuffer:8*1024*1024});
if(decode.status!==0||/Error while decoding|Invalid data found/.test(decode.stderr))throw Error('Final media decode failed');
const black=[...decode.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m=>({start:+m[1],end:+m[2]}));
if(black.length)throw Error('Black frames: '+JSON.stringify(black));
const speech=[];
for(const voice of validation.schedule){
 const r=spawnSync('ffmpeg',['-hide_banner','-ss',String(voice.start),'-t',String(voice.duration),'-i',output,'-vn','-af','volumedetect','-f','null','-'],{encoding:'utf8'});
 const level=Number(r.stderr.match(/mean_volume: ([-\d.]+) dB/)?.[1]);
 if(r.status!==0||!Number.isFinite(level)||level< -42)throw Error(`Silent or invalid narration ${voice.line}`);
 speech.push({line:voice.line,meanDb:level});
}
const result={file:output,duration:Number(streams.format.duration),frames:Number(video.nb_frames),width:video.width,height:video.height,fps:plan.fps,audio:audio.codec_name,blackIntervals:black,decoded:true,narrationWindows:speech};
writeFileSync(join(production,episode,'render-validation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
