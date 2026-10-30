import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Shared Node-only production helper.
import {summarizeGoal} from '../production/tools/intro.mjs';
const objective='You are standing beside a deep ravine. Your objective is to reach the gold landing pad on the opposite bank. Choose your own strategy. You may explore, mine, craft and build.';
test('opening copy keeps the objective and omits operational geography and tool instructions',()=>{
 const goal='You are standing beside a deep ravine.\n\nYour objective is to reach the gold landing pad on the opposite bank.\nChoose your own strategy. You may explore, mine, craft and build.\n\nYou start at (2.5, 96, 0.5).\n\nKnown geography:\n- Six dirt blocks.\n\nUse only the world tools.';
 assert.equal(summarizeGoal(goal),objective);
 assert.ok(summarizeGoal(goal).length<=280);
});
test('opening copy remains bounded for an unusually long first paragraph',()=>{
 assert.ok(summarizeGoal('Find '+ 'a useful resource '.repeat(40)).length<=280);
 assert.equal(summarizeGoal('# Goal\n\nReach the landmark.'),'Reach the landmark.');
});
