// Every constant §4.4 and §4.4.1 depend on, in one object.
//
// The plan carries this as a named risk: these numbers were set from ONE
// corpus, and the test that pins them is pinned against that same corpus,
// which is circular. Keeping them here does not make them right — it makes
// them changeable without a grep, and it makes the circularity visible to the
// next person instead of scattered across four modules.
//
// Revisit on the first machine that is not the one they were derived from.
export const THRESHOLDS = {
  /** §4.4: below this many instances a rule cannot mean anything. */
  minInstances: 5,
  /** §4.4.1: the rule holds in at least this share of instances → own evidence. */
  ownSupport: 0.6,
  /** §4.4.1: it holds in at least this many OTHER projects → borrowed. */
  borrowedProjects: 3,
  /** §4.4: a guard seen before the subject this often is worth proposing. */
  guardSupport: 0.4,
  /** §4.4: a relationship this consistent is an implication, not a habit. */
  impliesSupport: 0.9,
  /**
   * How many guard-derived rules one subject may propose.
   *
   * Without a cap the session window produced 198 own-evidence rules across
   * ten projects, most of them incidental — everything a person happens to do
   * before pushing holds at 90% if the window is long enough. §3.2's example
   * proposal carries three rules, and a proposal nobody reads is not a
   * proposal.
   */
  maxGuardRules: 3,
};
