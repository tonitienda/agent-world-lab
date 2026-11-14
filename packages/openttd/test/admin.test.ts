import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {AdminClient, PacketDecoder, packet, cstring} from '../src/admin.js';

test('admin framing preserves fragmented and coalesced packets', () => {
  const decoder = new PacketDecoder();
  const first = packet(124, cstring('{"id":1,"ok":true}'));
  const second = packet(125);
  assert.deepEqual(decoder.push(first.subarray(0, 1)), []);
  assert.deepEqual(decoder.push(first.subarray(1, 5)), []);
  const decoded = decoder.push(Buffer.concat([first.subarray(5), second]));
  assert.deepEqual(decoded.map(p => p.type), [124, 125]);
  assert.equal(decoded[0]!.payload.subarray(0, -1).toString(), '{"id":1,"ok":true}');
});

test('invalid framing and unsafe strings are rejected', () => {
  assert.throws(() => new PacketDecoder().push(Buffer.from([2, 0])), /Invalid packet/);
  assert.throws(() => new PacketDecoder().push(Buffer.from([255, 255])), /Invalid packet/);
  assert.throws(() => packet(6, Buffer.alloc(1460)), /MTU/);
  assert.throws(() => cstring('one\0two'), /NUL/);
});

test('client uses real packet IDs, collects streamed items, and rejects concurrent requests', async t => {
  const seen: number[] = [];
  const server = createServer(socket => {
    const decoder = new PacketDecoder();
    socket.on('data', chunk => {
      for (const p of decoder.push(chunk)) {
        seen.push(p.type);
        if (p.type === 0) socket.write(Buffer.concat([packet(103, Buffer.from([3, 0])), packet(104)]));
        if (p.type === 2) {
          assert.equal(p.payload.readUInt16LE(0), 9);
          assert.equal(p.payload.readUInt16LE(2), 64);
        }
        if (p.type === 5) socket.write(Buffer.concat([
          packet(120, Buffer.concat([Buffer.from([0, 0]), cstring('saved')])), packet(125),
        ]));
        if (p.type === 6) {
          const request = JSON.parse(p.payload.subarray(0, -1).toString());
          socket.write(Buffer.concat([
            packet(124, cstring(JSON.stringify({id: request.id, item: {x: 4}}))),
            packet(124, cstring(JSON.stringify({id: request.id, ok: true, data: {count: 1}}))),
          ]));
        }
      }
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const client = new AdminClient((server.address() as {port: number}).port, 'test-only');
  t.after(() => client.close());
  await client.connect();
  assert.deepEqual(await client.rcon('save test'), ['saved']);
  const pending = client.request('sites', {x: 2, y: 2, radius: 1});
  await assert.rejects(client.request('observe'), /serializes/);
  const result = await pending;
  assert.deepEqual(result.items, [{x: 4}]);
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [0, 2, 5, 6]);
});

test('disconnect rejects an outstanding action instead of hanging or retrying it', async t => {
  const server = createServer(socket => {
    const decoder = new PacketDecoder();
    socket.on('data', chunk => {
      for (const p of decoder.push(chunk)) {
        if (p.type === 0) socket.write(packet(104));
        if (p.type === 6) socket.destroy();
      }
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const client = new AdminClient((server.address() as {port: number}).port, 'test-only');
  t.after(() => client.close());
  await client.connect();
  await assert.rejects(client.request('build_stop'), /connection closed/);
  await assert.rejects(client.request('observe'), /connection closed/);
});

test('an uncertain action timeout closes the client and blocks further actions', async t => {
  const server = createServer(socket => {
    const decoder = new PacketDecoder();
    socket.on('data', chunk => {
      for (const p of decoder.push(chunk)) if (p.type === 0) socket.write(packet(104));
      // Deliberately never acknowledge a Game Script action.
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const client = new AdminClient((server.address() as {port: number}).port, 'test-only');
  t.after(() => client.close());
  await client.connect();
  await assert.rejects(client.request('build_stop', {}, 25), /outcome may be uncertain/);
  await assert.rejects(client.request('build_stop'), /outcome may be uncertain/);
});

test('unsupported admin protocol rejects the handshake', async t => {
  const server = createServer(socket => socket.once('data', () => socket.write(packet(103, Buffer.from([4, 0])))));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const client = new AdminClient((server.address() as {port: number}).port, 'test-only');
  t.after(() => client.close());
  await assert.rejects(client.connect(), /Unsupported OpenTTD admin protocol/);
});
