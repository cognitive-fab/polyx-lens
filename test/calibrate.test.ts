// Band derivation (JF3.3, JT4.2, A4). Bands come from a labelled sample,
// never from a hand, and every gate here refuses rather than warns — each one
// is a case where a band would look reasonable and be wrong.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blocksAdjudication,
  calibrationRecord,
  deriveBands,
  modes,
  PredicateError,
  THRESHOLDS,
  type DeriveOptions,
  type Observed,
} from '../src/index.ts';

const LIMITS = {
  minCalibration: THRESHOLDS.minCalibration,
  minCalibrationPerLabel: THRESHOLDS.minCalibrationPerLabel,
  minPredicatePrecision: THRESHOLDS.minPredicatePrecision,
  minLabelSeparation: THRESHOLDS.minLabelSeparation,
};
const opts = (assertOnly = true): DeriveOptions => ({ ...LIMITS, assertOnly });

/** n values jittered across a quantum or two, as the model actually returns them. */
const around = (centre: number, n: number, spread = 2): number[] =>
  Array.from({ length: n }, (_, i) => Math.round((centre + ((i % (spread + 1)) - spread / 2) * 0.01) * 100) / 100);

/** A predicate genuinely reading the text: labels land far apart. */
const CLEAN: Observed = { true: around(0.95, 35), false: around(0.03, 32) };

test('a clean predicate seats the assert boundary just under where the true cases live', () => {
  const d = deriveBands('reason_stated', CLEAN, opts());
  // Not just above the false cluster. The highest qualifying threshold is the
  // safe one: a quantum of jitter on a false case must not reach it.
  assert.ok(d.bands.assertAt >= 0.9, `expected a boundary near the true cluster, got ${d.bands.assertAt}`);
  assert.ok(d.bands.assertAt < 0.94, 'and below the true cases themselves, or nothing asserts');
  assert.equal(d.bands.refuteAt, -1, 'assert-only was asked for');
  assert.equal(d.assertPrecision, 1);
  assert.ok(d.labelSeparation > 0.85);
});

test('an assert-only predicate withholds on every false case, and the number says so', () => {
  const d = deriveBands('reason_stated', CLEAN, opts());
  // Around half a balanced sample, because a false-labelled case is withheld
  // rather than refuted. That is the closed-world prohibition showing up as a
  // number, not a defect in the band.
  assert.ok(d.withheldFraction > 0.4 && d.withheldFraction < 0.6, `withheld ${d.withheldFraction}`);
});

test('the derived band round-trips through validateBands — a bad derivation is a bug, not a warning', () => {
  const d = deriveBands('reason_stated', CLEAN, opts());
  // deriveBands calls validateBands itself; this asserts the contract holds
  // for the value it hands back.
  assert.equal(Math.round(d.bands.assertAt * 100) / 100, d.bands.assertAt, 'quantised');
});

// ---------------------------------------------------------------------------
// Gate 1 — sample size.

test('too few labels is refused before anything is measured', () => {
  const thin: Observed = { true: around(0.95, 8), false: around(0.03, 8) };
  assert.throws(() => deriveBands('p', thin, opts()), PredicateError);
  assert.throws(() => deriveBands('p', thin, opts()), /below the required 60/);
});

test('a sample that is nearly all one label cannot measure precision on the other', () => {
  const lopsided: Observed = { true: around(0.95, 58), false: around(0.03, 4) };
  assert.throws(() => deriveBands('p', lopsided, opts()), /at least 15 of each/);
});

// ---------------------------------------------------------------------------
// Gate 2 — A4, and the measured case it exists for.

test('the fourth-quadrant predicate is refused before a band is ever drawn', () => {
  // Control B, scaled to a full sample: the prompt says outright that the
  // record may be incomplete, and the labels still barely move.
  const world: Observed = { true: around(0.17, 32, 4), false: around(0.13, 30, 4) };
  assert.throws(() => deriveBands('income_verified', world, opts()), PredicateError);
  assert.throws(() => deriveBands('income_verified', world, opts()), /not in the text/);
  assert.throws(() => deriveBands('income_verified', world, opts()), /JF2\.4/);
});

test('A4 runs before the precision search, so a Q4 predicate never reports a precision', () => {
  // This one would pass a naive precision check on its extreme tail while
  // being useless: without the separation gate, a reviewer would see a number
  // that looked like evidence.
  const world: Observed = { true: [...around(0.18, 30, 4), 0.99], false: around(0.14, 31, 4) };
  const err = (() => {
    try {
      deriveBands('sneaky', world, opts());
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  })();
  assert.ok(err, 'expected a refusal');
  assert.match(err!, /separate by/);
  assert.doesNotMatch(err!, /precision/, 'a precision figure here would read as partial credit');
});

// ---------------------------------------------------------------------------
// Gate 5 — JT4.2, the boundary placement rule.

test('modes are clusters, not local maxima: two adjacent heavy bins are both modes', () => {
  const o: Observed = { true: [...Array(20).fill(0.9), ...Array(18).fill(0.91)], false: Array(30).fill(0.02) };
  const m = modes(o);
  assert.ok(m.includes(0.9) && m.includes(0.91), 'a peak test would have kept only one of these');
  assert.ok(m.includes(0.02));
});

test('a boundary is never drawn through a cluster of samples', () => {
  const d = deriveBands('p', CLEAN, opts());
  for (const m of modes(CLEAN)) {
    assert.ok(Math.abs(d.bands.assertAt - m) > 0.02, `assertAt ${d.bands.assertAt} sits on a mode at ${m}`);
  }
});

test('a false case that scores as high as a true one makes assertion impossible, and is refused', () => {
  // The labels separate on average — so A4 passes — but the false label has a
  // tail reaching above every true case. No threshold can assert cleanly, and
  // the honest outcome is no band at all rather than a lowered bar.
  const overlapping: Observed = { true: Array(35).fill(0.9), false: [...Array(20).fill(0.05), ...Array(12).fill(0.92)] };
  assert.throws(() => deriveBands('overlapping', overlapping, opts()), PredicateError);
  assert.throws(() => deriveBands('overlapping', overlapping, opts()), /no threshold reaches an assert precision/);
  // The message has to leave the reviewer somewhere to go.
  assert.throws(() => deriveBands('overlapping', overlapping, opts()), /Sharpen the question, or leave it proposed/);
});

// ---------------------------------------------------------------------------
// The refuting half.

test('a refuting band is derived only when asked for, and only when it is earned', () => {
  const d = deriveBands('asks_a_question', CLEAN, opts(false));
  assert.ok(d.bands.refuteAt >= 0, 'a refute boundary was asked for and the sample supports one');
  assert.ok(d.refutePrecision !== null && d.refutePrecision >= 0.9);
  assert.ok(d.bands.assertAt - d.bands.refuteAt >= 0.2, 'JT4.3 still holds on a derived band');
});

test('a predicate that cannot refute is told to become assert-only, not given a worse band', () => {
  // A low probability is not reliably false here: six genuinely-true cases
  // scored as low as the false ones, so refuting on a low p would be wrong
  // about a sixth of the time.
  const o: Observed = { true: [...Array(30).fill(0.95), ...Array(6).fill(0.05)], false: Array(30).fill(0.05) };
  assert.throws(() => deriveBands('p', o, opts(false)), /Declare this predicate assert-only/);
  // …and assert-only succeeds on the same sample, which is the point: the
  // predicate is still useful, it just may never claim silence is denial.
  const d = deriveBands('p', o, opts(true));
  assert.equal(d.bands.refuteAt, -1);
  assert.ok(d.assertPrecision >= 0.9);
});

// ---------------------------------------------------------------------------
// The record, and what it gates.

test('the calibration record carries the sample it was derived from', () => {
  const d = deriveBands('p', CLEAN, opts());
  const c = calibrationRecord(d, CLEAN, { at: '2026-09-19', corpusRevision: 'abc123', alphabetVersion: 7, reviewer: 'jjd' });
  assert.equal(c.n, 67);
  assert.deepEqual(c.labels, { true: 35, false: 32 });
  assert.equal(c.observed?.true.length, 35, 'the distribution is retained: a band change must not need a fresh pass');
  assert.equal(c.labelSeparation, d.labelSeparation);
  assert.equal(blocksAdjudication(c, LIMITS), null);
});

test('adjudication is blocked by the numbers, but the tool reports rather than rules', () => {
  const d = deriveBands('p', CLEAN, opts());
  const c = calibrationRecord(d, CLEAN, { at: '2026-09-19', corpusRevision: 'abc', alphabetVersion: 7, reviewer: 'jjd' });
  const weak = { ...c, assertPrecision: 0.8 };
  assert.match(blocksAdjudication(weak, LIMITS)!, /below 0\.9 \(JF3\.4\)/);
  const unseparated = { ...c, labelSeparation: 0.037 };
  assert.match(blocksAdjudication(unseparated, LIMITS)!, /A4/);
});

test('the floors are thresholds, so they sweep and appear in every manifest', () => {
  assert.equal(THRESHOLDS.minCalibration, 60);
  assert.equal(THRESHOLDS.minCalibrationPerLabel, 15);
  assert.equal(THRESHOLDS.minPredicatePrecision, 0.9);
  assert.equal(THRESHOLDS.minLabelSeparation, 0.2);
});
