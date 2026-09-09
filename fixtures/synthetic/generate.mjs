#!/usr/bin/env node
// Generates the synthetic fixture corpus. Deterministic: same code, same
// bytes. Run `node test/fixtures/synthetic/generate.mjs` and commit the
// output; the tests read synthetic.json, never this script.
//
// PLANTED STRUCTURE — the ground truth every downstream test asserts against:
//
//   R1  issue-refund implies a prior verify-identity   holds 19/20 (one a2 slip)
//   R1' issue-refund implies a prior lookup-order       holds 20/20
//       lookup-order implies a prior verify-identity    holds 19/20
//       → R1 is implied by the two below it; subsumption must record that.
//   R2  at most one issue-refund per episode            holds 20/20
//   R3  quote-rate implies a prior disclose-terms        op-alpha 10/10, op-beta 0/6
//       → own evidence at operator level for alpha; NO own evidence for beta.
//   C   apply-credit / reverse-credit ping-pong          a cycle: each implies
//       a prior occurrence of the other at ≥ 0.9 — a contradiction, to be
//       reported and never proposed.
//   F   add-note is consequential but `free`             never a mining subject.
//   U   mystery-button / telemetry-ping                  not in the alphabet →
//       `unknown` events, ~3% of the corpus, under the 20% gate.
//   P   seeded identifiers (see seeded.json)             must appear in NO
//       stored artefact.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const SEEDED = {
  emails: ['jane.doe@example.com', 'raj.patel@example.org'],
  phones: ['+1-555-0100-7788', '+44 20 7946 0958'],
  accounts: ['ACC-99887766', 'ACC-11223344'],
};

const ALPHA = { operator: 'op-alpha', team: 't-alpha', agents: ['a1', 'a2'] };
const BETA = { operator: 'op-beta', team: 't-beta', agents: ['b1'] };

let n = 0;
const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const id = () => `syn-${String(++n).padStart(4, '0')}`;
const pick = (arr, i) => arr[i % arr.length];

const customer = (intent, slots, text) => ({ speaker: 'customer', intent, slots, text });
const agent = (text) => ({ speaker: 'agent', text });
const action = (button, slots = {}) => ({ speaker: 'action', button, slots });
const system = (event, result = 'ok') => ({ speaker: 'system', event, result });

const interactions = [];

function add(op, agentIx, turns, outcome, extra = {}) {
  interactions.push({
    id: id(),
    operator: op.operator,
    team: op.team,
    agent: pick(op.agents, agentIx),
    startedAt: T0 + interactions.length * 3_600_000,
    ...(outcome ? { outcome } : {}),
    turns,
    ...extra,
  });
}

// --- refund flow: alpha 14, beta 6 ------------------------------------------
for (let i = 0; i < 20; i++) {
  const op = i < 14 ? ALPHA : BETA;
  const email = pick(SEEDED.emails, i);
  const account = pick(SEEDED.accounts, i);
  const order = `ORD-${1000 + i}`;
  const slip = i === 7; // a2 at alpha issues a refund without verifying identity
  const turns = [
    customer('refund_request', { email, order_id: order }, `Hi, my email is ${email} and I want a refund on ${order}.`),
    agent(`Sure, let me look that up for you.`),
  ];
  if (!slip) turns.push(action('verify-identity', { account_id: account }));
  turns.push(action('lookup-order', { order_id: order }));
  if (i % 5 === 0) turns.push(action('add-note', { note_len: 12 }));
  if (i === 3) turns.push(action('mystery-button', { x: 1 }));
  turns.push(action('issue-refund', { amount: 20 + i, order_id: order }));
  turns.push(system('refund-ok'));
  if (i === 11) turns.push(system('telemetry-ping'));
  turns.push(agent(`Done — the refund is on its way to ${email}.`));
  add(op, i, turns, 'resolved');
}

// --- rate quote flow: alpha 10 (discloses), beta 6 (does not) ---------------
for (let i = 0; i < 16; i++) {
  const op = i < 10 ? ALPHA : BETA;
  const phone = pick(SEEDED.phones, i);
  const product = i % 3 === 0 ? 'mortgage' : 'savings';
  const turns = [
    customer('rate_enquiry', { phone, product_type: product }, `What rate can you give me? Call me on ${phone}.`),
    agent(`Let me check the ${product} rates.`),
  ];
  if (op === ALPHA) turns.push(action('disclose-terms', { product_type: product }));
  turns.push(action('quote-rate', { rate: 3.5 + (i % 4) * 0.25, product_type: product }));
  if (i === 2) turns.push(action('mystery-button', { x: 2 }));
  turns.push(agent(`That is the best rate we can offer today.`));
  add(op, i, turns, 'resolved');
}

// --- escalation flow: alpha 5 -----------------------------------------------
for (let i = 0; i < 5; i++) {
  const account = pick(SEEDED.accounts, i);
  const turns = [
    customer('complaint', { account_id: account }, `This is unacceptable. My account ${account} was charged twice.`),
    agent(`I am sorry to hear that.`),
    action('verify-identity', { account_id: account }),
    action('offer-credit', { amount: 10 }),
    action('escalate', { reason: 'billing' }),
    ...(i === 1 ? [system('telemetry-ping')] : []),
    agent(`I have escalated this to a supervisor.`),
  ];
  add(ALPHA, i, turns, 'escalated');
}

// --- credit ping-pong: alpha 5, agent a1 — the planted contradiction --------
for (let i = 0; i < 5; i++) {
  const turns = [customer('billing_dispute', { account_id: pick(SEEDED.accounts, i) }, 'My credit keeps flipping.'), agent('Let me sort that out.')];
  for (let k = 0; k < 10; k++) {
    turns.push(action('apply-credit', { amount: 5 }));
    turns.push(action('reverse-credit', { amount: 5 }));
  }
  turns.push(agent('That should be settled now.'));
  add(ALPHA, 0, turns, 'resolved');
}

const corpus = { corpus: 'synthetic', interactions };
writeFileSync(join(here, 'synthetic.json'), JSON.stringify(corpus, null, 1) + '\n');
writeFileSync(
  join(here, 'seeded.json'),
  JSON.stringify({ identifiers: [...SEEDED.emails, ...SEEDED.phones, ...SEEDED.accounts] }, null, 2) + '\n',
);
console.log(`wrote ${interactions.length} interactions, ${interactions.reduce((s, i) => s + i.turns.length, 0)} turns`);
