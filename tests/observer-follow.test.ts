import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {addObserverFollow}=require('../packages/minecraft-recorder/observer-follow.cjs');
test('observer camera follows third-person bot updates without changing zoom',()=>{
  const original='let firstPositionUpdate = true;\n    if (addMesh) {\n      moveMesh();\n    }';
  const modified=addObserverFollow(original);
  assert.match(modified,/controls\.target\.set\(pos\.x, pos\.y, pos\.z\)/);
  assert.match(modified,/viewer\.camera\.position\.x \+= dx/);
  assert.match(modified,/viewer\.camera\.position\.y \+= dy/);
  assert.match(modified,/viewer\.camera\.position\.z \+= dz/);
  assert.match(modified,/if \(controls && !firstPositionUpdate\)/);
  assert.match(modified,/if \(addMesh\)/);
});
test('unknown bundle fails loudly rather than silently filming terrain',()=>{
  assert.throws(()=>addObserverFollow('minified code'),/Unsupported Prismarine Viewer/);
});
