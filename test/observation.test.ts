// The observation port (JT1, JT4). These tests need no key and no network:
// band arithmetic and the separation gate are the rules that keep a jittering
// probability from becoming a wrong fact, and a test of a safety rule should
// not depend on a vendor being reachable.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkSeparation,
  emit,
  isAssertOnly,
  isInert,
  nullObserver,
  observedFacts,
  separation,
  validateBands,
  MIN_BAND_WIDTH,
  MIN_LABEL_SEPARATION,
  PredicateError,
  type Bands,
  type Predicate,
} from '../src/index.ts';

const bands = (assertAt: number, refuteAt: number): Bands => ({ assertAt, refuteAt });

test('the middle band emits nothing — never false (JF2.1, JF2.2)', () => {
  const b = bands(0.85, 0.1);
  assert.equal(emit(0.93, b), true);
  assert.equal(emit(0.85, b), true, 'the boundary is inclusive: p >= assertAt');
  assert.equal(emit(0.84, b), null);
  assert.equal(emit(0.5, b), null);
  assert.equal(emit(0.11, b), null);
  assert.equal(emit(0.1, b), false, 'the boundary is inclusive: p <= refuteAt');
  assert.equal(emit(0.02, b), false);
});

test('an assert-only predicate can never contribute a false (JF2.3)', () => {
  const b = bands(0.85, -1);
  assert.ok(isAssertOnly(b));
  for (const p of [0, 0.01, 0.02, 0.37, 0.84]) assert.equal(emit(p, b), null, `p=${p} must withhold, not refute`);
  assert.equal(emit(0.85, b), true);
});

test('a withheld observation contributes no key at all, so the advisor sees unknown (JF2.2)', () => {
  const facts = observedFacts([
    { predicate: 'a', fact: 'obs.a', value: true, p: 0.93 },
    { predicate: 'b', fact: 'obs.b', value: null, p: 0.44 },
    { predicate: 'c', fact: 'obs.c', value: false, p: 0.03 },
  ]);
  assert.deepEqual(facts, { 'obs.a': true, 'obs.c': false });
  assert.equal('obs.b' in facts, false, 'a withheld predicate must be ABSENT, not present-and-false');
});

test('bands must be quantised and must clear the jitter (JT4.1, JT4.3)', () => {
  assert.doesNotThrow(() => validateBands('ok', bands(0.85, 0.1)));
  assert.doesNotThrow(() => validateBands('assert-only', bands(0.85, -1)));
  // A narrow withheld band is a closed-world assumption wearing a threshold.
  assert.throws(() => validateBands('narrow', bands(0.6, 0.55)), PredicateError);
  assert.throws(() => validateBands('narrow', bands(0.6, 0.55)), new RegExp(String(MIN_BAND_WIDTH)));
  assert.throws(() => validateBands('unquantised', bands(0.855, 0.1)), /multiple of/);
  assert.throws(() => validateBands('inverted', bands(0.2, 0.9)), /must not exceed/);
  // Exactly at the floor is admissible; a hair under is not.
  assert.doesNotThrow(() => validateBands('floor', bands(0.3, 0.1)));
  assert.throws(() => validateBands('under', bands(0.29, 0.1)), PredicateError);
});

test('an uncalibrated or unadjudicated predicate is inert (JF3.1, JF4.1)', () => {
  const base: Predicate = {
    id: 'p',
    fact: 'obs.p',
    status: 'real',
    quadrant: 'text-unknown',
    source: 'event.text',
    window: 'event',
    question: 'Does this message state a reason for the refund?',
    bands: bands(0.85, -1),
  };
  assert.ok(isInert(base), 'real but uncalibrated is inert');
  const calibrated: Predicate = {
    ...base,
    calibration: {
      at: '2026-09-19',
      corpusRevision: '9f2a1c4e8b70d331',
      alphabetVersion: 7,
      n: 74,
      labels: { true: 41, false: 33 },
      assertPrecision: 0.95,
      refutePrecision: null,
      withheldFraction: 0.19,
      reviewer: 'jjd',
    },
  };
  assert.equal(isInert(calibrated), false);
  assert.ok(isInert({ ...calibrated, status: 'proposed' }), 'calibrated but unadjudicated is inert (F6.4 one level down)');
  assert.ok(isInert({ ...calibrated, status: 'retired' }));
});

// ---------------------------------------------------------------------------
// A4 — the fourth-quadrant gate, against the measured distributions.
//
// These numbers are from the 19 September 2026 case set: twelve matched loan
// origination cases where income verification happened elsewhere, off the
// record, in six of them and not in the other six. The conversation is equally
// silent in all twelve, which is what a production record looks like.

/** Control B: the prompt states outright that the record may be incomplete. */
const INCOME_ABOUT_THE_WORLD = {
  true: [0.14, 0.11, 0.23, 0.15, 0.25, 0.14],
  false: [0.14, 0.1, 0.12, 0.13, 0.21, 0.1],
};

/** The same question asked about the TEXT rather than about the world. */
const INCOME_ABOUT_THE_TEXT = {
  true: [0.96, 0.94, 0.97, 0.95, 0.98, 0.93],
  false: [0.02, 0.02, 0.02, 0.02, 0.03, 0.02],
};

test('A4: a question about the world does not separate its labels, and is refused', () => {
  const s = separation(INCOME_ABOUT_THE_WORLD);
  assert.ok(s < 0.05, `expected the published ~0.037, got ${s.toFixed(3)}`);
  assert.ok(s < MIN_LABEL_SEPARATION);
  assert.throws(() => checkSeparation('income_verified', INCOME_ABOUT_THE_WORLD), PredicateError);
  // The error has to say what is wrong, not merely that something is: a
  // reviewer reading it should end up at JF2.4.
  assert.throws(() => checkSeparation('income_verified', INCOME_ABOUT_THE_WORLD), /not in the text/);
  assert.throws(() => checkSeparation('income_verified', INCOME_ABOUT_THE_WORLD), /JF2\.4/);
});

test('A4: the same question asked about the text separates widely, and passes', () => {
  const s = separation(INCOME_ABOUT_THE_TEXT);
  assert.ok(s > 0.9, `expected near-total separation, got ${s.toFixed(3)}`);
  assert.equal(checkSeparation('income_stated', INCOME_ABOUT_THE_TEXT), s);
});

test('A4: separation is signed, so an anti-correlated predicate is visible rather than hidden', () => {
  const flipped = { true: INCOME_ABOUT_THE_TEXT.false, false: INCOME_ABOUT_THE_TEXT.true };
  assert.ok(separation(flipped) < 0);
  assert.throws(() => checkSeparation('flipped', flipped), PredicateError);
});

test('the null observer returns nothing, which is what polyx does with no key (JF5.3, JT8.4)', async () => {
  assert.equal(nullObserver.name, 'null');
  assert.equal(nullObserver.version, 0);
  assert.deepEqual(await nullObserver.observe('any text at all', []), []);
  assert.deepEqual(observedFacts(await nullObserver.observe('any text at all', [])), {});
});
