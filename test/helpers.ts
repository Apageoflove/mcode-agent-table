import { Table } from '../src/table.js';
import { Owner } from '../src/client.js';
import type { TableConfig, CapabilityCard } from '../src/protocol.js';

export const owners = { tao: new Owner('tao'), jenny: new Owner('jenny'), ops: new Owner('ops') };
export type OwnerName = keyof typeof owners;

export function cfg(id: string, topology: TableConfig['topology'], extra: Partial<TableConfig> = {}): TableConfig {
  return {
    id, topic: 'test topic', topology,
    owners: Object.fromEntries(Object.values(owners).map(o => [o.id, { public_key: o.publicKey }])),
    termination: { any: ['decision', 'rounds_exhausted'] },
    ...extra,
  };
}

export const talkCard: CapabilityCard = { bot: 'test-bot', capabilities: [] };
export const boardCard: CapabilityCard = { bot: 'test-bot', capabilities: [{ resource: 'taskboard', actions: ['reorder'] }] };

export function seat(t: Table, id: string, owner: OwnerName, card = talkCard, kind: 'bot' | 'human' = 'bot') {
  return t.join(owners[owner].signJoin(t.cfg.id, { seat: id, kind, card }) as never);
}
