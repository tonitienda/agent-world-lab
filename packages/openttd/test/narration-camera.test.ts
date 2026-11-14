import test from 'node:test';
import assert from 'node:assert/strict';
import {direct, renderCamera, type Recording} from '../src/camera.js';
import {applyNarrationCameras} from '../src/narration-camera.js';

function fixture(): Recording {
  return {version: 1, sampleEconomyDays: 1, northHeight: 1, southHeight: 1, captures: [0, 1, 2].map(day => ({
    image: `day-${day}.png`, kind: 'operation', snapshot: {date: 1000 + day, width: 64, height: 64, balance: 9000, delivered: 0,
      towns: [{id: 1, name: 'Town', position: {x: 20, y: 20}, population: 5000}],
      vehicles: [{id: 2, position: {x: 10 + day, y: 15}, load: day * 10, capacity: 31, profit: 0}]},
    stations: [{id: 0, name: 'North', position: {x: 8, y: 28}, waiting: 50 + day},
      {id: 1, name: 'South', position: {x: 14, y: 45}, waiting: 150 + day}],
  }))};
}
const actions = [{id: 7, beforeCapture: 0, afterCapture: 1, args: {narration: 'Look at the north stop.'}}];

test('a spoken subject overrides the busier station without changing timing or chronology', () => {
  const recording = fixture(), plan = direct(recording), untouched = structuredClone(plan.shots[2]);
  const durations = plan.shots.map(s => s.duration);
  applyNarrationCameras(recording, plan, actions, [{eventId: 7, heading: 'North stop', camera: 'queue', target: {kind: 'station', id: 0}}]);
  assert.equal(plan.shots[0]!.subject, 0);
  assert.deepEqual(plan.shots[0]!.focus, {x: 8, y: 28});
  assert.deepEqual(plan.shots[2], untouched);
  assert.deepEqual(plan.shots.map(s => s.duration), durations);
  assert.deepEqual(plan.shots.map(s => s.capture), [0, 1, 2]);
});

test('vehicle subjects track the same bus through successive captured positions', () => {
  const recording = fixture(), plan = direct(recording);
  applyNarrationCameras(recording, plan, actions, [{eventId: 7, heading: 'Our bus', camera: 'follow', target: {kind: 'vehicle', id: 2}}]);
  assert.equal(plan.shots[0]!.vehicle, 2);
  assert.deepEqual(plan.shots[0]!.focus, {x: 10, y: 15});
  assert.deepEqual(plan.shots[1]!.focus, {x: 11, y: 15});
});

test('the detail inset displays this capture’s measured queue, not a narrated or stale number', () => {
  const recording = fixture(), plan = direct(recording);
  applyNarrationCameras(recording, plan, actions, [{eventId: 7, heading: 'North stop', camera: 'queue',
    target: {kind: 'station', id: 0}, inset: {target: {kind: 'station', id: 1}, label: 'South stop'}}]);
  const png = Buffer.alloc(24); png.writeUInt32BE(3969, 16); png.writeUInt32BE(2135, 20);
  const svg = renderCamera(recording.captures[1]!, plan.shots[1]!, recording, png);
  assert.ok(svg.includes('South stop · 151 waiting'));
  assert.ok(svg.includes('clip-path="url(#detail)"'));
});

test('missing subjects and unrecorded commentary fail explicitly', () => {
  const recording = fixture();
  assert.throws(() => applyNarrationCameras(recording, direct(recording), actions,
    [{eventId: 7, heading: 'Missing', camera: 'queue', target: {kind: 'station', id: 99}}]), /absent/);
  assert.throws(() => applyNarrationCameras(recording, direct(recording), [],
    [{eventId: 7, heading: 'Missing speech', camera: 'wide'}]), /recorded spoken action/);
});
