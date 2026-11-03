// HTTP + SSE transport for BYOB v0.1.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { TableHost } from './host.js';
import { ByobError, PROTOCOL, type Entry } from './protocol.js';

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'byob-protocol': PROTOCOL });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 1_000_000) throw new ByobError('E_SCHEMA', 'body too large'); chunks.push(c as Buffer); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ByobError('E_SCHEMA', 'invalid JSON'); }
}

export function createTableServer(host: TableHost, opts: { tickMs?: number } = {}): Server {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (parts[0] !== 'v0.1') return json(res, 404, { error: { code: 'E_NOT_FOUND', message: 'use /v0.1/...' } });
      if (req.method === 'GET' && parts.length === 1) return json(res, 200, { protocol: PROTOCOL, tables: host.tables.size });
      if (parts[1] !== 'tables') throw new ByobError('E_NOT_FOUND', url.pathname);
      if (req.method === 'POST' && parts.length === 2) {
        const { table, admin_token } = host.create((await readBody(req)) as never);
        return json(res, 201, { table: table.cfg.id, admin_token });
      }
      const id = parts[2];
      const t = host.get(id);
      const route = `${req.method} ${parts.slice(3).join('/').replace(/^entries\/\d+$/, 'entries/:seq').replace(/^tasks\/.+$/, 'tasks/:id')}`;
      switch (route) {
        case 'POST seats': return json(res, 201, host.join(id, (await readBody(req)) as never));
        case 'POST entries': return json(res, 201, t.post(host.auth(id, bearer), (await readBody(req)) as never));
        case 'GET projection': {
          const s = url.searchParams.get('since');
          return json(res, 200, t.projection(host.auth(id, bearer), s === null ? undefined : Number(s)));
        }
        case 'GET entries/:seq': return json(res, 200, t.expand(host.auth(id, bearer), Number(parts[4])));
        case 'GET memory': host.auth(id, bearer); return json(res, 200, t.memory());
        case 'GET tasks/:id': host.auth(id, bearer); return json(res, 200, t.task(parts[4]));
        case 'POST approvals': return json(res, 201, t.ownerDecision((await readBody(req)) as never));
        case 'POST close': host.authAdmin(id, bearer); t.close(String(((await readBody(req)) as { reason?: string }).reason ?? 'closed by admin')); return json(res, 200, t.memory());
        case 'GET ledger': host.authAdmin(id, bearer); return json(res, 200, t.entries);
        case 'GET events': {
          const seat = host.auth(id, bearer);
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'byob-protocol': PROTOCOL });
          const send = (ev: string, data: unknown) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
          send('hello', { seat, cursor: t.entries.length, floor: { holder: t.holder, grant_seq: t.grantSeq }, status: t.status });
          const onEntry = (e: Entry) => {
            if (!t.canSee(e, seat)) return;
            send('entry', { seq: e.seq, kind: e.kind, seat: e.seat, event: e.event, to: e.to, task: e.task, floor: { holder: t.holder, grant_seq: t.grantSeq }, status: t.status });
          };
          t.on('entry', onEntry);
          const ka = setInterval(() => res.write(': keepalive\n\n'), 15000);
          req.on('close', () => { t.off('entry', onEntry); clearInterval(ka); });
          return;
        }
        default: throw new ByobError('E_NOT_FOUND', `${req.method} ${url.pathname}`);
      }
    } catch (err) {
      if (err instanceof ByobError) return json(res, err.status, { error: { code: err.code, message: err.message } });
      return json(res, 500, { error: { code: 'E_INTERNAL', message: String((err as Error).message) } });
    }
  });
  const tick = setInterval(() => { for (const t of host.tables.values()) t.tick(); }, opts.tickMs ?? 1000);
  tick.unref();
  server.on('close', () => clearInterval(tick));
  return server;
}
