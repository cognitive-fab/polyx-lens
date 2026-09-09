// The provenance port (TS §6). A classifier answers one question at one
// scope: given a rule's support here, and the same rule's support in other
// operators, is the evidence OWN, BORROWED, or NEITHER? The lattice over
// levels (agent → team → operator → borrowed → neither) is polyx's and lives
// in mine/provenance.ts; the port is the single-level judgement it is built
// from, and polyness is one implementation of it.
import type { Support } from '../rule.ts';
import type { Thresholds } from '../thresholds.ts';

export interface Elsewhere {
  scope: string;
  holds: number;
  of: number;
}

export type Provenance = 'own' | 'borrowed' | 'neither';

export interface ProvenanceClassifier {
  readonly name: string;
  classify(support: Support, elsewhere: Elsewhere[], thresholds: Thresholds): Provenance;
}

/** The reference implementation: the same arithmetic polyness §4.4.1 uses. */
export const simpleClassifier: ProvenanceClassifier = {
  name: 'simple',
  classify(support, elsewhere, t) {
    const here = support.of === 0 ? 0 : support.holds / support.of;
    if (here >= t.ownSupport) return 'own';
    const others = elsewhere.filter((e) => e.of > 0 && e.holds / e.of >= t.ownSupport);
    if (others.length >= t.borrowedOperators) return 'borrowed';
    return 'neither';
  },
};
