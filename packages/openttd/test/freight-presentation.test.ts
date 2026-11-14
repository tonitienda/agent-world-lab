import test from 'node:test';
import assert from 'node:assert/strict';
import {freightChime, freightFrame, freightReceipt, type FreightSample} from '../src/freight-presentation.js';

const before: FreightSample = {day: 12, income: 100, balance: 6020, wood: 20, goods: 0, trucks: []};
const after: FreightSample = {...before, day: 24, income: 360, balance: 6000, goods: 8};

test('freight revenue uses the income ledger even if simultaneous costs decrease cash', () => {
  assert.deepEqual(freightReceipt(before, after), {id: 'freight-income-12-24', amount: 260, days: 12});
  assert.equal(freightReceipt(before, {...before, day: 24, balance: 16020}), undefined);
  assert.equal(freightReceipt(before, {...after, goods: 0})?.amount, 260);
  assert.equal(freightReceipt(after, after), undefined);
});

test('review frame distinguishes freight receipts and net cash without a vehicle marker', () => {
  const pngHeader = Buffer.alloc(24);
  pngHeader.writeUInt32BE(8065, 16);
  pngHeader.writeUInt32BE(4183, 20);
  const svg = freightFrame(pngHeader, after, {woodDeliveredToSawmill: 160, goodsFromSawmillDeliveredToTown: 80,
    maximumDays: 240, minimumEndingCash: 8000}, {focus: {x: 96, y: 86}, heading: 'Delivery', skin: 'OpenGFX2 Classic',
    receipt: freightReceipt(before, after)});
  assert.match(svg, /\+260/);
  assert.match(svg, /6,000/);
  assert.doesNotMatch(svg, /ellipse|episode-009/i);
});

test('cash cue has a bounded PCM level and fades to silence', () => {
  const wav = freightChime();
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.length, 44 + 17280 * 2);
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  assert.ok(peak > 1000 && peak < 10000);
  assert.ok(Math.abs(wav.readInt16LE(wav.length - 2)) <= 1);
});

test('a purchase uses its own negative amount and omits the delivery wording', () => {
  const pngHeader = Buffer.alloc(24);
  pngHeader.writeUInt32BE(8065, 16);
  pngHeader.writeUInt32BE(4183, 20);
  const svg = freightFrame(pngHeader, after, {woodDeliveredToSawmill: 120, goodsFromSawmillDeliveredToTown: 28,
    maximumDays: 240, minimumEndingCash: 8000}, {focus: {x: 96, y: 86}, heading: 'Purchase', skin: 'OpenGFX2 Classic',
    expense: {amount: 4388, label: 'TRUCK PURCHASE'}});
  assert.match(svg, /TRUCK PURCHASE/);
  assert.match(svg, /−4,388/);
  assert.doesNotMatch(svg, /DELIVERY INCOME/);
});
