// Provenance (§4.4.1). Where a rule's evidence comes from, and what that
// permits polyness to do with it.
//
// A proposal is NORMATIVE — it asks you to do something you did not always do.
// That is only legitimate while the norm is yours. §1.2 is the measurement
// that forces the distinction: a project with 7 pushes, 1 verification run and
// 0 verified pushes has no own-evidence for verify-before-push, and proposing
// it there would be importing an opinion under the appearance of a finding.
//
// A tool that does that once is a linter, which is a thing people mute.
import { THRESHOLDS } from './thresholds.mjs';

export const OWN = 'own';
export const BORROWED = 'borrowed';
export const NEITHER = 'neither';

/**
 * Classify one rule against this project and the rest of the corpus.
 *
 * `elsewhere` is the same rule's support in each OTHER project, as
 * `[{ project, holds, of }]`. It is only consulted when the rule fails here —
 * a rule with own evidence never needs anyone else's.
 */
export function classify(rule, elsewhere = [], { thresholds = THRESHOLDS } = {}) {
  const here = rule.support.of === 0 ? 0 : rule.support.holds / rule.support.of;
  if (here >= thresholds.ownSupport) return OWN;

  const others = elsewhere.filter((e) => e.of > 0 && e.holds / e.of >= thresholds.ownSupport);
  if (others.length >= thresholds.borrowedProjects) return BORROWED;
  return NEITHER;
}

/**
 * How a rule may be offered, given its provenance.
 *
 *   own       proposed, with its exceptions listed
 *   borrowed  shown on request, never in the default proposal
 *   neither   not proposed at all, at any confidence — but replayable (§3.4)
 *
 * Note the last row. §4.4.1 governs what polyness will PROPOSE, which is a
 * normative act. It does not govern what may be TESTED, which is an
 * observation — and that distinction is what lets intake be unlimited while
 * the bar stays exactly where §1.2 put it.
 */
export const OFFER = {
  [OWN]: { propose: true, byDefault: true, replayable: true },
  [BORROWED]: { propose: true, byDefault: false, replayable: true },
  [NEITHER]: { propose: false, byDefault: false, replayable: true },
};

/** The sentence a rule is offered with — its support, in the user's own terms. */
export function evidence(rule, provenance, elsewhere = [], { thresholds = THRESHOLDS } = {}) {
  const { holds, of } = rule.support;
  // Same thresholds `classify` used. Reading these from the module while
  // classify read them from `opts` let the printed sentence contradict the
  // decision it was explaining — "5 of your other projects do this" under a
  // verdict that had counted 3.
  if (provenance === OWN) {
    const base = of === holds
      ? `never violated (${holds}/${of})`
      : `you did this ${holds} of ${of} times, and it would have stopped the other ${of - holds}`;
    // A session-window rule is evidence about a sitting, enforced per run.
    // Saying so is the difference between a proposal and a sales pitch.
    return rule.window === 'session' && rule.runSupport
      ? `${base} — measured across the session; ${rule.runSupport.holds} of ${rule.runSupport.of} runs already did it inside one run`
      : base;
  }
  if (provenance === BORROWED) {
    const n = elsewhere.filter((e) => e.of > 0 && e.holds / e.of >= thresholds.ownSupport).length;
    return `${n} of your other projects do this; this one does not (${holds}/${of} here)`;
  }
  return `no support anywhere in the corpus (${holds}/${of} here)`;
}

/**
 * Split synthesised rules into what is proposed and what is merely shown.
 *
 * Every rule keeps its counter-evidence either way. A rule at 55% support is
 * offered as a DECISION — "this would have stopped 35 of 77" — not as
 * something the data discovered, and the person reading has to make it.
 */
export function partition(rules, elsewhereFor = () => [], opts) {
  const decided = rules.map((rule) => {
    // LAZY. `classify` short-circuits on own evidence and never looks at the
    // rest of the corpus, but the natural `elsewhereFor` is a re-mine of every
    // other project — an ~8s corpus pass, paid once per rule for a value that
    // was then discarded.
    let cached;
    const lazy = () => (cached ??= elsewhereFor(rule));
    const here = rule.support.of === 0 ? 0 : rule.support.holds / rule.support.of;
    const floor = (opts?.thresholds ?? THRESHOLDS).ownSupport;
    const elsewhere = here >= floor ? [] : lazy();
    const provenance = classify(rule, elsewhere, opts);
    return { ...rule, provenance, evidence: evidence(rule, provenance, elsewhere, opts) };
  });
  return {
    proposed: decided.filter((r) => OFFER[r.provenance].byDefault),
    onRequest: decided.filter((r) => OFFER[r.provenance].propose && !OFFER[r.provenance].byDefault),
    refused: decided.filter((r) => !OFFER[r.provenance].propose),
  };
}
