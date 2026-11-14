import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluateGoal, OpenTTDSession} from '../src/session.js';
import type {OpenTTDRuntime} from '../src/runtime.js';

function state() {
  return {date: 1120, width: 64, height: 64, balance: 5000, loan: 20000, delivered: 200, paused: true, towns: [],
    vehicles: [{id: 0, position: {x: 10, y: 10}, profit: 1, load: 0, capacity: 31}]};
}

test('the objective requires every financial, delivery and deadline condition together', () => {
  assert.equal(evaluateGoal(state(), 1000).achieved, true);
  for (const patch of [{balance: 4999}, {loan: 20001}, {delivered: 199}, {date: 1121},
    {vehicles: [{...state().vehicles[0]!, profit: 0}]}])
    assert.equal(evaluateGoal({...state(), ...patch}, 1000).achieved, false);
  assert.equal(evaluateGoal({...state(), vehicles: Array.from({length: 4}, (_, id) => ({...state().vehicles[0]!, id}))}, 1000).achieved, false);
});

async function fixture(t: any) {
  const folder = await mkdtemp(join(tmpdir(), 'openttd-session-'));
  t.after(() => rm(folder, {recursive: true, force: true}));
  const current = {...state(), date: 1119, delivered: 0};
  const requested: {op: string; args: any}[] = [];
  let frames = 0;
  const world = {folder, recording: {captures: []}, observe: async () => structuredClone(current), stations: async () => [],
    capture: async () => frames++, save: async () => {},
    request: async (op: string, args: any) => {
      requested.push({op, args});
      const start = current.date;
      if (op === 'advance') current.date += args.days;
      return {ok: true, data: {start_date: start, end_date: current.date, paused: true}};
    }};
  const session = new OpenTTDSession(world as unknown as OpenTTDRuntime, 'baseline');
  session.startDate = 1000;
  return {session, current, requested};
}

test('an advance is capped at the deadline in the runner, independent of the prompt', async t => {
  const {session, current, requested} = await fixture(t);
  const reply = await session.execute('advance_days', {days: 15, intention: 'Wait for the buses'});
  assert.equal(reply.daysAdvanced, 1);
  assert.equal(current.date, 1120);
  assert.equal(requested.filter(r => r.op === 'advance').length, 1);
  const late = await session.execute('advance_days', {days: 1, intention: 'Too late'});
  assert.equal(late.ok, false);
  assert.equal(current.date, 1120);
});

test('loan and fleet caps reject actions before they reach the game engine', async t => {
  const {session, current, requested} = await fixture(t);
  const loan = await session.execute('set_loan', {amount: 25000, intention: 'Borrow more'});
  assert.equal(loan.ok, false);
  current.vehicles = Array.from({length: 3}, (_, id) => ({...state().vehicles[0]!, id}));
  const bus = await session.execute('build_vehicle', {x: 10, y: 10, engine: 116, intention: 'Buy a fourth bus'});
  assert.equal(bus.ok, false);
  assert.deepEqual(requested, []);
});

test('tool-call exhaustion finalizes and saves the measured outcome', async t => {
  const {session, requested} = await fixture(t);
  session.calls = 200;
  const result = await session.execute('observe', {});
  assert.equal(result.reason, 'budget-exhausted');
  assert.equal(session.finished, true);
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(requested, []);
});
