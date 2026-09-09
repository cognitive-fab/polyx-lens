// Pointers back into the corpus, and a deterministic sample of them. Every
// finding — a mined rule's counter-evidence, a contract clause's violations —
// has to expand to the records behind it (F5.1, F8.2), and a sample that moved
// between runs would make two reports of the same corpus disagree.
import type { Instance } from '../ports/subjects.ts';
import type { InstanceRef } from '../rule.ts';

/** Deterministic, evenly spaced sample of at most n — first and last always in. */
export function sample<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  if (n <= 1) return xs.slice(0, n);
  const out: T[] = [];
  for (let k = 0; k < n; k++) out.push(xs[Math.round((k * (xs.length - 1)) / (n - 1))]!);
  return out;
}

export const ref = (i: Instance): InstanceRef => ({ interactionId: i.interactionId, episodeId: i.episodeId, seq: i.seq });
