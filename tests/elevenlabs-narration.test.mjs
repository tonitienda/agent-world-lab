import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateEpisodeAudio, audioRequests} from '../scripts/elevenlabs-narration.mjs';

const config = {modelId:'eleven_v4',outputFormat:'mp3_44100_128',speakers:{presenter:{name:'Bella',voiceId:'bella-id'},agent:{name:'Larry',voiceId:'larry-id'}}};
const lines = [{line:1,audio:'1_Chapter_1.wav',voice:'presenter',text:'Welcome.'},{line:2,audio:'2_Chapter_1.wav',voice:'agent',text:'My move.'}];
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'elevenlabs-test-'));
  const folder=join(root,'production/episode-test'),active=join(root,'production/public/episode-test/audio');
  mkdirSync(folder,{recursive:true});mkdirSync(active,{recursive:true});
  writeFileSync(join(root,'production/voices.json'),JSON.stringify(config));
  writeFileSync(join(folder,'narration-manifest.json'),JSON.stringify(lines));
  for(const line of lines)writeFileSync(join(active,line.audio),'old recording');
  const mp3=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.1','-f','mp3','pipe:1']);
  return {root,folder,active,mp3};
}
test('speaker mapping and cache identity include exact text, voice and model',()=>{
  const requests=audioRequests(lines,config);
  assert.equal(requests[0].request.voiceId,'bella-id');assert.equal(requests[1].request.voiceId,'larry-id');
  for(const changed of [{...config,modelId:'different'}, {...config,speakers:{...config.speakers,presenter:{voiceId:'other'}}}])
    assert.notEqual(audioRequests(lines,changed)[0].fingerprint,requests[0].fingerprint);
  assert.notEqual(audioRequests([{...lines[0],text:'Changed.'},lines[1]],config)[0].fingerprint,requests[0].fingerprint);
  assert.throws(()=>audioRequests([{...lines[0],audio:'../bad.wav'}],config));
});
test('a named character voice wins over its role, and unknown characters fall back to the role',()=>{
  const cast={...config,speakers:{...config.speakers,ada:{name:'Elsa',voiceId:'elsa-id'}}};
  const [ada,bram]=audioRequests([{...lines[0],voice:'agent',speaker:'ada'},{...lines[1],speaker:'bram'}],cast);
  assert.equal(ada.request.voiceId,'elsa-id');assert.equal(bram.request.voiceId,'larry-id');
});
test('failure preserves active files; resume reuses paid output and activation preserves originals',async()=>{
  const f=fixture();let calls=[];let fail=true;
  const client={textToSpeech:{convert:async(voice,body,options)=>{
    calls.push({voice,body,options});if(voice==='larry-id'&&fail)throw {statusCode:429};
    return new ReadableStream({start(c){c.enqueue(f.mp3);c.close();}});
  }}};
  const run=()=>generateEpisodeAudio({root:f.root,episode:'episode-test',client,log:()=>{}});
  try {
    await assert.rejects(run(),/HTTP 429/);
    assert.equal(readFileSync(join(f.active,lines[0].audio),'utf8'),'old recording');
    assert.ok(!existsSync(join(f.folder,'.elevenlabs-lock')));
    fail=false;await run();
    assert.deepEqual(calls.map(c=>c.voice),['bella-id','larry-id','larry-id']);
    assert.ok(calls.every(c=>c.body.modelId==='eleven_v4'&&c.options.maxRetries===0));
    const meta=JSON.parse(readFileSync(join(f.folder,'elevenlabs-audio.json')));
    assert.equal(meta.clips.length,2);assert.ok(meta.clips.every(c=>c.duration>0));
    assert.ok(existsSync(join(f.folder,'audio-backups')));
    await run();assert.equal(calls.length,3,'unchanged rerun must make no API calls');
  } finally {rmSync(f.root,{recursive:true,force:true});}
});
