import assert from 'node:assert/strict';
import {connect,close,command,fill,wait,delay} from './common.mjs';
const bot=await connect();
try{
 await command('gamemode spectator emergence-player');
 await command('tp emergence-player 0.5 110 0.5');
 await wait(()=>assert.equal(bot.game.gameMode,'spectator'));
 for(const rule of ['doDaylightCycle false','doWeatherCycle false','doMobSpawning false','keepInventory false','spawnRadius 0'])await command('gamerule '+rule);
 await command('time set day');await command('weather clear');
 await fill(-20,80,-20,60,105,20,'air');
 await fill(-20,77,-20,60,77,20,'stone');
 await fill(-20,78,-20,60,79,20,'water');
 await fill(-5,78,-5,5,78,5,'dirt');await fill(-5,79,-5,5,79,5,'grass_block');
 await fill(35,78,-8,50,78,8,'dirt');await fill(35,79,-8,50,79,8,'grass_block');
 await command('setblock 40 79 0 gold_block');
 await fill(-4,83,-4,-2,84,-2,'oak_leaves[persistent=true]');
 await fill(-3,80,-3,-3,83,-3,'oak_log');
 await command('setblock -3 80 3 barrel');
 await command('item replace block -3 80 3 container.0 with minecraft:apple 4');
 await command('setworldspawn 0 80 0');await command('spawnpoint emergence-player 0 80 0');
 await command('clear emergence-player');await command('gamemode survival emergence-player');
 await command('tp emergence-player 0.5 80 0.5 -90 0');
 await command('effect give emergence-player minecraft:instant_health 1 10 true');
 await command('effect give emergence-player minecraft:saturation 1 10 true');
 await wait(()=>{assert.ok(bot.entity.position.distanceTo({x:.5,y:80,z:.5})<.3);assert.equal(bot.game.gameMode,'survival');assert.equal(bot.health,20);assert.equal(bot.food,20);assert.equal(bot.inventory.items().length,0);});
 await delay(1500);await command('effect clear emergence-player');
 console.log('Constructed island, water, resources, mainland, marker and initial player state.');
}finally{await close(bot);}
