// MCP bridge: exposes a BYOB seat as MCP tools, so any MCP-capable agent (Grok Bot, Claude, MCode…)
// can sit at a table. The bridge runs on the owner's side: it holds that owner's key and seat token.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { Owner, SeatClient, renderPrefix, renderTail } from './client.js';
import type { CapabilityCard } from './protocol.js';

export interface BridgeOptions { url: string; table: string; owner?: Owner; seat?: SeatClient }

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const effect = z.object({ owner: z.string(), resource: z.string(), action: z.string(), args: z.record(z.string(), z.unknown()).optional() });

export function createBridge(o: BridgeOptions): McpServer {
  const server = new McpServer({ name: 'byob-table', version: '0.1.0' });
  let seat = o.seat;
  let lastCursor = 0;
  const need = () => { if (!seat) throw new Error('not seated: call byob_join first'); return seat; };
  const wrap = <A,>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
    try { return text(await fn(a)); } catch (e) { return { ...text(String((e as Error).message)), isError: true }; }
  };

  server.registerTool('byob_join', {
    description: 'Join the BYOB table as a seat signed by the configured owner key. Call once.',
    inputSchema: { seat: z.string(), bot: z.string(), role: z.string().optional(), description: z.string().optional(),
      capabilities: z.array(z.object({ resource: z.string(), actions: z.array(z.string()), requires_approval: z.boolean().optional() })).default([]) },
  }, wrap(async a => {
    if (!o.owner) throw new Error('no owner key configured (BYOB_OWNER_KEY_FILE)');
    const card: CapabilityCard = { bot: a.bot, description: a.description, capabilities: a.capabilities };
    seat = await SeatClient.join(o.url, o.table, o.owner, { seat: a.seat, role: a.role, card });
    return `seated as @${a.seat} on ${o.table}`;
  }));

  server.registerTool('byob_read_projection', {
    description: 'Read your projection: stable prefix (rules, seats, decisions) and the append-only tail since your last read. Tells you whether you hold the floor.',
    inputSchema: { since: z.number().int().optional(), include_prefix: z.boolean().default(true) },
  }, wrap(async a => {
    const s = need();
    const p = await s.projection(a.since ?? lastCursor);
    lastCursor = p.cursor;
    return `${a.include_prefix ? renderPrefix(p) + '\n\n' : ''}prefix_hash: ${p.prefix_hash}\nstatus: ${p.status}\nfloor: ${p.floor.holder ?? 'none'}${p.floor.you_have_floor ? ' (YOU)' : ''}\ncursor: ${p.cursor}\n\n${renderTail(p)}\n\nmy_tasks: ${JSON.stringify(p.my_tasks)}`;
  }));

  server.registerTool('byob_say', { description: 'Speak (requires the floor).', inputSchema: { body: z.string(), to: z.array(z.string()).optional() } },
    wrap(async a => need().say(a.body, { to: a.to })));
  server.registerTool('byob_pass', { description: 'Pass: a valid reply when you have nothing to add. Yields the floor.', inputSchema: { body: z.string().optional() } },
    wrap(async a => need().pass(a.body)));
  server.registerTool('byob_raise_hand', { description: 'Ask for the floor.', inputSchema: { body: z.string().optional() } },
    wrap(async a => need().raiseHand(a.body)));
  server.registerTool('byob_propose', {
    description: 'Propose an action. effects name the affected owner/resource/action; cross-owner effects need that owner\'s approval and are executed by that owner\'s bot.',
    inputSchema: { body: z.string(), effects: z.array(effect).min(1) },
  }, wrap(async a => need().propose(a.body, a.effects)));
  server.registerTool('byob_decide', { description: 'Post a decision (only seats in decision_by).', inputSchema: { body: z.string(), effects: z.array(effect).optional() } },
    wrap(async a => need().decide(a.body, a.effects)));
  server.registerTool('byob_approve', {
    description: 'As the OWNER (using the local owner key), approve or reject a task that affects your resources.',
    inputSchema: { task: z.string(), decision: z.enum(['approve', 'reject']), reason: z.string().optional() },
  }, wrap(async a => { if (!o.owner) throw new Error('no owner key configured'); return o.owner.decide(o.url, o.table, a.task, a.decision, a.reason); }));
  server.registerTool('byob_status', { description: 'Executor progress on a task.', inputSchema: { task: z.string(), state: z.enum(['running', 'failed']), body: z.string().optional() } },
    wrap(async a => need().status(a.task, a.state, a.body)));
  server.registerTool('byob_receipt', { description: 'Executor result for a task (then another seat must verify).', inputSchema: { task: z.string(), body: z.string(), artifact: z.unknown().optional() } },
    wrap(async a => need().receipt(a.task, a.body, a.artifact)));
  server.registerTool('byob_verify', { description: 'Independently verify another seat\'s receipt.', inputSchema: { task: z.string(), result: z.enum(['pass', 'fail']), body: z.string().optional() } },
    wrap(async a => need().verify(a.task, a.result, a.body)));
  server.registerTool('byob_memory', { description: 'Table memory: decisions and task states.', inputSchema: {} }, wrap(async () => need().memory()));
  return server;
}

/** stdio entry: BYOB_URL, BYOB_TABLE, BYOB_OWNER_KEY_FILE ({"id","publicKey","privateKey"}). Optional BYOB_SEAT + BYOB_SEAT_TOKEN to reuse a seat. */
export async function main() {
  const url = process.env.BYOB_URL ?? 'http://127.0.0.1:7341';
  const table = process.env.BYOB_TABLE;
  if (!table) throw new Error('BYOB_TABLE is required');
  let owner: Owner | undefined;
  if (process.env.BYOB_OWNER_KEY_FILE) {
    const k = JSON.parse(readFileSync(process.env.BYOB_OWNER_KEY_FILE, 'utf8'));
    owner = new Owner(k.id, { publicKey: k.publicKey, privateKey: k.privateKey });
  }
  const seat = process.env.BYOB_SEAT && process.env.BYOB_SEAT_TOKEN ? new SeatClient(url, table, process.env.BYOB_SEAT, process.env.BYOB_SEAT_TOKEN) : undefined;
  await createBridge({ url, table, owner, seat }).connect(new StdioServerTransport());
}
