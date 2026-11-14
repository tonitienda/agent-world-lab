import {EventEmitter} from 'node:events';
import {Socket, connect} from 'node:net';
import {ACTION, CLAUSE, SSA, FrameDecoder, NETWORK_CAPSTRING, PID, encode, type Packet} from './protocol.js';

export type Player = {playerno: number; name: string; username: string; nation: number; gold: number; is_alive: boolean; phase_done: boolean; ai: boolean; score: number};
export type Unit = {id: number; owner: number; tile: number; type: number; movesleft: number; hp: number; activity: number};
export type City = {id: number; owner: number; tile: number; name: string; size: number};
export type Diplstate = {plr1: number; plr2: number; type: number; turns_left: number; contact_turns_left: number};
export type Chat = {turn: number; message: string; conn_id: number};

/**
 * A minimal Freeciv JSON-protocol player client. It keeps the state an agent
 * needs (own units, known cities, players, diplomacy, chat) and exposes the
 * handful of commands the spike uses. Every received packet is also emitted
 * as `packet`, so callers can log or extend without touching this class.
 */
export class FreecivClient extends EventEmitter {
  readonly players = new Map<number, Player>();
  readonly units = new Map<number, Unit>();
  readonly cities = new Map<number, City>();
  readonly diplstates = new Map<string, Diplstate>();
  readonly chat: Chat[] = [];
  readonly tiles = new Map<number, {terrain: number; owner: number}>();
  readonly unitTypes = new Map<number, string>();
  turn = 0;
  connId = -1;
  playerno = -1;
  map: {xsize: number; ysize: number} | undefined;
  private socket: Socket | undefined;
  private decoder = new FrameDecoder();

  constructor(readonly username: string) { super(); }

  async connect(host: string, port: number): Promise<void> {
    const socket = connect({host, port});
    this.socket = socket;
    await new Promise<void>((done, fail) => { socket.once('connect', done); socket.once('error', fail); });
    socket.on('data', chunk => { for (const packet of this.decoder.push(chunk)) this.handle(packet); });
    socket.on('error', error => this.emit('error', error));
    socket.on('close', () => this.emit('close'));
    const reply = this.next(p => p.pid === PID.SERVER_JOIN_REPLY, 10_000);
    this.send({pid: PID.SERVER_JOIN_REQ, username: this.username, capability: NETWORK_CAPSTRING,
      version_label: '', major_version: 3, minor_version: 1, patch_version: 4});
    const joined = await reply;
    if (!joined.you_can_join) throw new Error(`Join refused: ${String(joined.message)}`);
    this.connId = Number(joined.conn_id);
  }

  send(packet: Packet): void {
    if (!this.socket) throw new Error('Not connected');
    this.socket.write(encode(packet));
  }

  close(): void { this.socket?.end(); }

  /** Resolves with the first packet (from now on) that matches. */
  next(match: (p: Packet) => boolean, timeoutMs = 15_000): Promise<Packet> {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.off('packet', listener); fail(new Error(`${this.username}: timed out waiting for packet`)); }, timeoutMs);
      const listener = (p: Packet) => { if (match(p)) { clearTimeout(timer); this.off('packet', listener); done(p); } };
      this.on('packet', listener);
    });
  }

  /** Resolves once a state predicate holds, re-checking after every packet. */
  until(check: () => boolean, timeoutMs = 15_000): Promise<void> {
    if (check()) return Promise.resolve();
    return this.next(() => check(), timeoutMs).then(() => undefined);
  }

  // ---- commands --------------------------------------------------------
  say(message: string): void { this.send({pid: PID.CHAT_MSG_REQ, message}); }
  /** Freeciv private message syntax: "<player or user>: text". */
  whisper(to: string, text: string): void { this.say(`${to}: ${text}`); }
  phaseDone(): void { this.send({pid: PID.PLAYER_PHASE_DONE, turn: this.turn}); }
  foundCity(unitId: number, name: string): void {
    const unit = this.units.get(unitId);
    if (!unit) throw new Error(`Unknown unit ${unitId}`);
    this.send({pid: PID.UNIT_DO_ACTION, actor_id32: unitId, target_id: unit.tile, sub_tgt_id: 0, name, action_type: ACTION.FOUND_CITY});
  }
  /** Hand a unit to Freeciv's own server-side agent (auto explore / auto worker). */
  setAgent(unitId: number, agent: number): void { this.send({pid: PID.UNIT_SERVER_SIDE_AGENT_SET, unit_id32: unitId, agent}); }
  autoExplore(unitId: number): void { this.setAgent(unitId, SSA.AUTOEXPLORE); }
  autoWork(unitId: number): void { this.setAgent(unitId, SSA.AUTOWORKER); }
  openMeeting(counterpart: number): void { this.send({pid: PID.DIPLOMACY_INIT_MEETING_REQ, counterpart}); }
  addClause(counterpart: number, giver: number, type: number, value = 0): void {
    this.send({pid: PID.DIPLOMACY_CREATE_CLAUSE_REQ, counterpart, giver, type, value});
  }
  acceptTreaty(counterpart: number): void { this.send({pid: PID.DIPLOMACY_ACCEPT_TREATY_REQ, counterpart}); }
  cancelMeeting(counterpart: number): void { this.send({pid: PID.DIPLOMACY_CANCEL_MEETING_REQ, counterpart}); }

  // ---- queries ---------------------------------------------------------
  me(): Player | undefined { return this.players.get(this.playerno); }
  unitType(unit: Unit): string { return this.unitTypes.get(unit.type) ?? `type#${unit.type}`; }
  myUnits(): Unit[] { return [...this.units.values()].filter(u => u.owner === this.playerno); }
  myCities(): City[] { return [...this.cities.values()].filter(c => c.owner === this.playerno); }
  playerByName(name: string): Player | undefined { return [...this.players.values()].find(p => p.name === name); }
  diplstate(a: number, b: number): Diplstate | undefined { return this.diplstates.get(`${Math.min(a, b)}:${Math.max(a, b)}`); }
  tileXY(tile: number): {x: number; y: number} {
    if (!this.map) throw new Error('No map info yet');
    return {x: tile % this.map.xsize, y: Math.floor(tile / this.map.xsize)};
  }

  private handle(p: Packet): void {
    switch (p.pid) {
      case PID.CONN_PING: this.send({pid: PID.CONN_PONG}); break;
      case PID.CONN_INFO:
        if (Number(p.id) === this.connId) this.playerno = p.used ? Number(p.player_num) : -1;
        break;
      case PID.MAP_INFO: this.map = {xsize: Number(p.xsize), ysize: Number(p.ysize)}; break;
      case PID.GAME_INFO: this.turn = Number(p.turn); break;
      case PID.NEW_YEAR: this.turn = Number(p.turn); break;
      case PID.TILE_INFO: this.tiles.set(Number(p.tile), {terrain: Number(p.terrain), owner: Number(p.owner)}); break;
      case PID.PLAYER_INFO:
        this.players.set(Number(p.playerno), {playerno: Number(p.playerno), name: String(p.name), username: String(p.username),
          nation: Number(p.nation), gold: Number(p.gold), is_alive: Boolean(p.is_alive), phase_done: Boolean(p.phase_done),
          ai: Number(p.ai_skill_level) > 0 && !p.is_connected, score: Number(p.score)});
        break;
      case PID.PLAYER_DIPLSTATE: {
        const d = {plr1: Number(p.plr1), plr2: Number(p.plr2), type: Number(p.type), turns_left: Number(p.turns_left), contact_turns_left: Number(p.contact_turns_left)};
        this.diplstates.set(`${Math.min(d.plr1, d.plr2)}:${Math.max(d.plr1, d.plr2)}`, d);
        break;
      }
      case PID.UNIT_INFO: case PID.UNIT_SHORT_INFO:
        this.units.set(Number(p.id32), {id: Number(p.id32), owner: Number(p.owner), tile: Number(p.tile), type: Number(p.type),
          movesleft: Number(p.movesleft ?? 0), hp: Number(p.hp), activity: Number(p.activity)});
        break;
      case PID.UNIT_REMOVE: this.units.delete(Number(p.unit_id32)); break;
      case PID.CITY_INFO: case PID.CITY_SHORT_INFO:
        this.cities.set(Number(p.id32), {id: Number(p.id32), owner: Number(p.owner), tile: Number(p.tile), name: String(p.name), size: Number(p.size)});
        break;
      case PID.CITY_REMOVE: this.cities.delete(Number(p.city_id32)); break;
      case PID.RULESET_UNIT: this.unitTypes.set(Number(p.id), String(p.rule_name)); break;
      case PID.CHAT_MSG: this.chat.push({turn: Number(p.turn), message: String(p.message), conn_id: Number(p.conn_id)}); break;
    }
    this.emit('packet', p);
  }
}

export {CLAUSE};
