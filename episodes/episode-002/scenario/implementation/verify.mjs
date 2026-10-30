import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {withDeadline,waitForSpawn,closeScenarioBot} from './lifecycle.mjs';
const require=createRequire(process.env.EMERGENCE_REPO+'/package.json');
const mineflayer=require('mineflayer');const {Vec3}=require('vec3');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const manifest=JSON.parse(await readFile(process.env.EMERGENCE_SCENARIO_DIR+'/manifest.json','utf8'));
const bot=mineflayer.createBot({host:'127.0.0.1',port:Number(process.env.MC_PORT??25565),username:process.env.AGENT_ID??'emergence-player',version:'1.21.4',viewDistance:'normal'});
bot.on('error',error=>console.error('Scenario connection:',error.message));
const evidence=[];const result={spawn:false,target:false,resources:false,capabilities:false,recorder:false,reachability:'manual review required',evidence};
function assert(ok,message){if(!ok)throw Error(message);}
function block(x,y,z,name){const b=bot.blockAt(new Vec3(x,y,z));assert(b&&b.name===name,`Expected ${name} at ${x},${y},${z}; got ${b?.name??'unloaded'}`);return b;}
try{
 await waitForSpawn(bot);await withDeadline(bot.waitForChunksToLoad(),30000,'Chunk loading timeout');await delay(1500);
 assert(bot.entity.position.distanceTo(new Vec3(2.5,96,0.5))<0.2,'Incorrect persisted spawn');
 assert(Math.abs(bot.entity.yaw-Math.PI*1.5)<0.12,'Player is not facing east');
 assert(bot.game.gameMode==='survival','Player must be in survival');assert(bot.health===20&&bot.food===20,'Health or food not full');assert(bot.inventory.items().length===0,'Inventory not empty');
 block(2,95,0,'stone');assert(manifest.spawn.x===2.5&&manifest.spawn.y===96&&manifest.spawn.z===0.5,'Manifest spawn mismatch');result.spawn=true;evidence.push('Persisted player position, east-facing yaw, survival mode, full health/food, empty inventory and supporting stone checked.');
 const t=manifest.targets['gold-landing-pad'];assert(t&&t.x===15.5&&t.y===96&&t.z===0.5,'Manifest destination mismatch');
 for(let x=14;x<=17;x++)for(let z=-1;z<=1;z++)block(x,95,z,'gold_block');
 for(let y=96;y<=102;y++)block(18,y,0,'emerald_block');block(18,103,0,'sea_lantern');
 for(let x=14;x<=17;x++)for(let z=-1;z<=1;z++)for(let y=96;y<=98;y++)block(x,y,z,'air');result.target=true;evidence.push('Exact gold-landing-pad identifier matches the built landing surface and clear standing volume; emerald beacon checked.');
 for(let x=-1;x<=0;x++)for(let z=-2;z<=0;z++)block(x,95,z,'dirt');
 let logs=0;for(const [x,z,h] of [[-4,-4,5],[-6,5,5],[-7,0,6]]){block(x,101,z,'grass_block');for(let y=102;y<102+h;y++){block(x,y,z,'oak_log');logs++;}}
 for(let y=96;y<=99;y++)block(-2,y,0,'stone');block(-2,100,0,'dirt');block(-2,101,0,'grass_block');
 for(let x=4;x<=13;x++)for(let z=-16;z<=16;z++){block(x,71,z,'stone');for(let y=82;y<=106;y++)block(x,y,z,'air');}
 for(let x=-12;x<=2;x++)for(let z=-10;z<=10;z++)if(!(x>=-1&&x<=0&&z>=-2&&z<=0))block(x,95,z,'stone');
 result.resources=true;evidence.push(`Six accessible dirt blocks, ${logs} elevated oak logs, six-block mesa height, stone starting floor, ten-block ravine width, clear central crossing and bottom 24 blocks below bank surface checked.`);
 const expected=['observe','move_to','mine','place'];assert(JSON.stringify(manifest.required_capabilities)===JSON.stringify(expected),'Capability declaration mismatch');
 for(const method of ['blockAt','lookAt','setControlState','dig','placeBlock'])assert(typeof bot[method]==='function','Missing Mineflayer primitive '+method);
 assert(bot.canDigBlock(bot.blockAt(new Vec3(0,95,0))),'Initial dirt cannot be mined');result.capabilities=true;evidence.push('Required capability declarations and underlying observation, movement, mining and placement primitives checked; initial dirt is in mining reach. Agent wrapper integration remains covered by repository preflight.');
 assert(bot.version==='1.21.4','Version mismatch');for(const [x,y,z] of [[2,100,0],[8,105,0],[15,100,0]])block(x,y,z,'air');
 assert(bot.entity&&bot.game.dimension==='overworld','Missing observable overworld player');result.recorder=true;evidence.push('Minecraft 1.21.4 protocol, visible player entity, loaded overworld scene and open camera positions checked. Actual recorder connection, spectator permissions and capture are repository-preflight/manual checks.');
}catch(error){result.error=String(error.stack??error);process.exitCode=1;}finally{await closeScenarioBot(bot);if(!process.env.EMERGENCE_VALIDATION_REPORT)throw Error('EMERGENCE_VALIDATION_REPORT required');await writeFile(process.env.EMERGENCE_VALIDATION_REPORT,JSON.stringify(result,null,2)+'\n');}
