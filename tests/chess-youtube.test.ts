import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ChessMatch} from '../packages/chess/src/index.js';
import {youtubeCopy, timestamp} from '../scripts/chess-youtube.js';
import type {Narration, ScriptLine} from '../scripts/chess-narration.js';

function fixture(at = 12) {
  const match = new ChessMatch({white:{id:'claude',kind:'agent',label:'Claude'},black:{id:'sf',kind:'engine',label:'Stockfish 2000'}});
  for (const m of ['f3','e5','g4','Qh4#']) match.play(m);
  const narration: Narration = {duration:68,intro:{start:0,duration:7},outro:{start:50,duration:8},end:{start:58,duration:10},
    cues:[{ply:1,start:at,duration:4,text:'My move.',kind:'intention'}]};
  const manifest: ScriptLine[] = [{line:1,voice:'agent',at,slot:4,ply:1,kind:'intention',text:'My move.',audio:'1_Chapter_1.wav'}];
  return {episode:'episode-test',replay:match.replay(),narration,manifest,
    validation:{duration:68,schedule:[{line:1,start:at,duration:3}],credits:[{text:'Exact music credit\nLicense text'}]},
    config:{title:'An editorial title',chapters:[{kind:'intro' as const,title:'Matchup'},{kind:'cue' as const,ply:1,title:'Opening'},{kind:'outro' as const,title:'Result'}]}};
}
test('upload copy follows retimed cues, verified results, and exact credits while preserving editorial copy',()=>{
  const first=youtubeCopy(fixture()), retimed=youtubeCopy(fixture(24));
  assert.match(first,/0:12 Opening/);assert.match(retimed,/0:24 Opening/);
  assert.match(retimed,/\*\*An editorial title\*\*/);
  assert.match(first,/Exact music credit\nLicense text/);
  assert.match(first,/Final move: 2\.\.\. Qh4#\. 0-1/);
  assert.match(first,/Stockfish 2000 wins by checkmate after 2 moves\. Claude tried 0 illegal moves/);
  assert.match(first,/0:58–1:08/);
  assert.equal(timestamp(3672.9),'1:01:12');
});
test('rejects invalid chapters and stale video/narration timing',()=>{
  assert.throws(()=>youtubeCopy(fixture(5)),/at least 10 seconds/);
  const missing=fixture();missing.config.chapters[1].ply=99;
  assert.throws(()=>youtubeCopy(missing),/missing cue/);
  const stale=fixture();stale.validation.duration=70;
  assert.throws(()=>youtubeCopy(stale),/durations differ/);
  const shifted=fixture();shifted.narration.cues[0].start=15;
  assert.throws(()=>youtubeCopy(shifted),/cues differ/);
});
