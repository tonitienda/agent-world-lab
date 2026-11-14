// Resume only from the selected, immutable recorded Claude take.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const flags=process.argv.slice(2), generate=flags.includes('--generate-audio');
const withAudio=generate||flags.includes('--with-audio'), refresh=flags.includes('--refresh-render'), render=flags.includes('--render')||refresh;
if(render&&!withAudio)throw Error('--render requires --with-audio or --generate-audio');
const run=args=>execFileSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,EPISODE_ID:'episode-007'}});
run(['--import','tsx','scripts/openttd-episode.ts']);
if(generate)run(['scripts/elevenlabs-narration.mjs','episode-007']);
if(withAudio){
 run(['--import','tsx','scripts/openttd-episode.ts','--with-audio']);
 run(['production/tools/episode.mjs']);
 if(render){
  run(refresh?['--import','tsx','scripts/openttd-refresh-master.ts']:['production/tools/episode.mjs','--render']);
  run(['production/tools/check-render.mjs']);run(['--import','tsx','scripts/openttd-youtube.ts']);
  const source=JSON.parse(readFileSync(join(root,'production/episode-007/source.json')));
  const session=join(root,source.session),cache=join(session,'first-master');
  if(!existsSync(join(cache,'episode-007.mp4'))){
   mkdirSync(cache,{recursive:true});
   const copy=(from,to)=>copyFileSync(join(root,from),join(cache,to));
   copy('production/output/episode-007.mp4','episode-007.mp4');
   copy('production/public/episode-007/video/directed.mp4','directed.mp4');
   for(const file of ['edit-plan.json','narration-manifest.json','render-validation.json','validation.json','camera-plan.json','production-build.json'])
    copy('production/episode-007/'+file,file);
   const shots=JSON.parse(readFileSync(join(root,'production/episode-007/camera-plan.json'))).shots;
   for(const file of ['00000.png',String(shots.length-1).padStart(5,'0')+'.png'])copyFileSync(join(session,'episode-camera-frames',file),join(cache,file));
   const hash=p=>createHash('sha256').update(readFileSync(join(root,p))).digest('hex');
   writeFileSync(join(cache,'soundtrack.sha256'),hash('production/public/episode-007/generated/soundtrack.wav'));
   const files=['production/episode-007/project.ts','production/episode-007/scene.tsx','production/src/scenes/episode.tsx','production/src/timeline.ts','production/src/render-client.ts'];
   writeFileSync(join(cache,'composition-hashes.json'),JSON.stringify(Object.fromEntries(files.map(p=>[p,hash(p)])),null,2));
  }
 }
}
