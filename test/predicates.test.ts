// The predicate set (JT2). Most of this is schema validation; two rules are
// not, and they are why the file exists — `type` is never a field, and the
// prohibited quadrant is refused at load.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activePredicates,
  inertPredicates,
  isStale,
  loadPredicateSet,
  parsePredicateSet,
  PredicateError,
  PredicateSetError,
} from '../src/index.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const HEAD = `corpus: cc
version: 1
model: jev-latest
redaction: alphabet@7
predicates:
`;

const one = (body: string) => HEAD + body.replace(/^/gm, '  ').replace(/^ {2}-/, '  -');

const PRED = `- id: reason_stated
  fact: obs.reason_stated
  status: proposed
  quadrant: text-unknown
  source: event.text
  window: event
  question: Does this message state a reason for the refund?
  bands:
    assertAt: 0.85
    refuteAt: -1
`;

test('a well-formed predicate parses, and carries no calibration until someone labels one', () => {
  const { set, warnings } = parsePredicateSet(one(PRED));
  assert.equal(set.corpus, 'cc');
  assert.equal(set.version, 1);
  assert.equal(set.redaction, 'alphabet@7');
  assert.deepEqual(warnings, []);
  const p = set.predicates[0]!;
  assert.equal(p.fact, 'obs.reason_stated');
  assert.equal(p.quadrant, 'text-unknown');
  assert.equal(p.calibration, undefined);
  assert.deepEqual(activePredicates(set), [], 'uncalibrated emits nothing');
  assert.deepEqual(inertPredicates(set).map((x) => x.reason), ['uncalibrated']);
});

// ---------------------------------------------------------------------------
// A3 — the prohibited quadrant.

test('a question about the world is refused at load, with JF2.4 named', () => {
  const src = one(PRED.replace('text-unknown', 'sequence-unknown'));
  assert.throws(() => parsePredicateSet(src), PredicateSetError);
  assert.throws(() => parsePredicateSet(src), /prohibited \(JF2\.4\)/);
  // The error has to teach the fix, not merely refuse: the reviewer who wrote
  // this predicate believed it was reasonable, and will write it again.
  assert.throws(() => parsePredicateSet(src), /what the text STATES/);
});

test('a quadrant-three predicate is a warning, not an error — the tool does not rule', () => {
  const { set, warnings } = parsePredicateSet(one(PRED.replace('text-unknown', 'sequence-closed')));
  assert.equal(set.predicates.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /write the if-statement/i);
});

test('quadrant is required, and not defaulted', () => {
  assert.throws(() => parsePredicateSet(one(PRED.replace('  quadrant: text-unknown\n', ''))), /quadrant is required/);
});

// ---------------------------------------------------------------------------
// JT2.1 / JT2.2 — one question shape, on purpose.

test("'type' is not a field, and the error says what to write instead", () => {
  const src = one(PRED + '  type: choice\n');
  assert.throws(() => parsePredicateSet(src), /'type' is not a field/);
  assert.throws(() => parsePredicateSet(src), /one assert-only predicate per alternative/);
});

// ---------------------------------------------------------------------------
// Everything else the loader refuses.

test('a fact must be namespaced obs., so it cannot be confused with a slot', () => {
  assert.throws(() => parsePredicateSet(one(PRED.replace('obs.reason_stated', 'reason_stated'))), /namespaced 'obs\.<name>'/);
  assert.throws(() => parsePredicateSet(one(PRED.replace('obs.reason_stated', 'slot.reason'))), /namespaced 'obs\.<name>'/);
});

test('two predicates may not produce the same fact, because the second would win silently', () => {
  assert.throws(() => parsePredicateSet(one(PRED + PRED.replace('id: reason_stated', 'id: other'))), /two predicates produce the fact/);
});

test('a duplicate id is refused', () => {
  assert.throws(() => parsePredicateSet(one(PRED + PRED.replace('obs.reason_stated', 'obs.other'))), /duplicate id/);
});

test('redaction must be declared, or the corpus cannot be annotated (JT7.2)', () => {
  const src = one(PRED).replace('redaction: alphabet@7\n', '');
  assert.throws(() => parsePredicateSet(src), /redaction is required/);
  assert.throws(() => parsePredicateSet(src), /cannot be annotated/);
});

test('the model id is required: a probability is a figure of one model', () => {
  assert.throws(() => parsePredicateSet(one(PRED).replace('model: jev-latest\n', '')), /model is required/);
});

test('a source must name somewhere text actually comes from', () => {
  assert.throws(() => parsePredicateSet(one(PRED.replace('event.text', 'the conversation'))), /source must be/);
  assert.doesNotThrow(() => parsePredicateSet(one(PRED.replace('source: event.text', 'source: slot.reason'))));
});

test('bands are validated at load, so a malformed band never reaches a corpus', () => {
  // JT4.3: a narrow withheld band is a closed-world assumption wearing a
  // threshold, and load is the last place to catch it cheaply.
  const narrow = PRED.replace('assertAt: 0.85', 'assertAt: 0.6').replace('refuteAt: -1', 'refuteAt: 0.55');
  assert.throws(() => parsePredicateSet(one(narrow)), PredicateError);
  const unquantised = PRED.replace('assertAt: 0.85', 'assertAt: 0.855');
  assert.throws(() => parsePredicateSet(one(unquantised)), /multiple of/);
});

// ---------------------------------------------------------------------------
// JT2.4 — inert-by-omission must not look like configured.

const CALIBRATION = `  calibration:
    at: '2026-09-19'
    corpusRevision: 9f2a1c4e8b70d331
    alphabetVersion: 7
    n: 74
    labels: { true: 41, false: 33 }
    assertPrecision: 0.95
    refutePrecision: null
    withheldFraction: 0.19
    reviewer: jjd
`;

test('status real with no calibration block fails at load', () => {
  const src = one(PRED.replace('status: proposed', 'status: real'));
  assert.throws(() => parsePredicateSet(src), /no calibration block/);
  assert.throws(() => parsePredicateSet(src), /say 'proposed' until it is calibrated/);
});

test('real and calibrated is the only combination that emits anything', () => {
  const { set } = parsePredicateSet(one(PRED.replace('status: proposed', 'status: real') + CALIBRATION));
  assert.equal(activePredicates(set).length, 1);
  assert.deepEqual(inertPredicates(set), []);
  const p = set.predicates[0]!;
  assert.equal(p.calibration?.n, 74);
  assert.equal(p.calibration?.refutePrecision, null, 'an assert-only predicate has no refute precision');
});

test('a calibration goes stale when what it was measured against moves (JF3.5)', () => {
  const { set } = parsePredicateSet(one(PRED.replace('status: proposed', 'status: real') + CALIBRATION));
  const p = set.predicates[0]!;
  assert.equal(isStale(p, '9f2a1c4e8b70d331', 7), false);
  assert.equal(isStale(p, 'a-different-corpus', 7), true);
  assert.equal(isStale(p, '9f2a1c4e8b70d331', 8), true, 'the alphabet moved, so the text the predicate reads may have');
});

// ---------------------------------------------------------------------------
// A4.1 — the window warning, from Control A.

test('a wider window warns: more context raised confidence without raising accuracy', () => {
  const { warnings } = parsePredicateSet(one(PRED.replace('source: event.text', 'source: episode.text')));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /wider window is not free/);
  assert.match(warnings[0]!.message, /without raising its accuracy/);
});

// ---------------------------------------------------------------------------
// The shipped set.

test('the shipped cc predicate set loads, and every predicate in it is inert', () => {
  const { set, warnings } = loadPredicateSet(join(ROOT, 'alphabets', 'predicates.cc.yaml'));
  assert.equal(set.corpus, 'cc');
  assert.ok(set.predicates.length >= 6);
  assert.deepEqual(warnings, [], 'nothing shipped should be reading a wider window than it needs');
  assert.deepEqual(activePredicates(set), [], 'nothing ships calibrated: a person has to label a sample first');
  assert.equal(inertPredicates(set).length, set.predicates.length);
  // Every predicate asks about a text. None asks about the world.
  for (const p of set.predicates) assert.notEqual(p.quadrant, 'sequence-unknown');
  // All but one are assert-only, because a false would otherwise read as "it
  // did not happen" rather than "the text does not say so".
  const refuting = set.predicates.filter((p) => p.bands.refuteAt >= 0);
  assert.deepEqual(refuting.map((p) => p.id), ['asks_a_question']);
  assert.equal(refuting[0]!.quadrant, 'text-closed');
});
