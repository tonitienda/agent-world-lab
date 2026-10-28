import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SessionEvents} from "../src/mcp/session-events.js";

test("MCP events are durable JSON suitable for episode planner", () => {
  const dir=mkdtempSync(join(tmpdir(),"emergent-events-"));
  try {
    const log=new SessionEvents(dir);
    log.add("move_to", {args:{x:2,y:10,z:5}, result:{ok:true}});
    const entries=JSON.parse(readFileSync(join(dir,"events.json"),"utf8"));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].action, "session_start");
    assert.equal(entries[1].action, "move_to");
    assert.equal(entries[1].details.args.x, 2);
    assert.ok(Number.isFinite(Date.parse(entries[1].at)));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

for(const file of ["follow.mp4","follow.webm"]){
 test(`existing ${file} is protected from session overwrite`,()=>{
  const dir=mkdtempSync(join(tmpdir(),"emergent-events-"));
  try{writeFileSync(join(dir,file),"existing recording");assert.throws(()=>new SessionEvents(dir),/already contains/);}
  finally{rmSync(dir,{recursive:true,force:true});}
 });
}
