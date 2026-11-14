// Freeciv 3.1 JSON protocol framing.
// Each packet: uint16 big-endian total length (including these 2 bytes),
// then a UTF-8 JSON object with a numeric "pid", then a NUL terminator.
// Our server image is built with every packet set to no-delta, so each JSON
// packet carries all of its fields (see packages/freeciv/Dockerfile).

export const NETWORK_CAPSTRING = '+Freeciv-3.1-network city-original rsdesc32 obsinv ids32';
export const MAX_PACKET = 0xffff;

export const PID = {
  PROCESSING_STARTED: 0,
  PROCESSING_FINISHED: 1,
  SERVER_JOIN_REQ: 4,
  SERVER_JOIN_REPLY: 5,
  AUTHENTICATION_REQ: 6,
  SERVER_SHUTDOWN: 8,
  TILE_INFO: 15,
  GAME_INFO: 16,
  MAP_INFO: 17,
  CHAT_MSG: 25,
  CHAT_MSG_REQ: 26,
  CITY_INFO: 31,
  CITY_SHORT_INFO: 32,
  CITY_REMOVE: 30,
  PLAYER_INFO: 51,
  PLAYER_PHASE_DONE: 52,
  PLAYER_DIPLSTATE: 59,
  UNIT_REMOVE: 62,
  UNIT_INFO: 63,
  UNIT_SHORT_INFO: 64,
  UNIT_SERVER_SIDE_AGENT_SET: 74,
  UNIT_DO_ACTION: 84,
  CONN_PING: 88,
  CONN_PONG: 89,
  DIPLOMACY_INIT_MEETING_REQ: 95,
  DIPLOMACY_INIT_MEETING: 96,
  DIPLOMACY_CANCEL_MEETING_REQ: 97,
  DIPLOMACY_CANCEL_MEETING: 98,
  DIPLOMACY_CREATE_CLAUSE_REQ: 99,
  DIPLOMACY_CREATE_CLAUSE: 100,
  DIPLOMACY_ACCEPT_TREATY_REQ: 103,
  DIPLOMACY_ACCEPT_TREATY: 104,
  CONN_INFO: 115,
  START_PHASE: 126,
  NEW_YEAR: 127,
  BEGIN_TURN: 128,
  END_TURN: 129,
  RULESET_UNIT: 140,
} as const;

/** action_type values from common/actions.h (3.1). */
export const ACTION = {ESTABLISH_EMBASSY_STAY: 1, FOUND_CITY: 27, JOIN_CITY: 28} as const;
/** server_side_agent values from common/unit.h. */
export const SSA = {NONE: 0, AUTOWORKER: 1, AUTOEXPLORE: 2} as const;
/** clause_type values from common/diptreaty.h. */
export const CLAUSE = {ADVANCE: 0, GOLD: 1, MAP: 2, SEAMAP: 3, CITY: 4, CEASEFIRE: 5, PEACE: 6, ALLIANCE: 7, VISION: 8, EMBASSY: 9} as const;
/** diplstate_type values from common/player.h. */
export const DIPLSTATE = ['armistice', 'war', 'ceasefire', 'peace', 'alliance', 'no-contact', 'team'] as const;

export type Packet = {pid: number; [field: string]: unknown};

export function encode(packet: Packet): Buffer {
  if (!Number.isInteger(packet.pid)) throw new Error('Packet needs an integer pid');
  const body = Buffer.from(JSON.stringify(packet), 'utf8');
  const length = body.length + 3;
  if (length > MAX_PACKET) throw new Error(`Packet ${packet.pid} too large (${length} bytes)`);
  const frame = Buffer.alloc(length);
  frame.writeUInt16BE(length, 0);
  body.copy(frame, 2);
  return frame; // final byte stays 0: NUL terminator
}

/** Reassembles frames across TCP chunk boundaries. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Packet[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out: Packet[] = [];
    while (this.buffer.length >= 2) {
      const length = this.buffer.readUInt16BE(0);
      if (length < 3) throw new Error(`Invalid frame length ${length}`);
      if (this.buffer.length < length) break;
      let end = length;
      while (end > 2 && this.buffer[end - 1] === 0) end--;
      const text = this.buffer.subarray(2, end).toString('utf8');
      this.buffer = this.buffer.subarray(length);
      const parsed = JSON.parse(text) as Packet;
      if (typeof parsed?.pid !== 'number') throw new Error(`Frame without pid: ${text.slice(0, 80)}`);
      out.push(parsed);
    }
    return out;
  }
}
