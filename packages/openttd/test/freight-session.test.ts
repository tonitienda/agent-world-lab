import assert from 'node:assert/strict';
import test from 'node:test';
import {freightObjective, freightTools} from '../src/freight-session.js';

const spec = {maximumLoan: 40000, maximumTrucks: 6, proposedGoal: {
  woodDeliveredToSawmill: 120, goodsFromSawmillDeliveredToTown: 28, maximumDays: 240, minimumEndingCash: 8000,
}};
const state = {date: 712451, day: 228, wood: 120, goods: 28, mill_goods_delivered: 28,
  income: 4000, balance: 11110, loan: 40000, fleet_profit: 3095, trucks: []};

test('freight win requires both engine delivery monitors, reserve, profit and time', () => {
  assert.equal(freightObjective(state, spec).achieved, true);
  assert.equal(freightObjective({...state, goods: 14}, spec).achieved, false);
  assert.equal(freightObjective({...state, mill_goods_delivered: 14}, spec).achieved, false);
  assert.equal(freightObjective({...state, balance: 7999}, spec).achieved, false);
  assert.equal(freightObjective({...state, day: 241}, spec).achieved, false);
  assert.equal(freightObjective({...state, loan: 40001}, spec).achieved, false);
});

test('freight player cannot invoke fixture setup, arbitrary cargo buys or borrowing', () => {
  assert.equal('setup_supply_chain' in freightTools, false);
  assert.equal('set_loan' in freightTools, false);
  assert.equal(freightTools.cargo_engines.schema.safeParse({cargo: 'passengers'}).success, false);
  assert.equal(freightTools.build_road.schema.safeParse({x: 70, y: 60, end_x: 102, end_y: 60}).success, true);
});
