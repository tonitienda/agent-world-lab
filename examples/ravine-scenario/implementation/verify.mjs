import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connect,close,wait,capabilities,recorderPrerequisites,ravine} from './common.mjs';
const {verifyBotRavine,expectedRavineBlocks}=await ravine();
const bot=await connect();
try{
 // Reads every block in the course volume plus position, facing, mode, health, food and inventory.
 await wait(()=>verifyBotRavine(bot));
 const available=await capabilities();for(const c of ['observe','move_to','mine','place','craft'])assert.ok(available.includes(c));
 await recorderPrerequisites();
 writeFileSync(process.env.EMERGENCE_VALIDATION_REPORT,JSON.stringify({spawn:true,target:true,resources:true,capabilities:true,recorder:true,reachability:'Manual review: bridging with crafted planks or walking around the finite 33-block gap are plausible routes; autonomous success is not proven.',evidence:[`Loaded blocks: all ${expectedRavineBlocks().size} course blocks match ravine-v1 (banks, 24-block gap, gold pad, emerald pillar, two oak trees)`,'Server observation: start (2.5,96,0.5) facing east, survival mode, full health/food and empty inventory','Adapter exposes required capabilities; ffmpeg, ffprobe, recorder and Chromium are installed']}));
}finally{await close(bot);}
