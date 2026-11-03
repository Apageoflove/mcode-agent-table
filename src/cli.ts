#!/usr/bin/env node
// byob CLI: serve a table host, generate owner keys, create tables, join, post, read, approve.
import { readFileSync, writeFileSync } from 'node:fs';
import { TableHost } from './host.js';
import { JsonlStore } from './store.js';
import { createTableServer } from './server.js';
import { generateOwnerKeys } from './crypto.js';
import { Owner, SeatClient, createTable, renderPrefix, renderTail } from './client.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
const pos: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? 'true' : rest[++i];
  else pos.push(rest[i]);
}
const url = flags.url ?? process.env.BYOB_URL ?? 'http://127.0.0.1:7341';
const loadOwner = (f: string) => { const k = JSON.parse(readFileSync(f, 'utf8')); return new Owner(k.id, { publicKey: k.publicKey, privateKey: k.privateKey }); };
const seatFrom = (f: string) => { const s = JSON.parse(readFileSync(f, 'utf8')); return new SeatClient(s.url, s.table, s.seat, s.token); };

const usage = `byob — BYOB Table Protocol v0.1 reference CLI

  byob serve [--port 7341] [--data ./data]
  byob keygen <owner-id> --out owner.json            Ed25519 owner key (keep private)
  byob create <table-config.json>                    prints admin token
  byob join <table> --owner owner.json --seat <id> [--role r] [--bot name] [--card card.json] [--human] --out seat.json
  byob read --seat seat.json [--since N]             projection (prefix + tail)
  byob say --seat seat.json <text> [--to @x]
  byob pass --seat seat.json [text]
  byob propose --seat seat.json <text> --effects '[{"owner":..,"resource":..,"action":..}]'
  byob approve <table> <task> --owner owner.json [--reject] [--reason text]
  byob mcp                                           MCP stdio bridge (env BYOB_URL, BYOB_TABLE, BYOB_OWNER_KEY_FILE)
`;

async function run() {
  switch (cmd) {
    case 'serve': {
      const host = new TableHost(new JsonlStore(flags.data ?? './data'));
      const port = Number(flags.port ?? 7341);
      createTableServer(host).listen(port, '127.0.0.1', () => console.log(`byob table host on http://127.0.0.1:${port}/v0.1 (data: ${flags.data ?? './data'})`));
      return;
    }
    case 'keygen': {
      const k = generateOwnerKeys();
      const out = flags.out ?? `${pos[0]}.owner.json`;
      writeFileSync(out, JSON.stringify({ id: pos[0], ...k }, null, 2), { mode: 0o600 });
      console.log(`wrote ${out}; public key: ${k.publicKey}`);
      return;
    }
    case 'create': return console.log(JSON.stringify(await createTable(url, JSON.parse(readFileSync(pos[0], 'utf8')))));
    case 'join': {
      const card = flags.card ? JSON.parse(readFileSync(flags.card, 'utf8')) : { bot: flags.bot ?? 'cli', capabilities: [] };
      const s = await SeatClient.join(url, pos[0], loadOwner(flags.owner), { seat: flags.seat, role: flags.role, kind: flags.human ? 'human' : 'bot', card });
      writeFileSync(flags.out ?? `${flags.seat}.seat.json`, JSON.stringify({ url, table: pos[0], seat: s.seat, token: s.token }), { mode: 0o600 });
      return console.log(`seated @${s.seat}`);
    }
    case 'read': {
      const p = await seatFrom(flags.seat).projection(flags.since ? Number(flags.since) : 0);
      return console.log(`${renderPrefix(p)}\n\nfloor: ${p.floor.holder}${p.floor.you_have_floor ? ' (you)' : ''}  status: ${p.status}\n\n${renderTail(p)}`);
    }
    case 'say': return console.log(JSON.stringify(await seatFrom(flags.seat).say(pos.join(' '), { to: flags.to?.split(',') })));
    case 'pass': return console.log(JSON.stringify(await seatFrom(flags.seat).pass(pos.join(' ') || undefined)));
    case 'propose': return console.log(JSON.stringify(await seatFrom(flags.seat).propose(pos.join(' '), JSON.parse(flags.effects))));
    case 'approve': return console.log(JSON.stringify(await loadOwner(flags.owner).decide(url, pos[0], pos[1], flags.reject ? 'reject' : 'approve', flags.reason)));
    case 'mcp': { const { main } = await import('./mcp.js'); return main(); }
    default: console.log(usage);
  }
}
run().catch(e => { console.error(e.message); process.exit(1); });
