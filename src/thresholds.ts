// Every floor the miner and the provenance lattice depend on, in one object.
//
// The inherited numbers came from ONE dev-tool corpus and are circular there.
// This is the first honest second domain: every floor is configuration, every
// run reports the floors it used (manifest), and the evaluation reports
// sensitivity across a sweep rather than a tuned point value (TS §11).
export interface Thresholds {
  /** Below this many instances a rule cannot mean anything. */
  minInstances: number;
  /** The rule holds in at least this share of instances → own evidence. */
  ownSupport: number;
  /** It holds for at least this many OTHER operators → borrowed. */
  borrowedOperators: number;
  /** A guard seen before the subject this often is worth proposing. */
  guardSupport: number;
  /** A relationship this consistent is an implication, not a habit. */
  impliesSupport: number;
  /** How many guard-derived rules one subject may propose. */
  maxGuardRules: number;
  /** Above this unknown-event rate the audit refuses to emit proposals (F1.2). */
  unknownRateGate: number;
  /** A `not_real` rule is re-proposed only when its support moved at least this much (F5.3). */
  reproposalDelta: number;
  /** Counter-examples are sampled to at most this many per rule. */
  maxCounterexamples: number;
  /** Recommendation antecedents are conjunctions of at most this many conditions. */
  antecedentMaxLength: number;
  /** A recommendation is proposed when the action taken matched at least this share of the time. */
  recommendAgreement: number;
  /** A longer antecedent is kept only when it beats every shorter one it contains by at least this much. */
  recommendGain: number;
  /**
   * A recommendation is kept only if at least this share of the decision
   * points it explains are not already explained by a broader rule for the
   * same action. Redundancy pruning for the recommendation family — the
   * counterpart of obligation subsumption (TS §7.2).
   */
  recommendNovelty: number;
  /**
   * The instance floor is multiplied by the number of conditions in a
   * recommendation's antecedent, raised to this power.
   *
   * A conjunction search tries thousands of candidates, so some will hit a
   * perfect run by luck alone: on ABCD every one of the twelve
   * three-condition rules rested on fewer than fifteen instances, several on
   * exactly five, and two were conditioned on a US state. A longer antecedent
   * is a stronger claim and has to be paid for with more evidence. At 1.0 the
   * floor is minInstances x conditions; at 0 it is flat, which is the
   * behaviour before this existed.
   */
  antecedentFloorExponent: number;

  // --- observation (JF3, A4) ----------------------------------------------
  // Floors on a PREDICATE rather than on a rule. They live here, with every
  // other floor, so they sweep and so every run reports the ones it used.

  /** Labelled items a calibration needs (JF3.2). */
  minCalibration: number;
  /** …of which at least this many carry each label. */
  minCalibrationPerLabel: number;
  /** Assert precision below which a predicate cannot be adjudicated real (JF3.4). */
  minPredicatePrecision: number;
  /**
   * A4. How far the observed probabilities must move between a true case and a
   * false one before a band may be drawn at all.
   *
   * Measured: the admissible form of a question separated its labels by more
   * than 0.9, while the same question asked about the WORLD rather than about
   * the text separated by 0.037 — three quantisation steps, with the prompt
   * stating outright that the record might be incomplete. The default is set
   * at the minimum band width, which the failing case misses by a factor of
   * five, so it is a floor that catches the failure without being tuned to it.
   */
  minLabelSeparation: number;
}

export const THRESHOLDS: Thresholds = {
  minInstances: 5,
  ownSupport: 0.6,
  borrowedOperators: 3,
  guardSupport: 0.4,
  impliesSupport: 0.9,
  maxGuardRules: 3,
  unknownRateGate: 0.2,
  reproposalDelta: 0.1,
  maxCounterexamples: 20,
  antecedentMaxLength: 3,
  recommendAgreement: 0.8,
  recommendGain: 0.05,
  recommendNovelty: 0.5,
  antecedentFloorExponent: 1,
  minCalibration: 60,
  minCalibrationPerLabel: 15,
  minPredicatePrecision: 0.9,
  minLabelSeparation: 0.2,
};

export function withThresholds(overrides: Partial<Thresholds> | undefined): Thresholds {
  const out = { ...THRESHOLDS };
  if (!overrides) return out;
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in THRESHOLDS)) throw new Error(`unknown threshold '${k}'`);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`threshold '${k}' must be a finite number`);
    (out as unknown as Record<string, number>)[k] = v;
  }
  return out;
}
