import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {OpenTTDRuntime} from './runtime.js';
import type {Position} from './camera.js';
import type {FreightSample, FreightTarget} from './freight-presentation.js';

const coord = z.number().int().min(1).max(126);
const position = {x: coord, y: coord};
const endpoint = {end_x: coord, end_y: coord};
const front = {front_x: coord, front_y: coord};
const vehicle = {vehicle: z.number().int().min(0).max(10_000)};
const cargo = {cargo: z.enum(['wood', 'goods'])};
const speech = {narration: z.string().min(1).max(280).optional().describe('Public first-person commentary for viewers. State a plan, observation, or correction. Keep it short and speakable.'),
  visual_subject: z.object(position).optional().describe('Map tile of the stop, truck, crossing or industry mentioned in the commentary.')};
export const freightTools = {
  observe: {description: 'Read the scenario locations, freight queues, truck loads, budget and objective. Thinking does not advance time.', schema: z.object({})},
  survey: {description: 'Inspect a local ASCII map and vacant truck stop sites for the selected cargo near the supplied centre. Acceptance of 8 or more accepts the cargo. Production indicates coverage of a producer. Map legend: R road, . flat buildable, ~ water, s buildable slope, X occupied.', schema: z.object({...position, ...cargo, radius: z.number().int().min(1).max(16).default(12)})},
  cargo_engines: {description: 'List buyable native wood or goods trucks with their price and capacity.', schema: z.object(cargo)},
  bridge_options: {description: 'Find bridge types, prices and speeds by total span in tiles including both bridgeheads.', schema: z.object({length: z.number().int().min(2).max(32)})},
  vehicle_info: {description: 'Inspect a truck and its ordered destinations.', schema: z.object(vehicle)},
  build_road: {description: 'Build straight road between tile centres. Connect station/depot entrances explicitly if needed.', schema: z.object({...position, ...endpoint, ...speech})},
  build_bridge: {description: 'Build a road bridge from one aligned bank to the other. Use surveyed bridgeheads and a type for the exact span.', schema: z.object({...position, ...endpoint, bridge: z.number().int().min(0).max(20), ...speech})},
  build_freight_stop: {description: 'Build a separate truck stop on a surveyed tile facing its adjacent entrance road.', schema: z.object({...position, ...front, ...speech})},
  build_depot: {description: 'Build a road depot facing an adjacent road tile.', schema: z.object({...position, ...front, ...speech})},
  build_vehicle: {description: 'Buy an available freight truck in a depot. It starts stopped. Maximum six trucks.', schema: z.object({...position, engine: z.number().int().min(0).max(10_000), ...speech})},
  append_order: {description: 'Append a truck stop destination. Set full_load at a pickup to wait for a full load, or leave false for ordinary loading.', schema: z.object({...vehicle, ...position, full_load: z.boolean().default(false), ...speech})},
  remove_order: {description: 'Remove an order by zero-based index.', schema: z.object({...vehicle, index: z.number().int().min(0).max(15), ...speech})},
  toggle_vehicle: {description: 'Start or stop a truck. Start only after setting both orders.', schema: z.object({...vehicle, ...speech})},
  send_depot: {description: 'Send a running truck to a depot.', schema: z.object({...vehicle, ...speech})},
  sell_vehicle: {description: 'Sell a truck stopped in a depot.', schema: z.object({...vehicle, ...speech})},
  advance_days: {description: 'Run up to 15 economy days, pausing afterward. Reports actual cargo deliveries, queued loads and cash. Deadline is 240 days.', schema: z.object({days: z.number().int().min(1).max(15), ...speech})},
  report_narration: {description: 'Speak a brief public observation or plan without advancing the game.', schema: z.object({narration: z.string().min(1).max(280), visual_subject: z.object(position).optional()})},
  finish_session: {description: 'Preserve the actual outcome. Use after success, deadline, or an honest inability to proceed.', schema: z.object(speech)},
} as const;
export type FreightTool = keyof typeof freightTools;
export const freightBudget = {maximumCalls: 230, maximumActions: 120, maximumWallMinutes: 40};
type Spec = {proposedGoal: FreightTarget; maximumLoan: number; maximumTrucks: number};
type State = FreightSample & {date: number; loan: number; fleet_profit: number; mill_goods_delivered: number};
type Queue = {id: number; position: Position; wood_waiting: number; goods_waiting: number};
export type FreightCheckpoint = {save: string; state: State; stations: Queue[]; event: number; phase: 'start' | 'before' | 'after' | 'operation' | 'outcome'};
export type FreightAction = {id: number; tool: FreightTool; args: Record<string, any>; before: number; after?: number; result?: any};

export function freightObjective(state: State, spec: Spec) {
  const target = spec.proposedGoal;
  const checks = {wood: state.wood >= target.woodDeliveredToSawmill,
    goods: state.goods >= target.goodsFromSawmillDeliveredToTown && state.goods === state.mill_goods_delivered,
    cash: state.balance >= target.minimumEndingCash, profit: state.fleet_profit > 0,
    deadline: state.day <= target.maximumDays, borrowing: state.loan <= spec.maximumLoan, fleet: state.trucks.length <= spec.maximumTrucks};
  return {achieved: Object.values(checks).every(Boolean), checks, days: state.day, daysRemaining: target.maximumDays - state.day,
    wood: state.wood, goods: state.goods, cash: state.balance, loan: state.loan, operatingProfit: state.fleet_profit, targets: target};
}

export class FreightSession {
  readonly events: FreightAction[] = [];
  readonly checkpoints: FreightCheckpoint[] = [];
  calls = 0;
  actions = 0;
  finished = false;
  startDate = 0;
  private fixture: any;
  private started = Date.now();
  constructor(readonly world: OpenTTDRuntime, readonly spec: Spec) {}

  private async query(op: string, args: Record<string, unknown> = {}) {
    const result = await this.world.request(op, args);
    if (!result.ok) throw new Error(`${op}: ${JSON.stringify(result.data)}`);
    return result;
  }
  private async state(): Promise<State> {
    const {data} = await this.query('freight_status');
    return {...data, day: data.date - this.startDate};
  }
  private async stations(): Promise<Queue[]> {
    return (await this.query('freight_stations')).items;
  }
  private async persist() {
    await writeFile(join(this.world.folder, 'actions.json'), JSON.stringify(this.events, null, 2));
    await writeFile(join(this.world.folder, 'checkpoints.json'), JSON.stringify(this.checkpoints, null, 2));
  }
  private async checkpoint(phase: FreightCheckpoint['phase'], event: number) {
    const state = await this.state();
    const stations = await this.stations();
    const save = `frame-${String(this.checkpoints.length).padStart(4, '0')}`;
    await this.world.save(save);
    this.checkpoints.push({save: save + '.sav', state, stations, event, phase});
    await this.persist();
    return this.checkpoints.length - 1;
  }
  async start() {
    const initial = await this.world.start();
    this.startDate = initial.date;
    const {data} = await this.query('setup_supply_chain');
    this.fixture = data;
    await writeFile(join(this.world.folder, 'fixture.json'), JSON.stringify(data, null, 2));
    await this.checkpoint('start', -1);
  }
  async status() {
    const state = await this.state();
    const {forest, sawmill, destination, river_axis, river_min, river_max} = this.fixture;
    return {ok: true, location: {forest, sawmill, destination, river_axis, river_min, river_max},
      company: state, stations: await this.stations(), objective: freightObjective(state, this.spec),
      budgets: {callsRemaining: freightBudget.maximumCalls - this.calls, actionsRemaining: freightBudget.maximumActions - this.actions}};
  }
  async execute(name: FreightTool, input: unknown): Promise<any> {
    const parsed = freightTools[name]?.schema.safeParse(input);
    if (!parsed?.success) return {ok: false, message: 'Invalid tool arguments', errors: parsed?.error.flatten()};
    const args = parsed.data as Record<string, any>;
    if (this.finished) return {...await this.status(), ok: false, message: 'Session already finished'};
    if (name === 'finish_session') return this.finish(args.narration, 'agent-finished', args.visual_subject);
    if (++this.calls > freightBudget.maximumCalls || Date.now() - this.started > freightBudget.maximumWallMinutes * 60_000)
      return this.finish(undefined, 'budget-exhausted');
    if (name === 'observe') return this.status();
    if (name === 'survey') {
      const sites = await this.query('freight_sites', {...args, cargo: this.fixture[args.cargo + '_cargo']});
      const map = await this.query('map', args);
      return {ok: true, sites: sites.items, map: map.items};
    }
    if (name === 'cargo_engines') return this.query(name, {cargo: this.fixture[args.cargo + '_cargo']});
    if (name === 'bridge_options') return this.query(name, args);
    if (name === 'vehicle_info') return this.world.request('vehicle', args);
    if (++this.actions > freightBudget.maximumActions) return this.finish(undefined, 'action-budget-exhausted');
    const state = await this.state();
    const event: FreightAction = {id: this.events.length, tool: name, args, before: this.checkpoints.length - 1};
    this.events.push(event);
    await this.persist();
    if (name === 'report_narration') event.result = {ok: true};
    else if (name === 'build_vehicle' && state.trucks.length >= this.spec.maximumTrucks)
      event.result = {ok: false, error: 'Six-truck fleet limit reached'};
    else if (name === 'advance_days') {
      const days = Math.min(args.days, this.spec.proposedGoal.maximumDays - state.day);
      for (let remaining = days; remaining > 0;) {
        const current = this.checkpoints.at(-1)!;
        const hasCargo = current.state.trucks.some(truck => truck.wood || truck.goods);
        const step = Math.min(hasCargo ? 1 : 3, remaining);
        const {data} = await this.query('advance', {days: step});
        if (!data.paused || data.end_date - data.start_date !== step) throw new Error('Controlled freight time advancement failed');
        await this.checkpoint('operation', event.id);
        remaining -= step;
      }
      event.result = {ok: days > 0, daysAdvanced: days};
    } else {
      const {narration, visual_subject, ...gameArgs} = args;
      const op = name === 'toggle_vehicle' ? 'start_vehicle' : name;
      if (name === 'build_vehicle') {
        const allowed = [];
        for (const key of ['wood_cargo', 'goods_cargo'])
          allowed.push(...(await this.query('cargo_engines', {cargo: this.fixture[key]})).data);
        if (!allowed.some(engine => engine.id === gameArgs.engine)) {
          event.result = {ok: false, error: 'Choose a surveyed wood or goods truck'};
        }
      }
      if (!event.result) {
        const reply = await this.world.request(op, gameArgs);
        event.result = {ok: reply.ok, ...reply.data};
        if (reply.ok) await this.checkpoint('after', event.id);
      }
    }
    event.after = this.checkpoints.length - 1;
    await this.persist();
    const current = await this.status();
    return {...current, ...event.result};
  }
  async finish(narration?: string, reason = 'agent-finished', visual_subject?: Position) {
    if (this.finished) return this.status();
    const state = await this.state();
    const objective = freightObjective(state, this.spec);
    const id = this.events.length;
    const at = await this.checkpoint('outcome', id);
    this.events.push({id, tool: 'finish_session', args: {narration, visual_subject}, before: at, after: at, result: {ok: true}});
    await this.world.save('final');
    this.finished = true;
    const result = {actor: 'claude', status: objective.achieved ? 'success' : 'incomplete', objective, finalState: state, reason,
      actions: this.actions, calls: this.calls};
    await writeFile(join(this.world.folder, 'result.json'), JSON.stringify(result, null, 2));
    await this.persist();
    return {ok: true, ...result};
  }
}
