// Shared demo harness: an in-process table host on a random port, writing everything under demo/out/<name>/.
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { TableHost } from '../src/host.js';
import { JsonlStore } from '../src/store.js';
import { createTableServer } from '../src/server.js';
import { renderEntry } from '../src/client.js';
import type { Table } from '../src/table.js';

export const here = dirname(fileURLToPath(import.meta.url));

export async function startDemo(name: string) {
  const out = join(here, 'out', name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const host = new TableHost(new JsonlStore(join(out, 'data')));
  const server = createTableServer(host, { tickMs: 500 });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const live = (t: Table) => t.on('entry', e => console.log(renderEntry(e)));
  return {
    out, host, url, live,
    finish(table: string, notes: string[] = []) {
      const t = host.get(table);
      copyFileSync(join(out, 'data', `${encodeURIComponent(table)}.ledger.jsonl`), join(out, 'ledger.jsonl'));
      const md = [`# Ledger transcript: ${table}`, '', ...notes, '', '```', ...t.entries.map(renderEntry), '```', '', '## Table memory', '', '```json', JSON.stringify(t.memory(), null, 2), '```', ''].join('\n');
      writeFileSync(join(out, 'transcript.md'), md);
      server.close();
      return t;
    },
  };
}
