// Complete/resume episode 007. A finished take is immutable and is never replayed.
import {existsSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=JSON.parse(readFileSync(join(root,'production/episode-007/source.json')));
const session=join(root,source.session);
const run=args=>execFileSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,EPISODE_ID:'episode-007'}});
if(!existsSync(join(session,'result.json'))){
 if(existsSync(session))throw Error('The selected take is unfinished or still running. Preserve it; do not automatically replay. Inspect its logs or explicitly select a new take in source.json.');
 run(['--import','tsx','scripts/openttd-session.ts','--out',session]);
}
const result=JSON.parse(readFileSync(join(session,'result.json')));
if(result.actor!=='claude')throw Error('Selected take was not played by Claude');
run(['production/episode-007/prepare.mjs','--generate-audio','--render']);
