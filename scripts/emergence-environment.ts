/** Trusted Minecraft bridge. Never accepts executable command strings from YAML. */
import {cpSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import nbt from 'prismarine-nbt';
import {acquireLock} from '../src/session/lock.js';
import {verifyLevelDat, verifyProperties, worldSettings} from '../src/environments/minecraft/world-config.js';

const root=resolve(import.meta.dirname,'..');
const [mode, requestFile]=process.argv.slice(2);
if(!['lease','snapshot','restore'].includes(mode)||!requestFile)throw Error('Expected lease|snapshot|restore request.json');
const q=JSON.parse(readFileSync(requestFile,'utf8'));
const world=join(root,'data/minecraft');
function docker(args:string[]){const r=spawnSync('docker',['compose',...args],{cwd:root,env:{...process.env,MC_VERSION:q.version,MC_PORT:String(q.port??25565),...(q.seed?{MC_SEED:q.seed,MC_LEVEL_TYPE:worldSettings(q.preset,q.seed).levelType,MC_DIFFICULTY:worldSettings(q.preset,q.seed).difficulty,GENERATOR_SETTINGS:worldSettings(q.preset,q.seed).generatorSettings}:{})},stdio:'inherit',timeout:360000});if(r.error||r.status!==0)throw Error(`Docker failed: ${r.error??r.status}`);}
async function checkVersion(path:string){const parsed=nbt.simplify((await nbt.parse(readFileSync(path))).parsed) as any;if(parsed.Data?.Version?.Name!==q.version)throw Error(`Minecraft snapshot version ${parsed.Data?.Version?.Name} differs from ${q.version}`);}
function writableTree(path:string){const st=lstatSync(path);chmodSync(path,st.isDirectory()?0o755:0o644);if(st.isDirectory())for(const n of readdirSync(path))writableTree(join(path,n));}
function plainTree(path:string){const st=lstatSync(path);if(st.isSymbolicLink()||(!st.isDirectory()&&!st.isFile()))throw Error('Unsafe world artifact '+path);if(st.isDirectory())for(const n of readdirSync(path))plainTree(join(path,n));}
if(mode==='lease'){
 if(!Number.isSafeInteger(q.pid)||q.pid<=0||!q.token)throw Error('Invalid lease owner');
 process.kill(q.pid,0);
 acquireLock('emergence session orchestration');
 writeFileSync(join(root,'data/active-session.lock/owner.json'),JSON.stringify({pid:q.pid,kind:'emergence session orchestration',token:q.token}));
 // Ownership has been transferred to the supervising Go process.
}else{
 const release=acquireLock('emergence '+mode);
 try{
  if(mode==='snapshot'){
   if(existsSync(q.destination))throw Error('Snapshot already exists');
   docker(['stop','--timeout','30','minecraft']);
   plainTree(world);
   const recorded=JSON.parse(readFileSync(join(world,'world-config.json'),'utf8'));
   if(recorded.seed!==q.seed||recorded.preset!==q.preset)throw Error('Active world differs from episode configuration');
   verifyProperties(readFileSync(join(world,'server.properties'),'utf8'),worldSettings(q.preset,q.seed));
   await verifyLevelDat(join(world,'world/level.dat'),worldSettings(q.preset,q.seed));
   await checkVersion(join(world,'world/level.dat'));
   mkdirSync(q.destination,{recursive:true});
   cpSync(world,join(q.destination,'world'),{recursive:true,errorOnExist:true,force:false});
   // Leave the server stopped: this snapshot is the initial condition, not a live save.
  }else{
   if(!existsSync(join(q.source,'world/world/level.dat')))throw Error('Incomplete frozen world');
   plainTree(join(q.source,'world'));
   await checkVersion(join(q.source,'world/world/level.dat'));
   docker(['stop','--timeout','30','minecraft']);
   const archive=join(root,'data/world-archives',`emergence-${Date.now()}-${process.pid}`);
   mkdirSync(resolve(archive,'..'),{recursive:true});
   if(existsSync(world))renameSync(world,archive);
   cpSync(join(q.source,'world'),world,{recursive:true,errorOnExist:true,force:false});
   writableTree(world);
   docker(['up','-d','--force-recreate','--wait','--wait-timeout','300','minecraft']);
   verifyProperties(readFileSync(join(world,'server.properties'),'utf8'),worldSettings(q.preset,q.seed));
   await verifyLevelDat(join(world,'world/level.dat'),worldSettings(q.preset,q.seed));
   await checkVersion(join(world,'world/level.dat'));
   console.log('Restored frozen world; previous world archived at '+archive);
  }
 }finally{release();}
}
