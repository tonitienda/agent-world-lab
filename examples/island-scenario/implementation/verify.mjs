import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connect,close,wait,Vec3,capabilities,recorderPrerequisites} from './common.mjs';
const bot=await connect();
try{
 await wait(()=>{
  assert.ok(bot.entity.position.distanceTo(new Vec3(.5,80,.5))<.5);
  assert.equal(bot.health,20);assert.equal(bot.food,20);assert.equal(bot.game.gameMode,'survival');assert.equal(bot.inventory.items().length,0);
  for(const [x,y,z,name] of [[0,79,0,'grass_block'],[15,79,0,'water'],[40,79,0,'gold_block'],[-3,80,-3,'oak_log'],[-3,80,3,'barrel']])assert.equal(bot.blockAt(new Vec3(x,y,z))?.name,name);
 });
 const barrel=await bot.openContainer(bot.blockAt(new Vec3(-3,80,3)));
 try{assert.ok(barrel.containerItems().some(i=>i.name==='apple'&&i.count>=4));}finally{barrel.close();}
 const available=await capabilities();for(const c of ['observe','move_to','mine','place','craft','open_container','transfer_item'])assert.ok(available.includes(c));
 await recorderPrerequisites();
 writeFileSync(process.env.EMERGENCE_VALIDATION_REPORT,JSON.stringify({spawn:true,target:true,resources:true,capabilities:true,recorder:true,reachability:'Manual review: swimming and crafting a boat are plausible routes; autonomous success is not proven.',evidence:['Server observation: fixed position, survival mode, full health/food and empty inventory','Loaded blocks: island grass, water gap, gold mainland marker, oak logs and food barrel','Barrel window contains at least four apples','Adapter exposes required capabilities; ffmpeg, ffprobe, recorder and Chromium are installed']}));
}finally{await close(bot);}
