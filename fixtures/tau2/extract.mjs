#!/usr/bin/env node
// Extract three hand-checked τ² retail simulations into a fixture, keeping
// the results-file shape (info, tasks, simulations) so the adapter reads it
// unchanged. Message `raw_data` and `usage` are stripped; nothing else is.
// Requires corpora/tau2-src (git clone of tau2-bench).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const src = join(root, 'corpora/tau2-src/data/tau2/results/final/claude-3-7-sonnet-20250219_retail_default_gpt-4.1-2025-04-14_4trials.json');
const d = JSON.parse(readFileSync(src, 'utf8'));

const has = (s, tool) => s.messages.some((m) => (m.tool_calls || []).some((t) => t.name === tool));
const pick = [
  d.simulations.find((s) => has(s, 'cancel_pending_order') && s.reward_info?.reward === 1),
  d.simulations.find((s) => has(s, 'exchange_delivered_order_items') && s.reward_info?.reward === 0),
  d.simulations.find((s) => s.messages.some((m) => m.role === 'tool' && m.error)),
];
const strip = (s) => ({
  ...s,
  messages: s.messages.map(({ raw_data, usage, cost, ...m }) => m),
});
mkdirSync(here, { recursive: true });
const out = { timestamp: d.timestamp, info: d.info, tasks: pick.map((s) => d.tasks.find((t) => t.id === s.task_id)), simulations: pick.map(strip) };
writeFileSync(join(here, 'tau2_retail_sample.json'), JSON.stringify(out, null, 1) + '\n');
for (const [i, s] of pick.entries()) {
  console.log('===', i, s.id, 'task', s.task_id, 'trial', s.trial, 'reward', s.reward_info?.reward, 'term', s.termination_reason, 'start', s.start_time);
  s.messages.forEach((m, j) => console.log(j, m.role, m.turn_idx, m.timestamp, (m.tool_calls || []).map((t) => t.name + JSON.stringify(t.arguments)).join(' ; '), m.role === 'tool' ? 'error=' + m.error : ''));
}
