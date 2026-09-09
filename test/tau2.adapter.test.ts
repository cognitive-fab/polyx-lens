// F1.1: three hand-checked τ² retail simulations, asserted field by field.
// Fixture: test/fixtures/tau2/tau2_retail_sample.json (extract.mjs).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyAlphabet, loadAlphabet } from '../src/index.ts';
import { tau2Adapter, tau2Meta } from '../src/index.ts';
import { FIXTURES, ROOT } from './helpers.ts';

const SOURCE = join(FIXTURES, 'tau2', 'tau2_retail_sample.json');
const ALPHABET = join(ROOT, 'alphabets', 'alphabet.tau2-retail.yaml');

test('tau2 adapter: task 16 trial 0 — two cancellations and a return, resolved', async () => {
  const all = await tau2Adapter.read(SOURCE);
  assert.equal(all.length, 3);
  const it = all[0]!;
  assert.equal(it.id, 'tau2-retail-16-0');
  assert.equal(it.corpus, 'tau2-retail');
  assert.deepEqual(it.actor, { operatorId: 'tau2:retail', teamId: 'claude-3-7-sonnet-20250219' });
  assert.equal(it.startedAt, Date.parse('2025-06-05T14:02:20.292232'));
  assert.deepEqual(it.outcome, { label: 'resolved', at: it.events.at(-1)!.at, lagMs: 0, source: 'external' });
  assert.deepEqual(it.hints, { task_id: '16', trial: 0, backbone: 'claude-3-7-sonnet-20250219', termination: 'user_stop', expected_episodes: 1, reward: 1 });
  // 30 messages → 30 events (every assistant message with tool calls has exactly one)
  assert.equal(it.events.length, 30);
  assert.deepEqual(it.events[0]!.features, { speaker: 'agent' });
  assert.deepEqual(it.events[1]!.features, { speaker: 'customer' });
  const actions = it.events.filter((e) => e.features.speaker === 'action');
  assert.deepEqual(
    actions.map((e) => e.features.tool),
    ['find_user_id_by_name_zip', 'get_user_details', 'get_order_details', 'get_order_details', 'get_order_details', 'cancel_pending_order', 'cancel_pending_order', 'return_delivered_order_items'],
  );
  assert.deepEqual(actions[0]!.slots, { first_name: 'Fatima', last_name: 'Johnson', zip: '78712' });
  assert.deepEqual(actions[5]!.slots, { order_id: '#W5199551', reason: 'no longer needed' });
  // array arguments are carried as JSON scalars
  assert.deepEqual(actions[7]!.slots, { order_id: '#W9389413', item_ids: '["2554056026"]', payment_method_id: 'paypal_5364164' });
  assert.deepEqual(actions[5]!.raw, { file: SOURCE, path: '/simulations/0/messages/18/tool_calls/0' });
  assert.equal(actions[5]!.at, Date.parse('2025-06-05T14:02:56.320160'));
  // tool results are system events with a result
  const tool = it.events[7]!;
  assert.deepEqual(tool.features, { speaker: 'system', event: 'tool_result' });
  assert.equal(tool.result, 'ok');
  assert.deepEqual(tool.raw, { file: SOURCE, path: '/simulations/0/messages/7' });
  // timestamps are monotone
  for (let i = 1; i < it.events.length; i++) assert.ok(it.events[i]!.at >= it.events[i - 1]!.at);
  // no free text anywhere
  for (const e of it.events) assert.equal('text' in e, false);
});

test('tau2 adapter: task 0 trial 0 — a failed exchange is included and labelled failed', async () => {
  const it = (await tau2Adapter.read(SOURCE))[1]!;
  assert.equal(it.id, 'tau2-retail-0-0');
  assert.equal(it.outcome?.label, 'failed');
  assert.equal(it.hints?.reward, 0);
  const actions = it.events.filter((e) => e.features.speaker === 'action').map((e) => e.features.tool);
  assert.deepEqual(actions, ['find_user_id_by_name_zip', 'get_order_details', 'get_product_details', 'get_product_details', 'get_user_details', 'exchange_delivered_order_items']);
});

test('tau2 adapter: task 13 trial 0 — a tool error becomes result: failed', async () => {
  const it = (await tau2Adapter.read(SOURCE))[2]!;
  assert.equal(it.id, 'tau2-retail-13-0');
  const failed = it.events.filter((e) => e.features.speaker === 'system' && e.result === 'failed');
  assert.ok(failed.length >= 1);
  assert.equal(it.events.filter((e) => e.features.tool === 'find_user_id_by_email').length, 1);
});

test('tau2 meta names the backbone, simulator and benchmark commit for the manifest', () => {
  const m = tau2Meta(SOURCE);
  assert.equal(m.backbone, 'claude-3-7-sonnet-20250219');
  assert.equal(m.userSimulator, 'gpt-4.1-2025-04-14');
  assert.equal(m.domain, 'retail');
  assert.match(m.benchmarkCommit!, /^[0-9a-f]{40}$/);
});

test('tau2 alphabet: both authentication routes are one type, arguments are hashed, reasons kept', async () => {
  const alphabet = loadAlphabet(ALPHABET);
  const raws = await tau2Adapter.read(SOURCE);
  const typed = raws.map((r) => applyAlphabet(alphabet, r));
  for (const it of typed) for (const e of it.events) assert.notEqual(e.type, 'unknown', `${it.id} #${e.seq}`);
  const a = typed[0]!;
  const auth = a.events.find((e) => e.type === 'action:authenticate')!;
  assert.deepEqual(auth.slots, {}); // slots: [] — nothing kept
  const cancel = a.events.find((e) => e.type === 'action:cancel_pending_order')!;
  assert.deepEqual(cancel.slots, { reason: 'no longer needed' });
  const c = typed[2]!;
  assert.equal(c.events.filter((e) => e.type === 'action:authenticate').length, 1);
  assert.equal(a.outcome?.label, 'resolved');
  assert.equal(typed[1]!.outcome?.label, 'failed');
});
