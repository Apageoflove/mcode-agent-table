import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { ByobError } from './protocol.js';

function schemaDir(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    try { readdirSync(join(d, 'schemas')); return join(d, 'schemas'); } catch { d = dirname(d); }
  }
  throw new Error('schemas/ directory not found');
}

type AjvLike = { addSchema(s: unknown): void; getSchema(id: string): (((v: unknown) => boolean) & { errors?: unknown }) | undefined; errorsText(e: unknown): string };
const mod = Ajv2020 as unknown as { default?: new (o: object) => AjvLike } & (new (o: object) => AjvLike);
const AjvCtor = mod.default ?? mod;
const ajv: AjvLike = new AjvCtor({ allErrors: true, strict: false });
const dir = schemaDir();
for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) ajv.addSchema(JSON.parse(readFileSync(join(dir, f), 'utf8')));

const base = 'https://byob.dev/schemas/v0.1/';
export type SchemaName = 'table-config' | 'join-request' | 'post-request' | 'owner-decision' | 'ledger-entry' | 'projection' | 'capability-card';

export function check(name: SchemaName, value: unknown): void {
  const v = ajv.getSchema(base + name + '.json');
  if (!v) throw new Error('unknown schema ' + name);
  if (!v(value)) throw new ByobError('E_SCHEMA', `${name}: ` + ajv.errorsText(v.errors));
}
