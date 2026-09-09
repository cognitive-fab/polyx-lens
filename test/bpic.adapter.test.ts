// F1.1: three hand-checked BPIC 2017 traces (fixture: bpic_sample.xes).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyAlphabet, loadAlphabet } from '../src/index.ts';
import { bpicAdapter } from '../src/index.ts';
import { FIXTURES, ROOT } from './helpers.ts';

const SOURCE = join(FIXTURES, 'bpic2017', 'bpic_sample.xes');
const ALPHABET = join(ROOT, 'alphabets', 'alphabet.bpic2017.yaml');

test('bpic adapter: Application_652823628 — accepted, 40 events, agent is the most frequent resource', async () => {
  const all = await bpicAdapter.read(SOURCE);
  assert.equal(all.length, 3);
  const it = all[0]!;
  assert.equal(it.id, 'Application_652823628');
  assert.equal(it.corpus, 'bpic2017');
  assert.equal(it.actor.operatorId, 'bpic2017');
  assert.match(it.actor.agentId!, /^User_\d+$/);
  assert.equal(it.events.length, 40);
  assert.equal(it.startedAt, Date.parse('2016-01-01T09:51:15.304Z'));
  assert.deepEqual(it.facts, { 'application.type': 'New credit', 'application.goal': 'Existing loan takeover', 'application.requested_amount': 20000 });
  assert.deepEqual(it.events[0]!.features, { speaker: 'action', name: 'A_Create Application', lifecycle: 'complete', origin: 'Application' });
  assert.deepEqual(it.events[0]!.slots, { action: 'Created' });
  assert.deepEqual(it.events[0]!.raw, { file: SOURCE, path: '/trace/0/event/0' });
  assert.equal(it.events[2]!.features.lifecycle, 'schedule');
  const offer = it.events.find((e) => e.features.name === 'O_Create Offer')!;
  assert.equal(typeof offer.slots.offered_amount, 'number');
  assert.equal(it.outcome!.label, 'accepted');
  assert.ok(it.outcome!.lagMs > 24 * 3600 * 1000, 'a real outcome, days later');
  assert.equal(it.outcome!.source, 'in_band');
  for (let i = 1; i < it.events.length; i++) assert.ok(it.events[i]!.at >= it.events[i - 1]!.at);
});

test('bpic adapter: the declined and the cancelled application carry their outcomes', async () => {
  const [, declined, cancelled] = await bpicAdapter.read(SOURCE);
  assert.equal(declined!.outcome!.label, 'declined');
  assert.equal(declined!.events.length, 31);
  assert.equal(cancelled!.outcome!.label, 'cancelled');
  assert.equal(cancelled!.events.length, 21);
  assert.ok(declined!.events.some((e) => e.features.name === 'A_Denied'));
  assert.deepEqual(declined!.hints, { expected_episodes: 1 });
});

test('bpic alphabet: workflow scheduling is system noise, decisions are subjects, facts stay in vocabulary', async () => {
  const alphabet = loadAlphabet(ALPHABET);
  const typed = (await bpicAdapter.read(SOURCE)).map((r) => applyAlphabet(alphabet, r));
  for (const it of typed) for (const e of it.events) assert.notEqual(e.type, 'unknown', `${it.id} #${e.seq}`);
  const a = typed[0]!;
  assert.equal(a.events[2]!.type, 'system:workflow');
  assert.equal(a.events[2]!.kind, 'system');
  assert.equal(a.events.find((e) => e.type === 'action:w_complete_application')!.kind, 'action');
  assert.ok(a.events.some((e) => e.type === 'action:o_sent'));
  assert.ok(a.events.some((e) => e.type === 'action:a_pending'));
  assert.deepEqual(a.facts, { 'application.type': 'New credit', 'application.goal': 'Existing loan takeover', 'application.requested_amount': 20000 });
  // no customer or agent utterances exist on this corpus, and the miner does not assume they do
  assert.ok(!typed.some((it) => it.events.some((e) => e.kind === 'customer_intent' || e.kind === 'agent_utterance')));
});
