import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {withDeadline,waitForSpawn,closeScenarioBot} from './lifecycle.mjs';
const require=createRequire(process.env.EMERGENCE_REPO+'/package.json');
const mineflayer=require('mineflayer');
const run=promisify(execFile);
const username=process.env.AGENT_ID??'emergence-player';
if(!/^[A-Za-z0-9_-]{1,16}$/.test(username)) throw Error('Invalid player name');
const bot=mineflayer.createBot({host:'127.0.0.1',port:Number(process.env.MC_PORT??25565),username,version:'1.21.4',viewDistance:'normal'});
bot.on('error',error=>console.error('Scenario connection:',error.message));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function command(s){await run('docker',['compose','exec','-T','--user','1000','minecraft','mc-send-to-console',s],{cwd:process.env.EMERGENCE_REPO,timeout:30000,maxBuffer:1048576});}
let serial=0;
async function acknowledged(s){const token='designer_ack_'+(++serial);let listener,timer;const received=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Console acknowledgement timeout')),20000);listener=m=>{if(m.includes(token))resolve();};bot.on('messagestr',listener);});received.catch(()=>{});try{await command(s);await command('tellraw '+username+' '+JSON.stringify({text:token}));await received;}finally{clearTimeout(timer);bot.removeListener('messagestr',listener);}}
async function fill(x1,y1,z1,x2,y2,z2,block){for(let x=x1;x<=x2;x+=16)for(let z=z1;z<=z2;z+=16)for(let y=y1;y<=y2;y+=128)await command(`fill ${x} ${y} ${z} ${Math.min(x+15,x2)} ${Math.min(y+127,y2)} ${Math.min(z+15,z2)} ${block}`);}
try{
 await waitForSpawn(bot);
 await acknowledged(`gamemode spectator ${username}`);
 await acknowledged(`tp ${username} 2.5 135 0.5 -90 15`);
 for(const rule of ['doDaylightCycle false','doWeatherCycle false','doMobSpawning false','doPatrolSpawning false','doTraderSpawning false','doFireTick false','randomTickSpeed 0','keepInventory false','spawnRadius 0'])await command('gamerule '+rule);
 await command('difficulty peaceful');await command('time set noon');await command('weather clear');
 // Match the construction corridor only; leave entities elsewhere untouched.
 await command('kill @e[type=!minecraft:player,x=-48,y=71,z=-192,dx=96,dy=248,dz=384]');
 // Clear a long viewing corridor, including all potential overhead trees.
 await fill(-48,72,-192,48,319,192,'minecraft:air');
 await fill(-48,71,-192,48,71,192,'minecraft:stone');
 await fill(-48,72,-192,3,95,192,'minecraft:stone');
 await fill(14,72,-192,48,95,192,'minecraft:stone');
 // Ten-block ravine: x=4..13. Roughen its lower walls without creating ledges near the rim.
 for(let z=-180;z<=180;z+=12){await command(`fill 4 72 ${z} 4 78 ${z+4} minecraft:andesite`);await command(`fill 13 72 ${z+5} 13 81 ${z+8} minecraft:andesite`);}
 // A rooted, sheer-sided mesa, six blocks above the starting floor.
 await fill(-10,96,-8,-2,99,9,'minecraft:stone');
 await fill(-9,100,-7,-2,100,8,'minecraft:dirt');
 await fill(-9,101,-7,-2,101,8,'minecraft:grass_block');
 await command('fill -10 100 -6 -10 101 6 minecraft:stone');
 await command('fill -8 96 -9 -4 98 -9 minecraft:andesite');
 // Three deterministic oak trees. Persistent leaves prevent decay between attempts.
 for(const [x,z,h] of [[-4,-4,5],[-6,5,5],[-7,0,6]]){
  await command(`fill ${x-2} ${102+h-2} ${z-2} ${x+2} ${102+h-1} ${z+2} minecraft:oak_leaves[persistent=true]`);
  await command(`fill ${x-1} ${102+h} ${z-1} ${x+1} ${102+h} ${z+1} minecraft:oak_leaves[persistent=true]`);
  await command(`fill ${x} 102 ${z} ${x} ${101+h} ${z} minecraft:oak_log[axis=y]`);
 }
 // Six hand-mineable building blocks; the remaining low terrain is solid stone.
 await command('fill -1 95 -2 0 95 0 minecraft:dirt');
 await command('fill 14 95 -1 17 95 1 minecraft:gold_block');
 await command('fill 18 96 0 18 102 0 minecraft:emerald_block');
 await command('setblock 18 103 0 minecraft:sea_lantern');
 await command(`spawnpoint ${username} 2 96 0 -90`);
 await command('setworldspawn 2 96 0 -90');
 await command(`clear ${username}`);
 await command(`effect clear ${username}`);
 await command(`experience set ${username} 0 levels`);await command(`experience set ${username} 0 points`);
 await command(`effect give ${username} minecraft:instant_health 1 10 true`);
 await command(`effect give ${username} minecraft:saturation 1 10 true`);
 await delay(1500);await command(`effect clear ${username}`);
 await acknowledged(`tp ${username} 2.5 96 0.5 -90 10`);
 await acknowledged(`gamemode survival ${username}`);
 await withDeadline(bot.waitForChunksToLoad(),30000,'Chunk loading timeout');await delay(1000);
 if(bot.entity.position.distanceTo(new (require('vec3').Vec3)(2.5,96,0.5))>0.2)throw Error('Final teleport not acknowledged by player position');
 await acknowledged('save-all flush');
}finally{await closeScenarioBot(bot);}
