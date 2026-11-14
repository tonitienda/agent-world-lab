import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameDecoder, encode, PID} from '../src/protocol.js';

test('frames are length-prefixed JSON with a NUL terminator', () => {
  const frame = encode({pid: PID.CHAT_MSG_REQ, message: 'héllo'});
  assert.equal(frame.readUInt16BE(0), frame.length);
  assert.equal(frame.at(-1), 0);
  assert.deepEqual(JSON.parse(frame.subarray(2, -1).toString('utf8')), {pid: 26, message: 'héllo'});
});

test('decoder handles fragmented and coalesced frames', () => {
  const a = encode({pid: PID.CONN_PING});
  const b = encode({pid: PID.NEW_YEAR, year: -3950, fragments: 0, turn: 2});
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(a.subarray(0, 1)), []);
  assert.deepEqual(decoder.push(a.subarray(1, 4)), []);
  const got = decoder.push(Buffer.concat([a.subarray(4), b]));
  assert.deepEqual(got.map(p => p.pid), [88, 127]);
  assert.equal(got[1]!.turn, 2);
});

test('invalid frames are rejected', () => {
  assert.throws(() => new FrameDecoder().push(Buffer.from([0, 2])), /Invalid frame/);
  assert.throws(() => new FrameDecoder().push(Buffer.from([0, 5, 0x7b, 0x7d, 0])), /without pid/);
  assert.throws(() => encode({pid: 1.5}), /integer pid/);
});

import {parseChat} from '../src/briefing.js';

test('chat markup is parsed into speaker and text', () => {
  assert.deepEqual(parseChat('[c fg="#A020F0"]*Oscar II* meet me at the river[/c]'), {from: 'Oscar II', text: 'meet me at the river', private: true});
  assert.deepEqual(parseChat('<Rama Thibodi> peace?'), {from: 'Rama Thibodi', text: 'peace?', private: false});
  assert.equal(parseChat('Game saved as x.sav'), undefined);
});
