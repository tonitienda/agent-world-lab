import type {FreecivClient, Player, Diplstate} from './client.js';
import {DIPLSTATE} from './protocol.js';

/** What one agent is told at the start of its turn. Becomes the MCP `observe` result. */
export type Briefing = {
  turn: number;
  me: {name: string; gold: number; score: number};
  cities: Array<{id: number; name: string; size: number; x: number; y: number}>;
  units: Record<string, number>;
  rivals: RivalView[];
  inbox: Array<{from: string; text: string; private: boolean}>;
};

export type RivalView = {playerno: number; name: string; relation: string} & Record<string, unknown>;

/**
 * Freeciv chat arrives with markup, e.g. `[c fg="#A020F0"]*Oscar II* hello[/c]`
 * for a private message and `<Oscar II> hello` for a public one.
 */
export function parseChat(message: string): {from: string; text: string; private: boolean} | undefined {
  const plain = message.replace(/\[\/?[a-z]+[^\]]*\]/g, '').trim();
  const whisper = /^\*([^*]+)\*\s*(.*)$/s.exec(plain);
  if (whisper) return {from: whisper[1]!, text: whisper[2]!, private: true};
  const publicMsg = /^<([^>]+)>\s*(.*)$/s.exec(plain);
  if (publicMsg) return {from: publicMsg[1]!, text: publicMsg[2]!, private: false};
  return undefined; // server notices, not agent speech
}

/**
 * Decide what `me` may see about `rival`. This is the core fairness and drama
 * decision for the social game: the more it hides, the more agents must ask,
 * trade or spy (embassies) to learn, and the more room there is to bluff.
 */
export function rivalView(me: Player, rival: Player, relation: Diplstate | undefined): RivalView | undefined {
  const state = relation ? DIPLSTATE[relation.type] : 'no-contact';
  // TODO(human): return undefined to hide this rival entirely, or a RivalView
  // with whichever extra fields (score, gold, ...) this agent is allowed to know.
  return {playerno: rival.playerno, name: rival.name, relation: state};
}

export function briefing(client: FreecivClient, sinceChat = 0): Briefing {
  const me = client.me();
  if (!me) throw new Error(`${client.username} has no player yet`);
  const units: Record<string, number> = {};
  for (const u of client.myUnits()) units[client.unitType(u)] = (units[client.unitType(u)] ?? 0) + 1;
  const rivals = [...client.players.values()]
    .filter(p => p.playerno !== me.playerno && p.is_alive)
    .map(p => rivalView(me, p, client.diplstate(me.playerno, p.playerno)))
    .filter((v): v is RivalView => v !== undefined);
  return {
    turn: client.turn,
    me: {name: me.name, gold: me.gold, score: me.score},
    cities: client.myCities().map(c => ({id: c.id, name: c.name, size: c.size, ...client.tileXY(c.tile)})),
    units,
    rivals,
    inbox: client.chat.slice(sinceChat).map(c => parseChat(c.message)).filter(m => m !== undefined && m.from !== me.name) as Briefing['inbox'],
  };
}
