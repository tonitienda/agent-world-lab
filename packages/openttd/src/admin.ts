import net from 'node:net';
import {EventEmitter} from 'node:events';

// OpenTTD 15.3 src/network/core/tcp_admin.h. Length includes header; little endian.
export function packet(type: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  if (payload.length + 3 > 1460) throw new Error('Admin packet exceeds MTU');
  const result = Buffer.alloc(payload.length + 3);
  result.writeUInt16LE(result.length);
  result[2] = type;
  payload.copy(result, 3);
  return result;
}

export function cstring(value: string): Buffer {
  if (value.includes('\0')) throw new Error('NUL in protocol string');
  return Buffer.from(value + '\0', 'utf8');
}

export class PacketDecoder {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): {type: number; payload: Buffer}[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const result = [];
    while (this.buffer.length >= 2) {
      const length = this.buffer.readUInt16LE();
      if (length < 3 || length > 1460) throw new Error(`Invalid packet length ${length}`);
      if (this.buffer.length < length) break;
      result.push({type: this.buffer[2]!, payload: this.buffer.subarray(3, length)});
      this.buffer = this.buffer.subarray(length);
    }
    return result;
  }
}

export type Reply = {id: number; ok: boolean; data: any; items: any[]};

/** Trusted runner only. Never expose rcon/admin credentials as agent tools. */
export class AdminClient {
  private socket?: net.Socket;
  private events = new EventEmitter();
  private decoder = new PacketDecoder();
  private sequence = 0;
  private busy = false;
  private failure?: Error;

  constructor(private readonly port: number, private readonly password: string) {}

  private wait<T>(event: string, timeout: number): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.events.off(event, done); this.events.off('failed', failed); };
      const done = (value: T) => { cleanup(); resolve(value); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const timer = setTimeout(() => {
        cleanup();
        const error = new Error(`Timed out waiting for OpenTTD ${event}; action outcome may be uncertain`);
        this.fail(error);
        reject(error);
      }, timeout);
      this.events.once(event, done);
      this.events.once('failed', failed);
    });
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.events.emit('failed', error);
    this.socket?.destroy();
  }

  async connect(): Promise<void> {
    const welcome = this.wait<Buffer>('packet:104', 15_000);
    this.socket = net.createConnection({host: '127.0.0.1', port: this.port});
    this.socket.on('error', error => this.fail(error));
    this.socket.on('close', () => this.fail(new Error('OpenTTD admin connection closed')));
    this.socket.on('data', chunk => {
      try {
        for (const p of this.decoder.push(chunk)) {
          if (p.type === 100 || p.type === 101 || p.type === 102 || p.type === 106)
            throw new Error(`OpenTTD admin rejected/stopped connection: packet ${p.type}, ${p.payload.toString('hex')}`);
          if (p.type === 103 && (p.payload.length < 1 || p.payload[0] !== 3))
            throw new Error('Unsupported OpenTTD admin protocol; spike requires version 3');
          this.events.emit(`packet:${p.type}`, p.payload);
          if (p.type === 120) this.events.emit('rcon-line', p.payload.subarray(2, -1).toString());
          if (p.type === 124) {
            const message = JSON.parse(p.payload.subarray(0, -1).toString());
            this.events.emit(`reply:${message.id}`, message);
          }
        }
      } catch (error) { this.fail(error as Error); }
    });
    this.socket.once('connect', () => this.send(0, Buffer.concat([
      cstring(this.password), cstring('Agent Terrarium spike'), cstring('0.1'),
    ])));
    await welcome;
    const subscription = Buffer.alloc(4);
    subscription.writeUInt16LE(9, 0); // ADMIN_UPDATE_GAMESCRIPT
    subscription.writeUInt16LE(1 << 6, 2); // AUTOMATIC
    this.send(2, subscription);
  }

  private send(type: number, payload: Buffer): void {
    if (!this.socket || this.failure) throw this.failure ?? new Error('Not connected');
    this.socket.write(packet(type, payload));
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.failure) throw this.failure;
    if (!this.socket) throw new Error('Not connected');
    if (this.busy) throw new Error('OpenTTD spike serializes all requests');
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }

  async rcon(command: string): Promise<string[]> {
    return this.exclusive(async () => {
      const payload = cstring(command);
      packet(5, payload); // Validate before creating a pending waiter.
      const lines: string[] = [];
      const line = (value: string) => lines.push(value);
      this.events.on('rcon-line', line);
      try {
        const ended = this.wait('packet:125', 15_000);
        this.send(5, payload);
        await ended;
        return lines;
      } finally { this.events.off('rcon-line', line); }
    });
  }

  async request(op: string, args: Record<string, unknown> = {}, timeout = 30_000): Promise<Reply> {
    return this.exclusive(async () => {
      const id = ++this.sequence;
      const payload = cstring(JSON.stringify({id, op, args}));
      packet(6, payload);
      const items: unknown[] = [];
      const collect = (reply: any) => {
        if ('item' in reply) items.push(reply.item);
        else this.events.emit(`done:${id}`, {...reply, items});
      };
      this.events.on(`reply:${id}`, collect);
      try {
        const done = this.wait<Reply>(`done:${id}`, timeout);
        this.send(6, payload);
        return await done;
      } finally { this.events.off(`reply:${id}`, collect); }
    });
  }

  close(): void { this.socket?.destroy(); }
}
