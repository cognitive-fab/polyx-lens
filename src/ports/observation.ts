// The observation port (JT1). A function from (text, declared predicate) to a
// fact, or to nothing. It is not a miner, not an adjudicator, not a reasoner,
// and it never decides a verdict — everything downstream of the fact base is
// unchanged by its presence.
//
// THREE-VALUED, for the same reason the advisor is. A predicate maps a
// returned probability to true, false, or NOTHING:
//
//   p >= assertAt   →  emit obs.<name> = true
//   p <= refuteAt   →  emit obs.<name> = false
//   otherwise       →  emit nothing, and the advisor abstains as it does today
//
// "Emit nothing" is not "emit false". A System One model reads a TEXT and is
// asked about the WORLD, and when the text is silent something has to fill the
// gap. What fills it is the closed-world assumption — if the record does not
// mention it, it did not happen — which is correct when the record is complete
// and wrong when it is partial. Production records are always partial.
//
// Measured, on twelve matched loan-origination cases (19 September 2026):
// asked "was income verified?", the model answered NOT VERIFIED twelve times
// out of twelve and was right half the time. Asked whether the TEXT STATES
// that income was verified, it was right twelve times out of twelve. The two
// questions read almost identically in English. Nothing in the response says
// which one was asked. That is why `quadrant` is a required field below and
// why the middle band emits nothing rather than false.
//
// The interface lives in the free half because `Event`, `Scalar` and
// `FactBase` do, and because the free half has to be able to READ an
// annotation file to produce its report. No implementation here makes a
// network call; the vendor adapter lives in polyx, behind this interface.
import type { Scalar } from '../record.ts';

/**
 * The status lattice a predicate carries (JF4.1) — the rule lattice's four
 * adjudicable values, and deliberately not the rest of `RuleStatus`. A
 * predicate is a claim about the corpus that a person has to accept, exactly
 * as a rule is; `narrowed`, `suppressed` and `contradicted` are mining
 * outcomes and mean nothing here.
 */
export type PredicateStatus = 'proposed' | 'real' | 'not_real' | 'retired';

/**
 * Which of the four kinds of question this predicate asks. Two axes: does the
 * TEXT decide the answer or does the SEQUENCE of what happened before it, and
 * does an absent fact mean "no" or mean "unknown"?
 *
 *   text-unknown      the text decides; silence means unknown.  ← the admissible class
 *   text-closed       the text decides; silence really does mean no.
 *   sequence-closed   the sequence decides and the log is complete by
 *                     construction. Write the if-statement; neither a model
 *                     nor a mined rule is needed.
 *   sequence-unknown  the sequence decides and the record is partial.
 *                     PROHIBITED (JF2.4). This is the quadrant where the model
 *                     answers confidently and is right half the time, and it
 *                     is the quadrant polyx exists to serve.
 */
export type Quadrant = 'text-unknown' | 'text-closed' | 'sequence-closed' | 'sequence-unknown';

/** The quadrant a predicate may not be declared in, and why. */
export const PROHIBITED_QUADRANT: Quadrant = 'sequence-unknown';

export interface Bands {
  /** `p >= assertAt` emits true. A multiple of the 0.01 quantum. */
  assertAt: number;
  /**
   * `p <= refuteAt` emits false. A negative value no probability can reach
   * makes the predicate ASSERT-ONLY (JF2.3), which is the required setting for
   * any predicate whose `false` would be read as "it did not happen" rather
   * than "the text says it did not happen".
   */
  refuteAt: number;
}

/** Where a predicate's text comes from, and over what window (JT2.3). */
export type PredicateWindow = 'event' | 'before' | 'sessionBefore';

export interface Calibration {
  at: string;
  corpusRevision: string;
  alphabetVersion: number;
  n: number;
  labels: { true: number; false: number };
  /** The observed `p` on each label — the input to band derivation and to `separation`. */
  observed?: { true: number[]; false: number[] };
  assertPrecision: number;
  refutePrecision: number | null;
  withheldFraction: number;
  /** Mean `p` on label-true minus mean `p` on label-false. See `separation`. */
  labelSeparation?: number;
  reviewer: string;
}

export interface Predicate {
  id: string;
  /** `obs.<name>` — namespaced so an observed fact is distinguishable from a slot everywhere it appears (JF1.3). */
  fact: string;
  status: PredicateStatus;
  quadrant: Quadrant;
  /** `event.text` | `episode.text` | `slot.<name>` */
  source: string;
  window: PredicateWindow;
  question: string;
  criteria?: { true: string; false: string };
  bands: Bands;
  /** Absent means inert: an uncalibrated predicate emits no fact, in every path (JF3.1). */
  calibration?: Calibration;
}

export interface Observation {
  /** The predicate id — which is also the wire key, since answers come back under the question's name. */
  predicate: string;
  fact: string;
  /**
   * `null` is a WITHHOLDING, not a false and not a null-valued fact.
   *
   * The spec's rev. 1 typed this `Scalar | null`, but `null` is already a
   * member of `Scalar`, so the withheld case was indistinguishable from a fact
   * whose value is null. Every predicate is a `noul` (JT2.1), so the value is
   * a boolean and the ambiguity disappears. Widen this only alongside a
   * calibration story for whatever is being widened to.
   */
  value: boolean | null;
  /** Raw, retained for audit and recalibration — including on withheld observations (JT3.3). */
  p: number;
  /**
   * Whatever else the answer carried, retained verbatim and unread.
   *
   * The vendor describes two quantities per answer — "calibrated probabilities
   * AND confidence scores" — and every probe run to date has read `.noul` and
   * discarded the rest without anyone looking at it. If a second-order
   * uncertainty is in there it would be a PER-CALL detector for the
   * quadrant-four case, where `separation` below is a per-calibration one.
   *
   * So this is kept for the same reason JT3.3 keeps `p`: retaining a field we
   * do not yet use costs bytes, and discarding it costs a fresh pass over every
   * annotated corpus. Nothing reads it until W0.3 says what is in it.
   */
  raw?: Record<string, unknown>;
  /**
   * The model that actually answered, as the response names it — e.g.
   * `jev-1.13.0` when `jev-latest` was asked for. The first probe to print a
   * whole response found this field; every probe before it had discarded
   * it. It is what lets `annotate --diff` tell jitter from a model change,
   * and it belongs on every annotation line and, pinned, in the predicate set.
   */
  model?: string;
}

export interface Observer {
  readonly name: string;
  /** Predicate-set version. Annotations made under one version are not read under another (JF1.4). */
  readonly version: number;
  /**
   * One call per site. Implementations MUST batch every predicate into it:
   * latency is flat in the number of questions, so a battery of eight costs
   * what one costs and a per-predicate call is pure waste (JT5.1).
   */
  observe(text: string, predicates: Predicate[]): Promise<Observation[]>;
}

/**
 * The default, and the one polyx runs with no key configured. Returns nothing
 * for everything, which makes the advisor behave exactly as it does today
 * (JF5.3).
 *
 * Unlike the segmentation port, the null implementation here is the DEFAULT
 * rather than an alternative: observation is additive, and a deployment that
 * has not opted in should not be able to tell the port exists.
 */
export const nullObserver: Observer = {
  name: 'null',
  version: 0,
  async observe() {
    return [];
  },
};

// ---------------------------------------------------------------------------
// Band arithmetic (JT4). Pure, and deliberately in the free half: these are
// the rules that keep a jittering probability from becoming a flapping fact,
// and a test of a safety rule should not need a key to run.

/** The probability quantum the model returns on. Measured, not assumed. */
export const QUANTUM = 0.01;

/** Jitter observed across identical calls: one quantum. Bands must clear it. */
export const JITTER = 0.01;

/** JT4.3 — the minimum width of the withheld band on a refuting predicate. */
export const MIN_BAND_WIDTH = 0.2;

/** A4 — the minimum separation between the two labels' distributions. */
export const MIN_LABEL_SEPARATION = 0.2;

export class PredicateError extends Error {
  readonly predicate: string;
  constructor(predicate: string, message: string) {
    super(`predicate '${predicate}': ${message}`);
    this.name = 'PredicateError';
    this.predicate = predicate;
  }
}

/** An assert-only predicate can never contribute a `false` (JF2.3). */
export const isAssertOnly = (b: Bands): boolean => b.refuteAt < 0;

const isQuantised = (v: number): boolean => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;

/**
 * JT4.1 and JT4.3. Throws rather than returning a verdict: a malformed band is
 * a defect in a reviewed artefact, not a runtime condition to degrade around.
 */
export function validateBands(id: string, b: Bands): void {
  if (!(b.assertAt > 0 && b.assertAt <= 1)) throw new PredicateError(id, `assertAt must be in (0, 1], got ${b.assertAt}`);
  if (b.refuteAt > b.assertAt) throw new PredicateError(id, `refuteAt (${b.refuteAt}) must not exceed assertAt (${b.assertAt})`);
  if (!isQuantised(b.assertAt)) throw new PredicateError(id, `assertAt must be a multiple of ${QUANTUM}, got ${b.assertAt}`);
  if (!isAssertOnly(b)) {
    if (!isQuantised(b.refuteAt)) throw new PredicateError(id, `refuteAt must be a multiple of ${QUANTUM}, got ${b.refuteAt}`);
    if (b.assertAt - b.refuteAt < MIN_BAND_WIDTH - 1e-9) {
      // "A narrow withheld band is a closed-world assumption wearing a
      // threshold." Widening the bands costs coverage; narrowing them costs
      // the guarantee, and only one of those is recoverable.
      throw new PredicateError(id, `assertAt - refuteAt must be at least ${MIN_BAND_WIDTH} (got ${(b.assertAt - b.refuteAt).toFixed(2)}); a narrower withheld band converts jitter into flapping facts`);
    }
  }
}

/**
 * JT4.4 — the whole of JF2.1, and the only place a probability becomes a fact.
 * Comparisons are on the value as returned: no rounding, no rescaling, and no
 * averaging of repeated calls. Repeating a call to reduce jitter is prohibited
 * — it costs latency, it does not converge on a true value, and it makes the
 * annotation pass non-reproducible in a way the digest cannot express.
 */
export function emit(p: number, b: Bands): boolean | null {
  if (p >= b.assertAt) return true;
  if (p <= b.refuteAt) return false;
  return null;
}

/**
 * A4 — how far apart the two labels' probabilities sit. The detector for a
 * quadrant-four predicate that got past review.
 *
 * A predicate that is genuinely reading the text separates its labels widely:
 * the admissible form of the income question sat at p = 0.02 on every
 * label-false case. A predicate that is guessing about the world does not
 * separate at all — with the prompt stating outright that the record might be
 * incomplete, the two groups still separated by 0.037, which against a quantum
 * of 0.01 is about three quantisation steps. The information was never in the
 * text, and no phrasing recovers what is not there.
 *
 * Returns mean(label-true) - mean(label-false). Negative means the predicate is
 * anti-correlated with its own question, which is worth seeing rather than
 * hiding behind an absolute value.
 */
export function separation(observed: { true: number[]; false: number[] }): number {
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  if (observed.true.length === 0 || observed.false.length === 0) return 0;
  return mean(observed.true) - mean(observed.false);
}

/**
 * A4, as a gate. Called at calibration time, BEFORE any band is drawn: there is
 * no point choosing a boundary on a distribution that does not move between the
 * labels. The error names JF2.4, because a predicate that fails this is nearly
 * always a question about the world wearing the clothes of a question about a
 * text.
 */
export function checkSeparation(id: string, observed: { true: number[]; false: number[] }, min = MIN_LABEL_SEPARATION): number {
  const s = separation(observed);
  if (s < min) {
    throw new PredicateError(
      id,
      `labels separate by ${s.toFixed(3)}, below the required ${min.toFixed(2)} — the returned probability barely moves between a true case and a false one, which means the answer is not in the text. Re-read JF2.4: a predicate must ask what a text STATES, never what happened in the world.`,
    );
  }
  return s;
}

/** A predicate emits facts only when it is `real` AND calibrated (JF3.1, JF4.1). */
export const isInert = (p: Predicate): boolean => p.status !== 'real' || p.calibration === undefined;

/**
 * The fact an observation contributes, or nothing. The single place the
 * withheld case is turned into an absent key rather than a false value.
 */
export function observedFacts(obs: Observation[]): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const o of obs) if (o.value !== null) out[o.fact] = o.value;
  return out;
}
