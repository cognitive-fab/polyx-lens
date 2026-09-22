import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphabetError, applyAlphabet, builtinAlphabet, classify, consequentialTypes, loadAlphabet, parseAlphabet, recommendableTypes } from '../src/index.ts';
import { syntheticAdapter } from '../src/index.ts';
import { UNKNOWN_TYPE } from '../src/index.ts';
import { SYNTHETIC_ALPHABET, SYNTHETIC_SOURCE } from './helpers.ts';

test('the synthetic alphabet loads, and consequence-none actions are not subjects (F3.2)', () => {
  const a = loadAlphabet(SYNTHETIC_ALPHABET);
  assert.equal(a.corpus, 'synthetic');
  assert.equal(a.version, 2);
  const subjects = consequentialTypes(a);
  assert.ok(subjects.has('action:issue_refund'));
  assert.ok(subjects.has('action:escalate'));
  assert.ok(!subjects.has('action:add_note'), 'consequence: none actions are excluded from mining');
  assert.ok(!subjects.has('action:verify_identity'), 'guards are not subjects');
  // Every irreversible action carries an explicit recommendable (ACV §6.4);
  // the synthetic alphabet declares them all proposable, so the gate is inert.
  assert.deepEqual([...recommendableTypes(a)].sort(), [...subjects].sort());
});

test('recommendable: false keeps an action minable but not proposable (ACV 6.4)', () => {
  const doc = (rec: boolean) =>
    `corpus: x\nversion: 1\nevent_types:\n  - id: action:wire\n    match: { speaker: action, button: wire }\n    consequence: irreversible\n    recommendable: ${rec}\n`;
  for (const rec of [true, false]) {
    const a = parseAlphabet(doc(rec));
    // An obligation may still guard it — "never wire without approval" is
    // exactly the rule you want on an action nobody may propose.
    assert.ok(consequentialTypes(a).has('action:wire'), 'still a mining subject');
    assert.equal(recommendableTypes(a).has('action:wire'), rec);
  }
});

test('the mining floor excludes reversible actions (ACV 8.2)', () => {
  const a = parseAlphabet(
    'corpus: x\nversion: 1\nevent_types:\n' +
      '  - id: action:draft\n    match: { speaker: action, button: draft }\n    consequence: reversible\n' +
      '  - id: action:refund\n    match: { speaker: action, button: refund }\n    consequence: compensable\n',
  );
  assert.deepEqual([...consequentialTypes(a)], ['action:refund'], 'reversible is below the default floor');
  assert.deepEqual([...consequentialTypes(a, 'reversible')].sort(), ['action:draft', 'action:refund']);
});

test('identity: slots that name a thing are declared, and must be slots the event keeps', () => {
  const doc = (identity: string) =>
    `corpus: x\nversion: 1\nevent_types:\n  - id: action:edit\n    match: { speaker: action, tool: Edit }\n    consequence: compensable\n    slots: [file, ext]\n    identity: ${identity}\n`;
  assert.deepEqual(parseAlphabet(doc('[file]')).eventTypes[0]!.identity, ['file']);
  // Comparing a slot the alphabet drops would compare two absences, and every
  // edit would be "about the same file" as every read.
  assert.throws(() => parseAlphabet(doc('[path]')), /identity names path, which slots does not keep/);
  assert.throws(() => parseAlphabet(doc('file')), /identity must be a list/);
  // The shipped cc alphabet declares the file, never the extension.
  const cc = loadAlphabet(builtinAlphabet('alphabet.cc.yaml')!);
  for (const id of ['action:read_file', 'action:edit_file', 'action:write_file']) {
    assert.deepEqual(cc.eventTypes.find((t) => t.id === id)!.identity, ['file'], id);
  }
});

test('classify: first match in document order; list and scalar matches; unmatched is undefined', () => {
  const a = loadAlphabet(SYNTHETIC_ALPHABET);
  assert.equal(classify(a, { speaker: 'action', button: 'refund' })?.id, 'action:issue_refund');
  assert.equal(classify(a, { speaker: 'action', button: 'issue-refund' })?.id, 'action:issue_refund');
  assert.equal(classify(a, { speaker: 'agent' })?.id, 'agent:utterance');
  assert.equal(classify(a, { speaker: 'action', button: 'mystery-button' }), undefined);
  assert.equal(classify(a, { speaker: 'system', event: 'telemetry-ping' }), undefined);
});

test('applyAlphabet types, redacts and labels; unknown events are counted, never dropped', async () => {
  const a = loadAlphabet(SYNTHETIC_ALPHABET);
  const raw = (await syntheticAdapter.read(SYNTHETIC_SOURCE))[3]!; // syn-0004 carries a mystery-button
  const it = applyAlphabet(a, raw);
  assert.equal(it.events.length, raw.events.length);
  const types = it.events.map((e) => e.type);
  assert.ok(types.includes(UNKNOWN_TYPE));
  const unknown = it.events.find((e) => e.type === UNKNOWN_TYPE)!;
  assert.equal(unknown.kind, 'action'); // unmatched, but the speaker said action: counted as one in the audit's breakdown
  // redaction: slot-listed and pattern-scrubbed
  const intent = it.events[0]!;
  assert.equal(intent.type, 'intent:refund_request');
  assert.notEqual(intent.slots.email, raw.events[0]!.slots.email);
  assert.match(String(intent.slots.email), /^h#[0-9a-f]{24}$/);
  assert.equal(intent.slots.order_id, 'ORD-1003');
  const verify = it.events.find((e) => e.type === 'action:verify_identity')!;
  assert.match(String(verify.slots.account_id), /^account_id#[0-9a-f]{12}$/);
  // outcome from the source, and the label survives
  assert.equal(it.outcome?.label, 'resolved');
});

test('applyAlphabet derives outcomes from rules when the source gives none', async () => {
  const a = loadAlphabet(SYNTHETIC_ALPHABET);
  const raw = (await syntheticAdapter.read(SYNTHETIC_SOURCE)).find((r) => r.id === 'syn-0037')!; // escalation flow
  delete raw.outcome;
  const it = applyAlphabet(a, raw);
  assert.equal(it.outcome?.label, 'escalated');
});

test('parseAlphabet refuses the ambiguous cases', () => {
  const base = 'corpus: x\nversion: 2\nevent_types:\n';
  assert.throws(() => parseAlphabet(base + '  - id: a\n    match: {}\n'), AlphabetError);
  assert.throws(() => parseAlphabet(base + '  - id: a\n    match: { speaker: customer }\n  - id: a\n    match: { speaker: agent }\n'), /duplicate/);
  // an action must declare what it costs (ACV §6.3)
  assert.throws(() => parseAlphabet(base + '  - id: a\n    match: { speaker: action }\n'), /must declare consequence/);
  // the pair this replaced is refused, never silently translated
  assert.throws(
    () => parseAlphabet(base + '  - id: a\n    match: { speaker: action }\n    consequential: true\n    reversibility: costly\n'),
    /replaced by ACV/,
  );
  // recommendable is REQUIRED exactly where a wrong default is unbounded (ACV §6.4)
  assert.throws(
    () => parseAlphabet(base + '  - id: a\n    match: { speaker: action }\n    consequence: irreversible\n'),
    /must declare recommendable/,
  );
  // … and defaults to true below that
  assert.equal(parseAlphabet(base + '  - id: a\n    match: { speaker: action }\n    consequence: compensable\n').eventTypes[0]!.recommendable, true);
  assert.throws(() => parseAlphabet(base + '  - id: unknown\n    match: { speaker: action }\n'), /reserved/);
  assert.throws(() => parseAlphabet(base + '  - id: a\n    match: { foo: bar }\n'), /kind is required/);
  assert.throws(() => parseAlphabet('corpus: x\nversion: 0\nevent_types: []\n'), /version/);
});
