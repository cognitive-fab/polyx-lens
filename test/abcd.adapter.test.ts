// F1.1: three hand-checked ABCD conversations, asserted field by field.
// Fixture: test/fixtures/abcd/abcd_sample.json (extract.mjs), candidates stripped.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyAlphabet, loadAlphabet } from '../src/index.ts';
import { abcdAdapter } from '../src/index.ts';
import { FIXTURES, ROOT } from './helpers.ts';

const SOURCE = join(FIXTURES, 'abcd', 'abcd_sample.json');
const ALPHABET = join(ROOT, 'alphabets', 'alphabet.abcd.yaml');

test('abcd adapter: convo 3592 (product_defect / return_size) field by field', async () => {
  const all = await abcdAdapter.read(SOURCE);
  assert.equal(all.length, 3);
  const it = all[0]!;
  assert.equal(it.id, 'abcd-3592');
  assert.equal(it.corpus, 'abcd');
  assert.deepEqual(it.actor, { operatorId: 'abcd' });
  assert.equal(it.startedAt, 3592 * 1000);
  assert.equal(it.events.length, 29);
  assert.equal(it.outcome, undefined);
  assert.deepEqual(it.hints, {
    split: 'train',
    flow: 'product_defect',
    subflow: 'return_size',
    expected_episodes: 1,
  });
  assert.deepEqual(it.facts, {
    'customer.member_level': 'bronze',
    'order.payment_method': 'credit card',
    'order.num_products': '1',
    'order.packaging': 'yes',
    'order.state': 'ny',
  });
  // the first customer turn carries the intent; later ones do not
  assert.deepEqual(it.events[2]!.features, { speaker: 'customer', intent: 'return_size', flow: 'product_defect' });
  assert.deepEqual(it.events[4]!.features, { speaker: 'customer' });
  assert.deepEqual(it.events[0]!.features, { speaker: 'agent' });
  // actions: button in features, positional values named only when the count lines up
  const actions = it.events.filter((e) => e.features.speaker === 'action');
  assert.deepEqual(
    actions.map((e) => [e.features.button, e.slots]),
    [
      ['pull-up-account', { value_0: 'crystal minh' }], // ontology lists 2 names, 1 value
      ['validate-purchase', { username: 'cminh730', email: 'cminh730@email.com', order_id: '3348917502' }],
      ['enter-details', { value_0: '(977) 625-2661' }],
      ['notify-team', { company_team: 'manager' }],
    ],
  );
  assert.deepEqual(actions[1]!.raw, { file: SOURCE, path: '/train/0/delexed/12' });
  assert.equal(actions[1]!.at, 3592 * 1000 + 13);
  // no free text anywhere in the raw output
  for (const e of it.events) assert.equal('text' in e, false);
});

test('abcd adapter: convo 10015 (shipping_issue / manage) — verify-identity with 3 of 4 values, offer-refund', async () => {
  const it = (await abcdAdapter.read(SOURCE))[1]!;
  assert.equal(it.id, 'abcd-10015');
  const actions = it.events.filter((e) => e.features.speaker === 'action');
  assert.deepEqual(
    actions.map((e) => [e.features.button, e.slots]),
    [
      ['pull-up-account', { value_0: 'norman bouchard' }],
      ['verify-identity', { value_0: 'norman bouchard', value_1: '4vejcyvp8u', value_2: '5545781356' }],
      ['shipping-status', { shipping_option: 'in transit' }],
      ['membership', { membership_level: 'gold' }],
      ['offer-refund', { amount: '54' }],
    ],
  );
  assert.equal(it.facts?.['customer.member_level'], 'gold');
  assert.equal(it.facts?.['order.payment_method'], undefined);
});

test('abcd adapter: convo 2159 (troubleshoot_site / credit_card, dev split) — make-purchase', async () => {
  const it = (await abcdAdapter.read(SOURCE))[2]!;
  assert.equal(it.id, 'abcd-2159');
  assert.equal(it.hints?.split, 'dev');
  const actions = it.events.filter((e) => e.features.speaker === 'action');
  assert.deepEqual(
    actions.map((e) => e.features.button),
    ['pull-up-account', 'try-again', 'enter-details', 'make-purchase'],
  );
  assert.deepEqual(actions[3]!.slots, { product: 'calvin klein jeans' });
  assert.deepEqual(actions[1]!.raw, { file: SOURCE, path: '/dev/0/delexed/5' });
  // turn_count skips 6 in the source; `at` follows the source, not the index
  assert.equal(actions[1]!.at, 2159 * 1000 + 7);
});

test('abcd alphabet: every fixture event is typed, identities are hashed, categorical values survive', async () => {
  const alphabet = loadAlphabet(ALPHABET);
  const raws = await abcdAdapter.read(SOURCE);
  const typed = raws.map((r) => applyAlphabet(alphabet, r));
  for (const it of typed) for (const e of it.events) assert.notEqual(e.type, 'unknown', `${it.id} #${e.seq}`);
  const a = typed[0]!;
  assert.equal(a.events[2]!.type, 'intent:return_size');
  assert.equal(a.events[2]!.kind, 'customer_intent');
  assert.equal(a.events[4]!.type, 'customer:utterance');
  const validate = a.events.find((e) => e.type === 'action:validate_purchase')!;
  assert.match(String(validate.slots.email), /^h#/);
  assert.match(String(validate.slots.username), /^h#/);
  assert.match(String(validate.slots.order_id), /^h#/);
  const notify = a.events.find((e) => e.type === 'action:notify_team')!;
  assert.deepEqual(notify.slots, { company_team: 'manager' });
  assert.equal(a.outcome?.label, 'escalated');
  assert.deepEqual(a.facts, { 'customer.member_level': 'bronze', 'order.payment_method': 'credit card', 'order.num_products': '1', 'order.packaging': 'yes', 'order.state': 'ny' });
  const b = typed[1]!;
  const refund = b.events.find((e) => e.type === 'action:offer_refund')!;
  assert.deepEqual(refund.slots, { amount: '54' });
  assert.deepEqual(b.events.find((e) => e.type === 'action:membership')!.slots, { membership_level: 'gold' });
  assert.equal(b.outcome?.label, 'resolved');
  const c = typed[2]!;
  assert.deepEqual(c.events.find((e) => e.type === 'action:make_purchase')!.slots, { product: 'calvin klein jeans' });
  assert.match(String(c.events.find((e) => e.type === 'action:enter_details')!.slots.value_0), /^h#/);
  // a name typed into a categorical slot is hashed, not kept
  const stray = applyAlphabet(alphabet, {
    ...raws[1]!,
    events: [{ at: 1, features: { speaker: 'action', button: 'membership' }, slots: { membership_level: 'albert sanders' }, raw: { file: 'f', path: '/x' } }],
  });
  assert.match(String(stray.events[0]!.slots.membership_level), /^h#/);
});
