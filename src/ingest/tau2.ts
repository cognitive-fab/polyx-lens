// τ²-bench — the generated corpus (TS §4.2). Sierra Research, MIT.
//
// Source: one results file from tau2-bench (`data/tau2/results/final/*.json`
// or a run of the benchmark): { info, tasks, simulations }. One file is one
// backbone × one domain × one user simulator; that is deliberate. Trajectories
// under different backbones are different corpora and are never pooled
// silently — configure one corpus per file.
//
// Mapping:
//   assistant message with tool_calls  → one `action` per call (features: speaker action, tool name; slots: arguments)
//   assistant message, text only       → agent_utterance
//   user message                       → customer_utterance (τ² classifies no intents; the first user turn is not an intent)
//   tool message                       → `system` event, result ok | failed from its error flag
//
// The benchmark's own verifier (`reward_info.reward`) is used ONLY to label
// the outcome — resolved / failed — never to author or select rules. Failed
// and abandoned trajectories are included (TS §9.4, control 2).
//
// The policy document the agent was handed is the answer key; it lives beside
// the domain data and is read only by the evaluation side.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Scalar } from '../record.ts';
import type { Adapter, RawEvent, RawInteraction } from './types.ts';

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface Message {
  role: 'assistant' | 'user' | 'tool' | 'system';
  content: string | null;
  tool_calls: ToolCall[] | null;
  turn_idx: number;
  timestamp?: string;
  error?: boolean;
  id?: string;
}

interface Simulation {
  id: string;
  task_id: string;
  trial: number;
  seed?: number;
  termination_reason: string;
  reward_info?: { reward: number };
  messages: Message[];
  start_time?: string;
}

interface Results {
  info: {
    git_commit?: string;
    seed?: number;
    agent_info?: { implementation?: string; llm?: string };
    user_info?: { llm?: string };
    environment_info?: { domain_name?: string };
  };
  tasks: Array<{ id: string; user_scenario?: { instructions?: { domain?: string } } }>;
  simulations: Simulation[];
}

const scalar = (v: unknown): Scalar => (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v));

function domainOf(doc: Results, source: string): string {
  const d = doc.info.environment_info?.domain_name ?? doc.tasks[0]?.user_scenario?.instructions?.domain;
  if (d) return d;
  const m = /_(airline|retail|telecom(?:-workflow)?|banking_knowledge|mock)_/.exec(source);
  return m?.[1] ?? 'unknown';
}

export function toRaw(sim: Simulation, index: number, file: string, domain: string, backbone: string): RawInteraction {
  const startedAt = sim.start_time ? Date.parse(sim.start_time) : index * 1_000_000;
  const events: RawEvent[] = [];
  let at = startedAt;
  sim.messages.forEach((m, mi) => {
    at = m.timestamp ? Date.parse(m.timestamp) : at + 1000;
    const path = `/simulations/${index}/messages/${mi}`;
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      m.tool_calls.forEach((t, ti) => {
        const slots: Record<string, Scalar> = {};
        for (const [k, v] of Object.entries(t.arguments ?? {})) slots[k] = scalar(v);
        events.push({ at: at + ti, features: { speaker: 'action', tool: t.name }, slots, raw: { file, path: `${path}/tool_calls/${ti}` } });
      });
      return;
    }
    if (m.role === 'assistant') {
      events.push({ at, features: { speaker: 'agent' }, slots: {}, raw: { file, path } });
      return;
    }
    if (m.role === 'user') {
      events.push({ at, features: { speaker: 'customer' }, slots: {}, raw: { file, path } });
      return;
    }
    if (m.role === 'tool') {
      events.push({ at, features: { speaker: 'system', event: 'tool_result' }, slots: {}, result: m.error ? 'failed' : 'ok', raw: { file, path } });
    }
  });
  const reward = sim.reward_info?.reward;
  const last = events[events.length - 1];
  const out: RawInteraction = {
    id: `tau2-${domain}-${sim.task_id}-${sim.trial}`,
    corpus: `tau2-${domain}`,
    // One operator per domain; the backbone as the team, so provenance across
    // backbones is a lattice level rather than a separate experiment.
    actor: { operatorId: `tau2:${domain}`, teamId: backbone },
    startedAt,
    events,
    hints: {
      task_id: sim.task_id,
      trial: sim.trial,
      backbone,
      termination: sim.termination_reason,
      expected_episodes: 1,
      ...(reward !== undefined ? { reward } : {}),
    },
  };
  if (reward !== undefined) {
    out.outcome = { label: reward >= 1 ? 'resolved' : 'failed', at: last?.at ?? startedAt, lagMs: 0, source: 'external' };
  }
  return out;
}

export function tau2Meta(source: string): Record<string, string> {
  const doc = JSON.parse(readFileSync(source, 'utf8')) as Results;
  const meta: Record<string, string> = {
    backbone: doc.info.agent_info?.llm ?? 'unknown',
    userSimulator: doc.info.user_info?.llm ?? 'unknown',
    domain: domainOf(doc, source),
  };
  if (doc.info.git_commit) meta.benchmarkCommit = doc.info.git_commit;
  if (doc.info.seed !== undefined) meta.benchmarkSeed = String(doc.info.seed);
  return meta;
}

/** One results file, or every `.json` in a directory — several backbones, one domain, for the cross-backbone experiment. */
function files(source: string): string[] {
  if (!statSync(source).isDirectory()) return [source];
  return readdirSync(source)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(source, f));
}

export const tau2Adapter: Adapter = {
  name: 'tau2',
  async read(source: string): Promise<RawInteraction[]> {
    const out: RawInteraction[] = [];
    for (const file of files(source)) {
      const doc = JSON.parse(readFileSync(file, 'utf8')) as Results;
      const domain = domainOf(doc, file);
      const backbone = doc.info.agent_info?.llm ?? 'unknown';
      // Ids carry the backbone when several are pooled, so two backbones'
      // trial 0 of task 3 are two interactions.
      const multi = statSync(source).isDirectory();
      for (const [i, s] of doc.simulations.entries()) {
        const r = toRaw(s, i, file, domain, backbone);
        if (multi) r.id = `${r.id}-${backbone}`;
        out.push(r);
      }
    }
    return out;
  },
  meta(source) {
    const fs = files(source);
    if (fs.length === 1) return tau2Meta(fs[0]!);
    const backbones = fs.map((f) => tau2Meta(f).backbone);
    return { backbone: backbones.join('+'), domain: tau2Meta(fs[0]!).domain ?? 'unknown', files: String(fs.length) };
  },
};
