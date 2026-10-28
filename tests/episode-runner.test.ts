import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('episode retry archives old captures, preserves prompt/source, and records all cameras',()=>{
 const dir=mkdtempSync(join(tmpdir(),'awl-runner-'));
 try{
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'production/episode-002'),{recursive:true});mkdirSync(join(dir,'bin'));
  const runner=join(dir,'scripts/run-episode-002.sh');
  writeFileSync(runner,readFileSync(resolve('scripts/run-episode-002.sh')));
  const session=join(dir,'production/episode-002');
  writeFileSync(join(session,'prompt.txt'),'The ravine challenge');
  writeFileSync(join(session,'edit-plan.json'),'keep production source');
  const old=['events.json','metadata.json','mcp-session.json','agent-pov.mp4','observer.mp4','follow.mp4','page@old.webm','follow-final-debug.png'];
  for(const file of old)writeFileSync(join(session,file),'old '+file);
  for(const tool of ['npm','make']){
   const file=join(dir,'bin',tool);
   writeFileSync(file,'#!/bin/sh\nif [ "${AWL_TEST_FAIL_SCENARIO:-}" = 1 ] && [ "$1 $2" = "run scenario:ravine" ]; then exit 7; fi\nprintf "%s %s\\n" "'+tool+'" "$*" >> commands.log\n');chmodSync(file,0o755);
  }
  const claude=join(dir,'bin/claude');
  writeFileSync(claude,`#!/bin/sh
set -eu
printf 'timeouts %s %s\\n' "$MCP_TIMEOUT" "$CLAUDE_CODE_MCP_STARTUP_WAIT_MS" >> commands.log
echo claude >> commands.log
test ! -e production/episode-002/events.json
test ! -e production/episode-002/follow.mp4
test "$(cat production/episode-002/prompt.txt)" = "The ravine challenge"
for file in events.json mcp-session.json agent-pov.mp4 observer.mp4 follow.mp4; do
 echo new > "production/episode-002/$file"
done
`);chmodSync(claude,0o755);
  const result=spawnSync('bash',[runner],{cwd:dir,env:{...process.env,MCP_TIMEOUT:'',CLAUDE_CODE_MCP_STARTUP_WAIT_MS:'',PATH:join(dir,'bin')+':'+process.env.PATH},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const archive=readdirSync(join(dir,'production')).find(v=>v.startsWith('episode-002-previous-'));
  assert.ok(archive);
  for(const file of old)assert.equal(readFileSync(join(dir,'production',archive,file),'utf8'),'old '+file);
  assert.equal(readFileSync(join(session,'edit-plan.json'),'utf8'),'keep production source');
  assert.equal(readFileSync(join(session,'follow.mp4'),'utf8'),'new\n');
  assert.ok(!existsSync(join(session,'page@old.webm')));
  assert.match(readFileSync(join(dir,'commands.log'),'utf8'),/npm run world:reset -- --yes --preset survival/);
  assert.match(result.stdout,/Episode recorded successfully/);
  const commands=readFileSync(join(dir,'commands.log'),'utf8');
  assert.ok(commands.indexOf('scenario:ravine -- --yes --agent emergent-002') < commands.indexOf('scenario:ravine -- --verify-only'));
  assert.ok(commands.indexOf('scenario:ravine -- --verify-only') < commands.indexOf('make set-mcp'));
  assert.ok(commands.indexOf('make set-mcp') < commands.indexOf('claude'));
  assert.match(commands,/SCENARIO_FILE=.*data\/minecraft\/scenario.json/);
  assert.match(readFileSync(join(dir,'commands.log'),'utf8'),/timeouts 180000 180000/);
  const override=spawnSync('bash',[runner],{cwd:dir,env:{...process.env,MCP_TIMEOUT:'240000',CLAUDE_CODE_MCP_STARTUP_WAIT_MS:'210000',PATH:join(dir,'bin')+':'+process.env.PATH},encoding:'utf8'});
  assert.equal(override.status,0,override.stderr);
  assert.match(readFileSync(join(dir,'commands.log'),'utf8'),/timeouts 240000 210000/);
  const loggedBefore=readFileSync(join(dir,'commands.log'),'utf8');
  const badSetup=spawnSync('bash',[runner],{cwd:dir,env:{...process.env,MCP_TIMEOUT:'180000',CLAUDE_CODE_MCP_STARTUP_WAIT_MS:'180000',AWL_TEST_FAIL_SCENARIO:'1',PATH:join(dir,'bin')+':'+process.env.PATH},encoding:'utf8'});
  assert.equal(badSetup.status,7);
  const afterFailure=readFileSync(join(dir,'commands.log'),'utf8').slice(loggedBefore.length);
  assert.doesNotMatch(afterFailure,/make set-mcp|claude/);
  assert.equal(readFileSync(join(session,'follow.mp4'),'utf8'),'new\n','scenario failure does not archive the existing recording');
  const invalid=spawnSync('bash',[runner],{cwd:dir,env:{...process.env,MCP_TIMEOUT:'invalid',PATH:join(dir,'bin')+':'+process.env.PATH},encoding:'utf8'});
  assert.notEqual(invalid.status,0);assert.match(invalid.stdout,/positive milliseconds/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
