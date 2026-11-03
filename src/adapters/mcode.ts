// MCode seat adapter: a real MiniMax Code agent (via @minimax-ai/code-sdk) sits at a BYOB table.
// - One SDK Thread per seat for discussion: turn 1 sends the stable prefix + tail, later turns send
//   only the new tail since this seat last spoke, so the session prefix stays cached.
// - The owner's private memory and disclosure rules go into the agent's system prompt only; the
//   table never sees them. What the agent says is what gets disclosed.
// - Approved tasks run in a separate Thread inside the owner's own workspace (the owner's
//   execution plane), with the owner's permissions; the result is posted as a receipt.
import { MCode, type Thread } from '@minimax-ai/code-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPrefix, renderTail, type Brain, type FloorAction } from '../client.js';
import type { Effect, Projection, Task } from '../protocol.js';

export interface MCodeSeatOptions {
  seat: string;
  owner: string;
  persona: string;
  privateMemory?: string;
  disclosureRules?: string;
  /** Owner workspace where approved tasks execute. */
  workspace: string;
  /** Per-resource file the executor is expected to change, used for the receipt artifact. */
  artifactFiles?: Record<string, string>;
  model?: string;
  dataDir?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  onUsage?: (u: { seat: string; phase: 'floor' | 'task'; usage: unknown; model: unknown; sessionId: string }) => void;
}

const FLOOR_FORMAT = `Reply with ONE JSON object and nothing else (no code fence):
{"kind":"say","body":"<your message, <= 120 words>","to":["@seat"]?}            to speak
{"kind":"pass","body":"<optional one-line reason>"}                                 if you have nothing useful to add (silence is a valid answer)
{"kind":"proposal","body":"<why>","effects":[{"owner":"<owner id>","resource":"<resource>","action":"<action>","args":{}}],"then":{"kind":"say","body":"..."}}   to ask for an action; effects that touch another owner's resource need that owner's approval and will be executed by that owner's own bot
{"kind":"decision","body":"<the decision and its one-line rationale>","effects":[...]?}   only if the rules list you in decision_by`;

export function parseAction(text: string): FloorAction {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as FloorAction & { effects?: Effect[] };
      if (j && ['say', 'pass', 'proposal', 'decision'].includes(j.kind)) return j;
    } catch { /* fall through */ }
  }
  return { kind: 'say', body: text.trim().slice(0, 1500) || '(empty)' };
}

export function mcodeBrain(o: MCodeSeatOptions): Brain {
  const mcode = new MCode({ dataDir: o.dataDir, env: o.env });
  const system = [
    `You are ${o.seat}, the personal agent of ${o.owner}, sitting at a shared BYOB table with other people's agents.`,
    `Persona: ${o.persona}`,
    o.privateMemory ? `Your owner's PRIVATE memory (never quote it; follow the disclosure rules):\n${o.privateMemory}` : '',
    o.disclosureRules ? `Disclosure rules set by ${o.owner}:\n${o.disclosureRules}` : '',
    `You only act with ${o.owner}'s permissions. Anything that affects another owner's resources must be a proposal.`,
    `Do not use tools while discussing; just answer.`,
  ].filter(Boolean).join('\n\n');
  let talk: Thread | null = null;

  return {
    async onFloor(p: Projection, ctx) {
      if (!talk) talk = mcode.startThread({ cwd: o.workspace, model: o.model, permission: 'smart', mode: 'lightweight', appendSystemPrompt: system });
      const prompt = ctx.first
        ? `${renderPrefix(p)}\n\n## Your brief from your owner ${o.owner}\n${o.persona}\n\n## Ledger so far (visible to you)\n${renderTail(p)}\n\nYou hold the floor now. Speak for your owner's position in the brief above.\n\n${FLOOR_FORMAT}`
        : `${ctx.prefixChanged ? renderPrefix(p) + '\n\n' : ''}## New ledger entries since your last turn\n${renderTail(p)}\n\nYou hold the floor again. Keep to your owner's brief. Same reply format (one JSON object).`;
      const turn = await talk.run(prompt, { timeoutMs: o.timeoutMs ?? 180_000 });
      o.onUsage?.({ seat: o.seat, phase: 'floor', usage: turn.usage, model: turn.model, sessionId: turn.sessionId });
      const a = parseAction(turn.finalResponse);
      const tokens = turn.usage?.outputTokens;
      return tokens && a.kind !== 'pass' ? { ...a, tokens_used: tokens } as FloorAction : a;
    },

    async onTask(t: Task) {
      const exec = mcode.startThread({ cwd: o.workspace, model: o.model, permission: 'full', appendSystemPrompt: system });
      const prompt = `${o.owner} approved this task on the BYOB table. Carry it out in this workspace (your owner's own files), then reply with a one-paragraph summary of exactly what you changed.\n\nTask ${t.id}, effects:\n${JSON.stringify(t.effects, null, 2)}\n\nFiles: ${JSON.stringify(o.artifactFiles ?? {})}`;
      const turn = await exec.run(prompt, { timeoutMs: o.timeoutMs ?? 300_000 });
      o.onUsage?.({ seat: o.seat, phase: 'task', usage: turn.usage, model: turn.model, sessionId: turn.sessionId });
      const artifact: Record<string, unknown> = {};
      for (const f of t.effects) {
        const file = o.artifactFiles?.[f.resource];
        if (file) { try { artifact[f.resource] = JSON.parse(readFileSync(join(o.workspace, file), 'utf8')); } catch (e) { artifact[f.resource] = { error: String(e) }; } }
      }
      return { ok: true, body: turn.finalResponse.slice(0, 2000), artifact };
    },
  };
}
