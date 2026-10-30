import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireLock,activeLock} from '../src/session/lock.js';

test('supervisor lease permits only explicit delegates and remains locked until supervisor release',()=>{
 const d=mkdtempSync(join(tmpdir(),'emergence-lock-')),p=join(d,'lock');
 const previous=[process.env.EMERGENCE_LEASE,process.env.EMERGENCE_OWNER_PID];
 try{
  mkdirSync(p);writeFileSync(join(p,'owner.json'),JSON.stringify({pid:process.pid,kind:'emergence session orchestration',token:'private-lease'}));
  assert.throws(()=>acquireLock('competitor',p),/Active/);
  process.env.EMERGENCE_LEASE='wrong';process.env.EMERGENCE_OWNER_PID=String(process.pid);
  assert.throws(()=>acquireLock('wrong delegate',p),/Active/);
  process.env.EMERGENCE_LEASE='private-lease';
  const release=acquireLock('delegated capture',p);release();assert.ok(existsSync(p));
  process.env.EMERGENCE_OWNER_PID='1';assert.throws(()=>acquireLock('wrong PID',p),/Active/);
 }finally{for(const [i,key] of ['EMERGENCE_LEASE','EMERGENCE_OWNER_PID'].entries()){if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}rmSync(d,{recursive:true,force:true});}
});

 test('a killed supervisor cannot hide a live delegated Minecraft session',()=>{
 const d=mkdtempSync(join(tmpdir(),'emergence-orphan-')),p=join(d,'lock');
 try{mkdirSync(join(p,'delegates'),{recursive:true});writeFileSync(join(p,'owner.json'),JSON.stringify({pid:2147483647,kind:'dead supervisor'}));writeFileSync(join(p,'delegates/child'),JSON.stringify({pid:process.pid,kind:'Minecraft session / recording'}));assert.equal(activeLock(p)?.pid,process.pid);assert.throws(()=>acquireLock('reset',p),/Active/);}
 finally{rmSync(d,{recursive:true,force:true});}
 });
