#!/usr/bin/env node
// Generates the OBSERVABLE fixture corpus (JT9.4). Deterministic: same code,
// same bytes. Run `node fixtures/synthetic-observable/generate.mjs` and
// commit the output; the tests read the JSON, never this script.
//
// A second corpus in the synthetic family rather than a change to the main
// fixture, because the main fixture is the oracle for everything downstream
// and forty-odd assertions rest on its exact counts. This one has ONE
// planted regularity, and it is satisfiable only through an observed fact:
//
//   O1  escalate ⇐ the customer's message STATES a double charge
//
// Ten complaints. All ten carry the same intent (`complaint`), the same
// slots, and the same events before the decision point — a verify-identity,
// which is `none` and so not a decision. Five say "charged twice" in their
// text and the FIRST consequential action is an escalation; five say
// something else and the first consequential action is a credit. Nothing in
// the typed record separates the two groups — not the intent, not a slot,
// not the event sequence before the decision point — so a rule that
// recommends escalation for the first five and not the second can only be
// conditioned on what the text said. That is the whole path, from predicate
// to fact to rule, with an oracle at the end of it.
//
// The annotation file beside this is what `polyx annotate` would have
// written had a model been asked; it was produced by a stub that reads the
// text for real, so it runs offline and is committed (JT9.4).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const ALPHA = { operator: 'op-alpha', team: 't-alpha', agents: ['a1', 'a2'] };
const ACCOUNTS = ['ACC-55667788', 'ACC-33445566'];

let n = 0;
const T0 = Date.UTC(2026, 1, 2, 9, 0, 0);
const id = () => `obs-${String(++n).padStart(4, '0')}`;
const pick = (arr, i) => arr[i % arr.length];

const customer = (intent, slots, text) => ({ speaker: 'customer', intent, slots, text });
const agent = (text) => ({ speaker: 'agent', text });
const action = (button, slots = {}) => ({ speaker: 'action', button, slots });

const interactions = [];
function add(agentIx, turns, outcome) {
  interactions.push({ id: id(), operator: ALPHA.operator, team: ALPHA.team, agent: pick(ALPHA.agents, agentIx), startedAt: T0 + interactions.length * 3_600_000, outcome, turns });
}

const DOUBLE = [
  'This is unacceptable. My account ACCOUNT was charged twice for the same order.',
  'I have been charged twice on ACCOUNT this month and nobody has explained why.',
  'Why does ACCOUNT show the same payment taken twice? I want this fixed.',
  'Two identical charges on ACCOUNT. That is a double charge and it needs escalating.',
  'ACCOUNT was billed twice for one purchase. This is the second time.',
];
const OTHER = [
  'The app keeps logging me out of ACCOUNT and it is very annoying.',
  'I could not find the statement for ACCOUNT in the portal.',
  'Your hold music on the ACCOUNT line is far too loud.',
  'My card for ACCOUNT arrived with the wrong name printed on it.',
  'I was on hold for forty minutes about ACCOUNT yesterday.',
];

// Interleaved, so neither group is a contiguous block in time and nothing
// about ordering could stand in for the text.
for (let i = 0; i < 10; i++) {
  const account = pick(ACCOUNTS, i);
  const double = i % 2 === 0;
  const text = (double ? DOUBLE[i / 2] : OTHER[(i - 1) / 2]).replace('ACCOUNT', account);
  const turns = [
    customer('complaint', { account_id: account }, text),
    agent('I am sorry to hear that. Let me look into it.'),
    action('verify-identity', { account_id: account }),
    // The decision point. The typed record is identical up to here.
    double ? action('escalate', { reason: 'billing' }) : action('offer-credit', { amount: 10 }),
    agent(double ? 'I have escalated this to a supervisor.' : 'I have applied a credit to your account.'),
  ];
  add(i, turns, double ? 'escalated' : 'resolved');
}

const corpus = { corpus: 'synthetic', interactions };
writeFileSync(join(here, 'synthetic-observable.json'), JSON.stringify(corpus, null, 1) + '\n');
console.log(`wrote ${interactions.length} interactions, ${interactions.reduce((s, i) => s + i.turns.length, 0)} turns`);
