// polyness behind the provenance port. polyness's `classify` speaks of
// projects; polyx speaks of operators. Same judgement, renamed at the edge.
//
// Modification of upstream: none.
import { classify } from 'polyness/src/provenance.mjs';
import type { ProvenanceClassifier } from '../provenance.ts';

export const polynessClassifier: ProvenanceClassifier = {
  name: 'polyness',
  classify(support, elsewhere, t) {
    return classify(
      { support },
      elsewhere.map((e) => ({ project: e.scope, holds: e.holds, of: e.of })),
      { thresholds: { ownSupport: t.ownSupport, borrowedProjects: t.borrowedOperators } },
    );
  },
};
