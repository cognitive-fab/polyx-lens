// F1.1: fixture test asserting field-level output for at least three
// hand-checked interactions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticAdapter } from '../src/index.ts';
import { SYNTHETIC_SOURCE } from './helpers.ts';

test('synthetic adapter: syn-0001 (alpha refund, verified) field by field', async () => {
  const all = await syntheticAdapter.read(SYNTHETIC_SOURCE);
  assert.equal(all.length, 46);
  const it = all[0]!;
  assert.equal(it.id, 'syn-0001');
  assert.equal(it.corpus, 'synthetic');
  assert.deepEqual(it.actor, { operatorId: 'op-alpha', teamId: 't-alpha', agentId: 'a1' });
  assert.equal(it.startedAt, Date.UTC(2026, 0, 5, 9, 0, 0));
  assert.deepEqual(it.outcome, { label: 'resolved', at: it.events.at(-1)!.at, lagMs: 0, source: 'in_band' });
  const feats = it.events.map((e) => e.features);
  assert.deepEqual(feats, [
    { speaker: 'customer', intent: 'refund_request' },
    { speaker: 'agent' },
    { speaker: 'action', button: 'verify-identity' },
    { speaker: 'action', button: 'lookup-order' },
    { speaker: 'action', button: 'add-note' },
    { speaker: 'action', button: 'issue-refund' },
    { speaker: 'system', event: 'refund-ok' },
    { speaker: 'agent' },
  ]);
  assert.deepEqual(it.events[0]!.slots, { email: 'jane.doe@example.com', order_id: 'ORD-1000' });
  assert.deepEqual(it.events[2]!.slots, { account_id: 'ACC-99887766' });
  assert.deepEqual(it.events[5]!.slots, { amount: 20, order_id: 'ORD-1000' });
  assert.equal(it.events[6]!.result, 'ok');
  assert.equal(it.events[1]!.result, undefined);
  assert.deepEqual(it.events[5]!.raw, { file: SYNTHETIC_SOURCE, path: '/interactions/0/turns/5' });
  // timestamps: 1s apart, monotone
  for (let i = 1; i < it.events.length; i++) assert.equal(it.events[i]!.at - it.events[i - 1]!.at, 1000);
});

test('synthetic adapter: syn-0008 is the planted unverified refund at op-alpha/a2', async () => {
  const all = await syntheticAdapter.read(SYNTHETIC_SOURCE);
  const it = all[7]!;
  assert.equal(it.id, 'syn-0008');
  assert.equal(it.actor.agentId, 'a2');
  const buttons = it.events.filter((e) => e.features.speaker === 'action').map((e) => e.features.button);
  assert.deepEqual(buttons, ['lookup-order', 'issue-refund']);
});

test('synthetic adapter: syn-0031 (beta quote, no disclosure) field by field', async () => {
  const all = await syntheticAdapter.read(SYNTHETIC_SOURCE);
  const it = all[30]!;
  assert.equal(it.id, 'syn-0031');
  assert.deepEqual(it.actor, { operatorId: 'op-beta', teamId: 't-beta', agentId: 'b1' });
  const buttons = it.events.filter((e) => e.features.speaker === 'action').map((e) => e.features.button);
  assert.deepEqual(buttons, ['quote-rate']);
  assert.deepEqual(it.events[0]!.slots, { phone: '+1-555-0100-7788', product_type: 'savings' });
  assert.equal(it.events[2]!.slots.rate, 4);
});
