import {connect,close,command,ravine} from './common.mjs';
const {prepareRavine}=await ravine();
const bot=await connect();
try{
 // Builds ravine-v1, fixes time/weather/ticks/spawning and resets the player, then verifies it.
 await prepareRavine(bot,command);
 console.log('Constructed ravine-v1 course, gold landing pad, emerald marker, oak trees and initial player state.');
}finally{await close(bot);}
