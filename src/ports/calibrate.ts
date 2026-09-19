// Band derivation (JF3.3, JT4.2, A4). Bands are DERIVED from a labelled
// sample, never set by hand and never defaulted, and this is where that
// happens. Pure arithmetic over numbers a person produced: no model call, no
// key, no network — which is why it lives in the free half, and why a test of
// a safety rule runs everywhere.
//
// The gates run in a deliberate order, cheapest and most fundamental first.
// Each one refuses rather than warns, because every one of them is a case
// where a band would look reasonable and be wrong:
//
//   1. sample size          too few labels and every figure below is noise
//   2. label separation     A4 — the predicate is not reading the text at all
//   3. achievable precision no threshold reaches the required precision
//   4. band width           JT4.3 — a narrow withheld band is a closed world
//   5. boundary placement   JT4.2 — a boundary drawn through a cluster
//
// Gate 2 is the one that is easy to skip and expensive to skip. A predicate
// that is secretly asking about the world rather than about the text will
// still produce a precision figure on a small sample, and it will still look
// like a band can be drawn. What it will not produce is separation between
// the labels. Checking that first means no effort is spent drawing a boundary
// on a distribution that does not move.
import {
  checkSeparation,
  separation,
  validateBands,
  PredicateError,
  MIN_BAND_WIDTH,
  QUANTUM,
  type Bands,
  type Calibration,
} from './observation.ts';

/** The labelled sample a reviewer produced: the observed `p` under each label. */
export interface Observed {
  true: number[];
  false: number[];
}

export interface CalibrationLimits {
  /** Total labelled items required (JF3.2). */
  minCalibration: number;
  /** …of which at least this many on each label. */
  minCalibrationPerLabel: number;
  /** A band may not be drawn below this assert precision (JF3.4). */
  minPredicatePrecision: number;
  /** A4 — below this the predicate is refused outright. */
  minLabelSeparation: number;
}

export interface DerivedBands {
  bands: Bands;
  assertPrecision: number;
  refutePrecision: number | null;
  withheldFraction: number;
  labelSeparation: number;
  /** Boundaries rejected on the way, with the reason — shown to the reviewer. */
  rejected: Array<{ at: number; why: string }>;
}

const q = (v: number): number => Math.round(v * 100) / 100;

/**
 * The thresholds worth trying: every quantum step from 0.01 to 1.00. There are
 * a hundred of them and the sample is sixty items, so an exhaustive scan is
 * both exact and instant. Anything cleverer would only be harder to explain to
 * the reviewer whose judgement this is supposed to support.
 */
const STEPS: number[] = Array.from({ length: 100 }, (_, i) => q((i + 1) / 100));

/**
 * Bins holding enough of the sample that a boundary through them would convert
 * jitter directly into flapping facts (JT4.2).
 *
 * A "mode" here is any quantum bin carrying at least a twentieth of the
 * sample, or two items, whichever is larger — not a local maximum. A local
 * maximum is the wrong test: two adjacent bins each holding a tenth of the
 * sample are a cluster, and only one of them is a peak.
 */
export function modes(observed: Observed): number[] {
  const all = [...observed.true, ...observed.false];
  const counts = new Map<number, number>();
  for (const p of all) counts.set(q(p), (counts.get(q(p)) ?? 0) + 1);
  const floor = Math.max(2, Math.ceil(all.length / 20));
  return [...counts]
    .filter(([, n]) => n >= floor)
    .map(([at]) => at)
    .sort((a, b) => a - b);
}

/** JT4.2 — a boundary must clear every mode by more than two quanta. */
const clearsModes = (at: number, ms: number[]): boolean => ms.every((m) => Math.abs(at - m) > 2 * QUANTUM + 1e-9);

const precisionAtOrAbove = (o: Observed, t: number): { holds: number; of: number } => {
  const holds = o.true.filter((p) => p >= t).length;
  const of = holds + o.false.filter((p) => p >= t).length;
  return { holds, of };
};

const precisionAtOrBelow = (o: Observed, t: number): { holds: number; of: number } => {
  const holds = o.false.filter((p) => p <= t).length;
  const of = holds + o.true.filter((p) => p <= t).length;
  return { holds, of };
};

export interface DeriveOptions extends CalibrationLimits {
  /**
   * Whether this predicate may ever contribute a `false` (JF2.3). Assert-only
   * is the required setting wherever a `false` would read as "it did not
   * happen" rather than "the text does not say it happened", and it is the
   * reviewer's judgement per predicate — so it is an input here, never
   * inferred from the sample.
   */
  assertOnly: boolean;
}

/**
 * Derive the bands a labelled sample supports, or refuse and say why.
 *
 * Refusal is the common case on a predicate that should not exist, and the
 * error is written for the person who will read it: it names the measurement
 * that failed and what it implies about the question they wrote.
 */
export function deriveBands(id: string, observed: Observed, opts: DeriveOptions): DerivedBands {
  const n = observed.true.length + observed.false.length;
  const rejected: Array<{ at: number; why: string }> = [];

  // 1. Sample size (JF3.2). Below this, every figure downstream is noise
  //    wearing two decimal places.
  if (n < opts.minCalibration) {
    throw new PredicateError(id, `${n} labelled items, below the required ${opts.minCalibration} (JF3.2)`);
  }
  if (observed.true.length < opts.minCalibrationPerLabel || observed.false.length < opts.minCalibrationPerLabel) {
    throw new PredicateError(
      id,
      `${observed.true.length} true and ${observed.false.length} false labels; at least ${opts.minCalibrationPerLabel} of each are required. A sample that is nearly all one label cannot measure precision on the other.`,
    );
  }

  // 2. A4. Throws with JF2.4 named, which is almost always the real problem.
  const labelSeparation = checkSeparation(id, observed, opts.minLabelSeparation);

  const ms = modes(observed);

  // 3. The assert boundary: the HIGHEST threshold that reaches the required
  //    precision, walking down from 1.00.
  //
  //    Taking the lowest qualifying threshold is the obvious move and it is
  //    wrong. On a cleanly separated sample precision is perfect everywhere
  //    above the false cluster, so "lowest" puts the boundary hard against
  //    the FALSE cases — the ones it most needs to stay away from — and a
  //    single quantum of upward jitter on a false case flips it to an
  //    asserted fact. Taking the highest instead seats the boundary just
  //    under where the true cases actually live.
  //
  //    It also errs toward withholding, which is the direction this whole
  //    system errs: an abstention is a successful answer, and a wrongly
  //    asserted fact is not.
  let assertAt: number | null = null;
  for (const t of [...STEPS].reverse()) {
    const { holds, of } = precisionAtOrAbove(observed, t);
    if (of === 0) continue; // nothing at or above t: the threshold says nothing
    if (holds / of < opts.minPredicatePrecision) continue;
    if (!clearsModes(t, ms)) {
      rejected.push({ at: t, why: `within ${2 * QUANTUM} of a mode of the observed distribution (JT4.2)` });
      continue;
    }
    assertAt = t;
    break;
  }
  if (assertAt === null) {
    throw new PredicateError(
      id,
      `no threshold reaches an assert precision of ${opts.minPredicatePrecision} on this sample while clearing the distribution's modes (JT4.2). The labels separate by ${labelSeparation.toFixed(3)}, so the predicate is reading something — but not cleanly enough to assert on. Sharpen the question, or leave it proposed.`,
    );
  }

  // 4. The refute boundary, when the reviewer has allowed one. The HIGHEST
  //    threshold that reaches precision, for the mirror-image reason.
  let refuteAt = -1;
  let refutePrecision: number | null = null;
  if (!opts.assertOnly) {
    // The mirror image, for the mirror reason: the LOWEST qualifying
    // threshold, seated just above where the false cases live, so a quantum
    // of downward jitter on a true case cannot turn into an asserted `false`.
    // Constrained to leave JT4.3's withheld band, so a derivation can never
    // produce a band `validateBands` would reject.
    const ceiling = q(assertAt - MIN_BAND_WIDTH);
    for (const t of STEPS) {
      if (t > ceiling) break;
      const { holds, of } = precisionAtOrBelow(observed, t);
      if (of === 0) continue;
      if (holds / of < opts.minPredicatePrecision) continue;
      if (!clearsModes(t, ms)) {
        rejected.push({ at: t, why: `within ${2 * QUANTUM} of a mode of the observed distribution (JT4.2)` });
        continue;
      }
      refuteAt = t;
      refutePrecision = holds / of;
      break;
    }
    if (refuteAt < 0) {
      throw new PredicateError(
        id,
        `a refuting band was asked for, but no threshold below ${q(assertAt - MIN_BAND_WIDTH)} reaches a refute precision of ${opts.minPredicatePrecision}. Declare this predicate assert-only (refuteAt: -1) — it can still contribute a true, and it will never claim that silence is a denial.`,
      );
    }
  }

  const bands: Bands = { assertAt, refuteAt };
  // 5. JT4.3, and every band invariant, through the one function that owns
  //    them. A derivation that produced an inadmissible band is a bug here,
  //    and it should surface as one.
  validateBands(id, bands);

  const asserted = precisionAtOrAbove(observed, assertAt);
  const all = [...observed.true, ...observed.false];
  // Exactly the items `emit` would return null for. On an assert-only
  // predicate with a balanced sample that is around half of it, because every
  // false-labelled case is withheld rather than refuted — which is the
  // prohibition on closed-world reasoning showing up as a number, not a
  // problem with the band.
  const withheld = all.filter((p) => p < assertAt && p > refuteAt).length;

  return {
    bands,
    assertPrecision: asserted.of === 0 ? 0 : asserted.holds / asserted.of,
    refutePrecision,
    withheldFraction: withheld / all.length,
    labelSeparation,
    rejected,
  };
}

/** The record that goes into the predicate set (JF3.3), from a derivation. */
export function calibrationRecord(
  d: DerivedBands,
  observed: Observed,
  meta: { at: string; corpusRevision: string; alphabetVersion: number; reviewer: string },
): Calibration {
  return {
    at: meta.at,
    corpusRevision: meta.corpusRevision,
    alphabetVersion: meta.alphabetVersion,
    n: observed.true.length + observed.false.length,
    labels: { true: observed.true.length, false: observed.false.length },
    observed,
    assertPrecision: q(d.assertPrecision * 100) / 100,
    refutePrecision: d.refutePrecision === null ? null : q(d.refutePrecision * 100) / 100,
    withheldFraction: q(d.withheldFraction * 100) / 100,
    labelSeparation: d.labelSeparation,
    reviewer: meta.reviewer,
  };
}

/**
 * Whether a derived predicate may be adjudicated `real` (JF3.4). The tool
 * reports the number; the reviewer decides. This returns the reason it would
 * be refused, or null — it does not rule.
 */
export function blocksAdjudication(c: Calibration, limits: CalibrationLimits): string | null {
  if (c.assertPrecision < limits.minPredicatePrecision) {
    return `assert precision ${c.assertPrecision} is below ${limits.minPredicatePrecision} (JF3.4)`;
  }
  if (c.labelSeparation !== undefined && c.labelSeparation < limits.minLabelSeparation) {
    return `labels separate by ${c.labelSeparation.toFixed(3)}, below ${limits.minLabelSeparation} (A4)`;
  }
  return null;
}

export { separation };
