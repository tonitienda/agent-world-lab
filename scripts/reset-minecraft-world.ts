import {existsSync, mkdirSync, renameSync, readFileSync, readdirSync} from "node:fs";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {createConnection} from "node:net";

const root=resolve(import.meta.dirname, "..");
const world=join(root,"data","minecraft");
const archives=join(root,"data","world-archives");
const stamp=new Date().toISOString().replace(/[:.]/g,"-");
const archive=join(archives,stamp);
const settings=JSON.stringify({biome:"minecraft:plains",layers:[
  {block:"minecraft:bedrock",height:1},
  {block:"minecraft:stone",height:70},
  {block:"minecraft:dirt",height:2},
  {block:"minecraft:grass_block",height:1}
]});
const yes=process.argv.includes("--yes");
if(!yes) {
  console.log("Dry run: Minecraft world reset");
  console.log("Current Minecraft server data:",world);
  console.log("Backup destination:",archive);
  console.log("The server will be stopped, data archived, and a fresh positive-Y superflat world created.");
  console.log("All data in the server's /data mount (world, server configs, logs) is archived.");
  console.log("Stop Claude/Codex MCP sessions and wait for MP4 files to finalize first.");
  console.log("Run npm run world:reset -- --yes to proceed.");
  process.exit(0);
}

function run(args:string[],env:NodeJS.ProcessEnv=process.env) {
  console.log("$ docker",args.join(" "));
  const result=spawnSync("docker",args,{cwd:root,env,stdio:"inherit"});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`Docker command failed with exit ${result.status}`);
}
async function isPortOpen(port:number):Promise<boolean> {
  return await new Promise(resolve=>{
    const sock=createConnection({host:"127.0.0.1",port});
    sock.setTimeout(600);
    sock.once("connect",()=>{sock.destroy();resolve(true);});
    sock.once("error",()=>resolve(false));
    sock.once("timeout",()=>{sock.destroy();resolve(false);});
  });
}
for(const port of [3007,3008]){
  if(await isPortOpen(port))throw Error(`Recorder viewer port ${port} is active. Finalize the MCP session before resetting the world.`);
}
const envFile=join(root,".env");
const fileAccepted=existsSync(envFile) && /^\\s*EULA\\s*=\\s*["\x27]?TRUE["\x27]?\\s*$/m.test(readFileSync(envFile,"utf8"));
if(process.env.EULA!=="TRUE" && !fileAccepted){
  throw Error("Set EULA=TRUE only after accepting Minecraft EULA. No server or data changed.");
}
// A fresh world from an entirely new /data folder also changes any custom server settings.
run(["compose","down","--timeout","30"]);
mkdirSync(archives,{recursive:true});
let archived=false;
if(existsSync(world)){
  // Atomic move on the same volume; large existing worlds don't need copying.
  renameSync(world,archive);
  archived=true;
  console.log("Archived existing server data:",archive);
}
mkdirSync(world,{recursive:true});
const env={...process.env,MC_LEVEL_TYPE:"minecraft:flat",GENERATOR_SETTINGS:settings};
try {
  run(["compose","up","-d","--wait","minecraft"],env);
  const playerData=join(world,"world","playerdata");
  const savedPlayers=existsSync(playerData)?readdirSync(playerData):[];
  if(savedPlayers.length)throw Error(`Fresh world unexpectedly contains ${savedPlayers.length} saved player files at ${playerData}; investigate before starting a new episode`);
  console.log("Verified: no persisted player inventory files in new world.");
  console.log("Fresh Minecraft server ready. Original data:",archived?archive:"(none)");
} catch(error) {
  console.error("New server failed to start. Archived data remains at:",archived?archive:"(none)");
  console.error("The reset has not deleted the prior world; inspect Docker logs before retrying.");
  throw error;
}
