import { describe, it, expect } from 'vitest';
import { parseAction } from '../src/adapters/mcode.js';

describe('MCode adapter reply parsing', () => {
  it('accepts a JSON floor action, also when wrapped in prose or a fence', () => {
    expect(parseAction('{"kind":"pass","body":"nothing to add"}')).toEqual({ kind: 'pass', body: 'nothing to add' });
    expect(parseAction('Sure:\n```json\n{"kind":"say","body":"hi","to":["@x"]}\n```')).toEqual({ kind: 'say', body: 'hi', to: ['@x'] });
    const d = parseAction('{"kind":"decision","body":"go","effects":[{"owner":"jenny","resource":"taskboard","action":"reorder"}]}');
    expect(d.kind).toBe('decision');
  });
  it('falls back to a say when the model does not return JSON', () => {
    expect(parseAction('plain text answer')).toEqual({ kind: 'say', body: 'plain text answer' });
  });
});
