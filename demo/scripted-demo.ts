// Offline demo: scripted seats, no model. Same protocol path as the real demo.
import { Owner, SeatClient, createTable, runSeat } from '../src/client.js';
import { scriptedBrain, checkerBrain } from '../src/adapters/scripted.js';
import { startDemo } from './lib.js';

const d = await startDemo('scripted');
const tao = new Owner('tao'), jenny = new Owner('jenny'), ops = new Owner('ops');
const T = 'agent-prio-w45';
await createTable(d.url, {
  id: T, topic: 'Which issue goes first on the team board this week: #459 or #461?',
  owners: { tao: { public_key: tao.publicKey }, jenny: { public_key: jenny.publicKey }, ops: { public_key: ops.publicKey } },
  topology: { kind: 'debate', pro: 'bot-tao', con: 'bot-jenny', judge: 'judge', rounds: 1 },
  termination: { any: ['decision', 'rounds_exhausted', { budget_tokens: 20000 }] },
});
d.live(d.host.get(T));
const card = (bot: string, caps = [] as { resource: string; actions: string[] }[]) => ({ bot, capabilities: caps });
const s1 = await SeatClient.join(d.url, T, tao, { seat: 'bot-tao', card: card('scripted') });
const s2 = await SeatClient.join(d.url, T, jenny, { seat: 'bot-jenny', card: card('scripted', [{ resource: 'taskboard', actions: ['reorder'] }]) });
const s3 = await SeatClient.join(d.url, T, ops, { seat: 'judge', card: card('scripted') });
const s4 = await SeatClient.join(d.url, T, ops, { seat: 'checker', card: card('deterministic-check') });
let board = ['#459', '#461', '#462'];
const order = ['#461', '#459', '#462'];
const runs = [
  runSeat(s1, scriptedBrain([{ kind: 'say', body: '#461 blocks the release; it should go first.' }])),
  runSeat(s2, scriptedBrain([{ kind: 'say', body: '#459 has a customer date, but it can wait two days.' }], {
    onTask: async t => { board = t.effects[0].args!.order as string[]; return { ok: true, body: 'board reordered', artifact: { taskboard: board } }; },
  })),
  runSeat(s3, scriptedBrain([{ kind: 'decision', body: '#461 first, #459 second.', effects: [{ owner: 'jenny', resource: 'taskboard', action: 'reorder', args: { order } }] }])),
  runSeat(s4, checkerBrain((t, r) => {
    const want = (t.effects[0].args as { order: string[] }).order;
    const got = (r.artifact as { taskboard: string[] }).taskboard;
    return JSON.stringify(want) === JSON.stringify(got) ? { result: 'pass', body: `board == ${JSON.stringify(want)}` } : { result: 'fail', body: `board ${JSON.stringify(got)}` };
  })),
];
const t = d.host.get(T);
while (![...t.tasks.values()].some(x => x.state === 'awaiting_approval')) await new Promise(r => setTimeout(r, 20));
const task = [...t.tasks.values()][0];
await jenny.decide(d.url, T, task.id, 'approve', 'approved by Jenny (scripted owner action)');
await Promise.all(runs);
d.finish(T, ['Scripted seats only (no model). Owner approval issued by the script with Jenny\'s owner key.']);
const final = t.task(task.id).state;
console.log(`\n${task.id}: ${final}`);
if (final !== 'verified') process.exit(1);
