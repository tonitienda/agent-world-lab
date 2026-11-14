import test from 'node:test';
import assert from 'node:assert/strict';
import {project, cropFor, direct, renderCamera, type Capture, type Recording} from '../src/camera.js';

function frame(day: number, waiting = 0, delivered = 0, load = 0): Capture {
  return {kind: 'operation', image: `day-${day}.png`,
    snapshot: {date: 700000 + day, width: 64, height: 64, balance: 94000, delivered,
      vehicles: [{id: 0, position: {x: 15, y: 33}, load, capacity: 31, profit: 0}]},
    stations: [{id: 0, name: 'North & West', position: {x: 12, y: 36}, waiting}]};
}
const recording = (captures: Capture[]): Recording => ({version: 1, sampleEconomyDays: 1, northHeight: 1, southHeight: 1, captures});

test('isometric positions align with flat OpenTTD 15.3 giant screenshots', () => {
  assert.deepEqual(project({x: 1, y: 1}, 64, 1), {x: 1984, y: 166});
  assert.equal(project({x: 20, y: 21}, 64, 1).x - project({x: 20, y: 20}, 64, 1).x, 32);
  assert.equal(project({x: 20, y: 21}, 64, 1).y - project({x: 20, y: 20}, 64, 1).y, 16);
  assert.deepEqual(project({x: 12, y: 36}, 64, 2), project({x: 12, y: 36}, 64, 1));
});

test('all camera crops stay inside the source and preserve 16:9 near edges', () => {
  for (const focus of [{x: 1, y: 1}, {x: 63, y: 1}, {x: 1, y: 63}, {x: 63, y: 63}]) {
    const crop = cropFor({capture: 0, camera: 'construction', reason: 'test', duration: 1, focus}, 64, 1,
      {width: 3969, height: 2135});
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.width <= 3969 && crop.y + crop.height <= 2135);
    assert.ok(Math.abs(crop.width / crop.height - 16 / 9) < 1e-9);
  }
});

test('queues get a stable close-up, deliveries override it, and transit returns to follow', () => {
  const captures = [frame(0), frame(1, 25), frame(2, 28), frame(3, 29, 31),
    ...Array.from({length: 9}, (_, i) => frame(4 + i, 29, 31))];
  const plan = direct(recording(captures));
  assert.equal(plan.shots[1]!.camera, 'queue');
  assert.equal(plan.shots[2]!.camera, 'queue');
  assert.equal(plan.shots[3]!.camera, 'delivery');
  assert.equal(plan.shots.at(-1)!.camera, 'follow');
  assert.equal(plan.shots[3]!.reason, '31 passengers delivered');
});

test('boarding is selected and construction preserves before/after chronology', () => {
  const captures: Capture[] = [
    {...frame(0), kind: 'construction', label: 'Before', focus: {x: 4, y: 29}},
    {...frame(0), kind: 'construction', label: 'After', focus: {x: 4, y: 29}},
    frame(1), frame(2, 0, 0, 31),
  ];
  const plan = direct(recording(captures));
  assert.deepEqual(plan.shots.slice(0, 2).map(s => s.reason), ['Before', 'After']);
  assert.equal(plan.shots[3]!.camera, 'boarding');
  assert.deepEqual(plan.shots.map(s => s.capture), [0, 1, 2, 3]);
});

test('queue labels use the current observed count during a held camera shot', () => {
  const captures = [frame(0), frame(1, 25), frame(2, 29)];
  const rec = recording(captures);
  const plan = direct(rec);
  const pngHeader = Buffer.alloc(24);
  pngHeader.writeUInt32BE(3969, 16); pngHeader.writeUInt32BE(2135, 20);
  const svg = renderCamera(captures[2]!, plan.shots[2]!, rec, pngHeader);
  assert.ok(svg.includes('29 passengers waiting'));
  assert.ok(!svg.includes('25 passengers waiting'));
  assert.ok(svg.includes('TIME-LAPSE'));
});

test('internal production IDs are not displayed in future game footage', () => {
  const captures = [frame(0)], rec = recording(captures);
  rec.episode = 'episode-999';
  const pngHeader = Buffer.alloc(24);
  pngHeader.writeUInt32BE(3969, 16); pngHeader.writeUInt32BE(2135, 20);
  const svg = renderCamera(captures[0]!, direct(rec).shots[0]!, rec, pngHeader);
  assert.ok(svg.includes('THE AGENT TERRARIUM / OPENTTD'));
  assert.ok(!svg.includes('EPISODE-999'));
});
