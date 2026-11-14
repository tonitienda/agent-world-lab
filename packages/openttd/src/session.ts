import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {OpenTTDRuntime} from './runtime.js';
import type {Observation, Position} from './camera.js';

const coordinate = z.number().int().min(1).max(62);
const position = {x: coordinate, y: coordinate};
const front = {front_x: coordinate, front_y: coordinate};
const vehicle = {vehicle: z.number().int().min(0).max(10000)};
const publicSpeech = {
  intention: z.string().min(1).max(200).describe('Short technical intention for the experiment log'),
  narration: z.string().min(1).max(280).optional().describe('Optional public, speakable first-person commentary for viewers: a short plan, observation, correction or joke. No coordinates or tool names.'),
  technical_summary: z.string().max(1000).optional().describe('Optional concise technical explanation; logged, not voiced'),
};
export const toolDefinitions = {
  observe: {description: 'Observe your company, towns, buses, station passenger queues, remaining budgets and objective progress. Thinking does not advance game time.', schema: z.object({})},
  survey: {description: 'Survey a bounded public map area. Returns vacant flat sites next to roads, passenger acceptance/production, and an ASCII road map (R road, . buildable, X occupied, # outside). Site front coordinates point to an existing road. No route is chosen or built for you. Acceptance >=8 accepts passengers.', schema: z.object({...position, radius: z.number().int().min(1).max(16).default(16)})},
  engines: {description: 'List buyable passenger bus engines, prices, capacities and annual running costs.', schema: z.object({})},
  vehicle_info: {description: 'Inspect one bus, its ordered destinations, and whether it is stopped in a depot.', schema: z.object(vehicle)},
  build_stop: {description: 'Build a terminal bus stop on one vacant tile; front must be an adjacent road tile. Each new stop is separate. Costs real money. You may need build_road to connect its entrance.', schema: z.object({...position, ...front, ...publicSpeech})},
  build_depot: {description: 'Build a road-vehicle depot on a vacant tile, with front pointing at an adjacent road. You may need an entrance connection.', schema: z.object({...position, ...front, ...publicSpeech})},
  build_road: {description: 'Build a straight road segment between tile centres. Endpoints must share x or y. Use short entrance connections to join a stop/depot to town roads. Occupied tiles reject construction; existing road is reported explicitly.', schema: z.object({...position, end_x: coordinate, end_y: coordinate, ...publicSpeech})},
  build_vehicle: {description: 'Buy a passenger bus in your depot. Returns its vehicle ID; it starts stopped with no orders. At most three buses at once.', schema: z.object({...position, engine: z.number().int().min(0), ...publicSpeech})},
  append_order: {description: 'Append a destination stop tile to this bus. Order lists repeat automatically. Assign at least two distinct stops before starting.', schema: z.object({...vehicle, ...position, ...publicSpeech})},
  remove_order: {description: 'Remove a bus order by zero-based index.', schema: z.object({...vehicle, index: z.number().int().min(0).max(7), ...publicSpeech})},
  toggle_vehicle: {description: 'Toggle a bus between running and stopped. A newly purchased bus must be started once after orders are assigned.', schema: z.object({...vehicle, ...publicSpeech})},
  send_depot: {description: 'Order a running bus back to a depot; it must physically reach it before sale.', schema: z.object({...vehicle, ...publicSpeech})},
  sell_vehicle: {description: 'Sell a bus that has stopped inside a depot. Its actual resale value is credited; no automatic teleport or refund.', schema: z.object({...vehicle, ...publicSpeech})},
  set_loan: {description: 'Repay or adjust the existing loan in normal game increments. Borrowing above the initial 20,000 is forbidden.', schema: z.object({amount: z.number().int().min(0).max(20000), ...publicSpeech})},
  advance_days: {description: 'Run the simulation for 1–15 economy days, then pause and return verified delivery, financial, bus and queue state. Captures each day. Cannot run beyond the 120-day deadline.', schema: z.object({days: z.number().int().min(1).max(15), ...publicSpeech})},
  report_narration: {description: 'Record a brief public observation or revised plan for viewers without advancing time. Prefer attaching commentary to your next action when possible.', schema: z.object({narration: z.string().min(1).max(280)})},
  finish_session: {description: 'Finish the experiment and preserve the actual objective result, saves and recordings. Use after success, the deadline, or an honest inability to continue.', schema: z.object({narration: z.string().min(1).max(280).optional()})},
} as const;
export type ToolName = keyof typeof toolDefinitions;

export const GOAL = {passengers: 200, days: 120, minimumCash: 5000, maximumLoan: 20000, maximumBuses: 3,
  maximumCalls: 200, maximumActions: 80, maximumWallMinutes: 25};

export function evaluateGoal(state: Observation & {loan: number}, startDate: number) {
  const days = state.date - startDate;
  const operatingProfit = state.vehicles.reduce((sum, bus) => sum + bus.profit, 0);
  const checks = {delivered: state.delivered >= GOAL.passengers, cash: state.balance >= GOAL.minimumCash,
    profitableFleet: operatingProfit > 0, borrowing: state.loan <= GOAL.maximumLoan, deadline: days <= GOAL.days,
    fleetLimit: state.vehicles.length <= GOAL.maximumBuses};
  return {achieved: Object.values(checks).every(Boolean), days, daysRemaining: Math.max(0, GOAL.days - days),
    delivered: state.delivered, cash: state.balance, loan: state.loan, operatingProfit, checks, targets: GOAL};
}

export type ActionRecord = {
  id: number; tool: ToolName; args: Record<string, any>; startedAt: string; dateBefore: number;
  beforeCapture?: number; afterCapture?: number; result?: any; dateAfter?: number;
};

export class OpenTTDSession {
  readonly events: ActionRecord[] = [];
  startDate = 0;
  calls = 0;
  actions = 0;
  finished = false;
  private started = Date.now();
  constructor(readonly world: OpenTTDRuntime, readonly actor: 'claude' | 'baseline') {}
  async start() {
    this.world.recording.actorLabel = this.actor === 'claude' ? 'Claude Opus 5.5 · solo experiment' : 'Scripted feasibility baseline';
    this.world.recording.episode = 'episode-007';
    this.world.recording.goal = {passengers: GOAL.passengers, days: GOAL.days, minimumCash: GOAL.minimumCash};
    const state = await this.world.start();
    this.startDate = state.date;
    await this.persist();
    return state;
  }
  private async persist() {
    await writeFile(join(this.world.folder, 'actions.json'), JSON.stringify(this.events, null, 2));
    await writeFile(join(this.world.folder, 'session-state.json'), JSON.stringify({actor: this.actor, startDate: this.startDate,
      calls: this.calls, actions: this.actions, finished: this.finished, goal: GOAL}, null, 2));
  }
  async status() {
    const state = await this.world.observe();
    return {ok: true, company: state, stations: await this.world.stations(), objective: evaluateGoal(state, this.startDate),
      budgets: {calls: this.calls, maximumCalls: GOAL.maximumCalls, actions: this.actions, maximumActions: GOAL.maximumActions,
        wallMinutes: (Date.now() - this.started) / 60000}};
  }
  async execute(name: ToolName, input: unknown): Promise<any> {
    const definition = toolDefinitions[name];
    if (!definition) return {ok: false, message: 'Unknown operation'};
    const parsed = definition.schema.safeParse(input);
    if (!parsed.success) return {ok: false, message: 'Invalid tool arguments', errors: parsed.error.flatten()};
    const args = parsed.data as Record<string, any>;
    if (this.finished) return {...(await this.status()), ok: false, message: 'Session already finished'};
    if (name === 'finish_session') return this.finish(args.narration);
    if (++this.calls > GOAL.maximumCalls || (Date.now() - this.started) > GOAL.maximumWallMinutes * 60000)
      return this.finish(undefined, 'budget-exhausted');
    if (name === 'observe') { await this.persist(); return this.status(); }
    if (name === 'survey') {
      const sites = await this.world.request('sites', args);
      const map = await this.world.request('map', args);
      return {ok: sites.ok && map.ok, sites: sites.items, map: map.items, legend: 'R road, . buildable, X occupied, # outside'};
    }
    if (name === 'engines') return this.world.request('engines');
    if (name === 'vehicle_info') return this.world.request('vehicle', args);
    if (++this.actions > GOAL.maximumActions) return this.finish(undefined, 'action-budget-exhausted');
    const before = await this.world.observe();
    const event: ActionRecord = {id: this.events.length, tool: name, args, startedAt: new Date().toISOString(), dateBefore: before.date};
    this.events.push(event);
    const focus: Position | undefined = typeof args.x === 'number' ? {x: args.x, y: args.y}
      : before.vehicles.find(v => v.id === args.vehicle)?.position;
    const construction = name.startsWith('build_');
    event.beforeCapture = await this.world.capture(construction ? 'construction' : 'operation',
      args.intention ?? args.narration, focus, event.id, 'before');
    await this.persist();
    if (name === 'report_narration') event.result = {ok: true, message: 'Public commentary recorded'};
    else if (name === 'build_vehicle' && before.vehicles.length >= GOAL.maximumBuses)
      event.result = {ok: false, message: 'Three-bus fleet limit reached'};
    else if (name === 'advance_days') {
      const remaining = GOAL.days - (before.date - this.startDate);
      if (remaining <= 0) event.result = {ok: false, message: 'The 120-day deadline has been reached'};
      else {
        const days = Math.min(args.days, remaining);
        for (let i = 0; i < days; i++) {
          const result = await this.world.request('advance', {days: 1});
          if (!result.ok || result.data.end_date - result.data.start_date !== 1 || !result.data.paused)
            throw new Error('Controlled time advancement failed');
          await this.world.capture('operation', undefined, undefined, event.id);
        }
        event.result = {...(await this.status()), daysAdvanced: days};
      }
    } else {
      const op = name === 'toggle_vehicle' ? 'start_vehicle' : name;
      const {intention, narration, technical_summary, ...gameArgs} = args;
      const reply = await this.world.request(op, gameArgs);
      event.result = {ok: reply.ok, ...reply.data};
    }
    const after = await this.world.observe();
    event.dateAfter = after.date;
    event.afterCapture = await this.world.capture(construction ? 'construction' : 'operation',
      event.result.ok ? `${name.replaceAll('_', ' ')} complete` : 'Attempt rejected — inspect the result', focus, event.id, 'after');
    await this.persist();
    return {...event.result, state: after, stations: await this.world.stations(), objective: evaluateGoal(after, this.startDate),
      budgets: {callsRemaining: GOAL.maximumCalls - this.calls, actionsRemaining: GOAL.maximumActions - this.actions}};
  }
  async finish(narration?: string, reason = 'agent-finished'): Promise<any> {
    if (this.finished) return this.status();
    const state = await this.world.observe();
    const objective = evaluateGoal(state, this.startDate);
    const event: ActionRecord = {id: this.events.length, tool: 'finish_session', args: {narration},
      dateBefore: state.date, dateAfter: state.date, startedAt: new Date().toISOString(), result: {ok: true, objective}};
    this.events.push(event);
    event.beforeCapture = await this.world.capture('outcome', objective.achieved ? 'Objective achieved' : 'Final measured result', undefined, event.id, 'before');
    event.afterCapture = event.beforeCapture;
    await this.world.save('final');
    this.finished = true;
    const result = {status: objective.achieved ? 'success' : 'incomplete', actor: this.actor, reason, objective,
      finalState: state, actions: this.actions, calls: this.calls, endedAt: new Date().toISOString()};
    await writeFile(join(this.world.folder, 'result.json'), JSON.stringify(result, null, 2));
    await this.persist();
    return {ok: true, ...result};
  }
}
