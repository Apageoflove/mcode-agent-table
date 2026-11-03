// Scripted seats: deterministic brains for tests and the offline demo. No model involved.
import type { Brain, FloorAction } from '../client.js';
import type { Entry, Projection, Task } from '../protocol.js';

/** Plays a fixed list of floor actions in order, then passes. */
export function scriptedBrain(actions: (FloorAction | ((p: Projection) => FloorAction))[], hooks: Partial<Pick<Brain, 'onTask' | 'onReported'>> = {}): Brain {
  let i = 0;
  return {
    onFloor: async p => {
      const a = actions[i++];
      if (!a) return { kind: 'pass', body: 'nothing to add' };
      return typeof a === 'function' ? a(p) : a;
    },
    ...hooks,
  };
}

/** Echo seat: repeats the last visible say back, prefixed. Useful for transport smoke tests. */
export function echoBrain(prefix = 'echo'): Brain {
  return {
    onFloor: async p => {
      const last = [...p.tail].reverse().find(e => e.kind === 'say');
      return last ? { kind: 'say', body: `${prefix}: ${last.body}` } : { kind: 'pass' };
    },
  };
}

/** Deterministic verifier: checks a receipt artifact with a pure function. */
export function checkerBrain(check: (t: Task, receipt: Entry) => { result: 'pass' | 'fail'; body: string }): Brain {
  return { onFloor: async () => ({ kind: 'pass' }), onReported: async (t, r) => check(t, r) };
}
