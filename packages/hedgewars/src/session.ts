import {createServer, type Server} from 'node:http';
import {randomBytes} from 'node:crypto';
import type {HedgewarsMatch} from './match.js';
import {toEngineShot, toolDefinitions, type ToolName} from './tools.js';

export type SessionEvent = {at: string; seat: number; team: string; tool: string; args: unknown; narration?: string; reaction?: string; result: unknown};

/** Runs one tool call for one seat. Arguments come from a model, so they are validated here. */
export async function callTool(match: HedgewarsMatch, clan: number, tool: string, rawArgs: unknown): Promise<unknown> {
  const definition = toolDefinitions[tool as ToolName];
  if (!definition) return {ok: false, error: `Unknown tool: ${tool}`};
  const parsed = definition.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) return {ok: false, error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')};
  const args = parsed.data as any;
  switch (tool as ToolName) {
    case 'observe': return match.view(clan);
    case 'wait_for_turn': return match.waitTurn(clan);
    case 'shoot': return match.act(clan, toEngineShot(args));
    case 'walk': return match.act(clan, {kind: 'walk', facing: args.direction, ms: Math.round(args.seconds * 1000)});
    case 'jump': return match.act(clan, {kind: 'jump', facing: args.direction, high: args.kind === 'high'});
    case 'skip': return match.act(clan, {kind: 'skip'});
  }
}

export type Session = {url: string; tokens: string[]; close(): Promise<void>};

/**
 * Local HTTP endpoint the per-team MCP adapters call. Each team gets its own
 * bearer token, and the token alone decides which team a request plays for.
 */
export async function startSession(match: HedgewarsMatch, onEvent: (event: SessionEvent) => void = () => undefined): Promise<Session> {
  const tokens = match.teams.map(() => randomBytes(24).toString('hex'));
  const server: Server = createServer((request, response) => {
    const clan = tokens.findIndex(token => request.headers.authorization === `Bearer ${token}`);
    if (request.method !== 'POST' || clan < 0) { response.writeHead(403).end(); return; }
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', async () => {
      let result: unknown;
      try {
        const {tool, args} = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {tool: string; args: any};
        result = await callTool(match, clan, tool, args);
        onEvent({at: new Date().toISOString(), seat: clan, team: match.teams[clan]!, tool, args,
          ...(typeof args?.narration === 'string' ? {narration: args.narration} : {}),
          ...(typeof args?.reaction === 'string' ? {reaction: args.reaction} : {}), result});
      } catch (error) {
        result = {ok: false, error: (error as Error).message};
      }
      response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(result));
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Session server has no port');
  return {url: `http://127.0.0.1:${address.port}`, tokens,
    close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); })};
}
