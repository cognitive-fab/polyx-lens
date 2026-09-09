// Subjects (§4.4). The unit of mining is a CONSEQUENTIAL EVENT, not a
// sequence, and §1.1 is the measurement that decided it:
//
//   an identical 3-4 step window recurs in   3% of projects
//   a consequential event recurs in         47% of projects
//   …and misbehaves in                      22%
//
// Mining sequences asks for a coincidence. Mining events asks only that the
// user has done the thing more than once. Everything recurs; only some of it
// is worth a gate, and consequence is the filter that makes the rest tractable.
import { THRESHOLDS } from './thresholds.mjs';

/**
 * The steps you cannot take back. A workflow is worth proposing around one of
 * these and around nothing else — a step that is always safe to repeat needs
 * no gate, however often it recurs.
 */
export const CONSEQUENTIAL = new Set([
  'git push', 'git commit', 'git tag', 'git merge', 'git reset',
  'npm publish', 'pnpm publish', 'yarn publish',
  'gh pr create', 'gh pr merge', 'gh release create',
  'docker push', 'cargo publish', 'terraform apply', 'kubectl apply',
]);

/** A verification is any record the classifier was willing to rule on. */
export const isVerification = (r) => r.outcome === 'passed' || r.outcome === 'failed';

/**
 * Group a project's records into subjects.
 *
 * An INSTANCE is one occurrence of the subject, plus the two windows a rule
 * can be measured over. They answer different questions, and a rule has to say
 * which one it used:
 *
 *   RUN (episode)   what a polyflow path IS. Every predicate this tool emits
 *                   is checked over one run, so a rule the gate enforces has
 *                   to be measured here — otherwise its support figure
 *                   describes something the gate will never see.
 *
 *   SESSION         what §1 and §1.2 measured: "with a passing test earlier in
 *                   the session". A verification twenty minutes and three
 *                   prompts ago is still one you ran before you pushed, and it
 *                   is the honest answer to "is this your standard?".
 *
 * Both are kept because both are true, and the gap between them is the honest
 * size of the change a proposal is asking for. On this corpus polysec is 68 of
 * 69 by session and 23 of 69 by run: adopting the workflow would mean
 * verifying in every run rather than once a sitting, and a proposal that
 * quoted only the 68 would be hiding that.
 *
 * The windows are GETTERS. Materialising them cost a fresh copy of the session
 * per consequential record — on the 20,000-record sessions this reader is
 * built for, with 69 pushes, roughly 1.4M retained references per session, two
 * thirds of it for an `after` window nothing ever read.
 */
export function subjects(records, { thresholds = THRESHOLDS, consequential = CONSEQUENTIAL } = {}) {
  const byEpisode = new Map();
  const bySession = new Map();
  for (const r of records) {
    const ek = `${r.session}:${r.episode}`;
    if (!byEpisode.has(ek)) byEpisode.set(ek, []);
    byEpisode.get(ek).push(r);
    if (!bySession.has(r.session)) bySession.set(r.session, []);
    bySession.get(r.session).push(r);
  }
  for (const rs of bySession.values()) rs.sort((a, b) => a.at - b.at);

  // One pass to index every record's position in its session, so an instance
  // does not pay an O(N) indexOf to find itself.
  const sessionIndex = new Map();
  for (const rs of bySession.values()) rs.forEach((r, i) => sessionIndex.set(r, i));

  const found = new Map();
  for (const [episodeKey, rs] of byEpisode) {
    rs.sort((a, b) => a.at - b.at);
    rs.forEach((r, ei) => {
      if (!consequential.has(r.kind)) return;
      if (!found.has(r.kind)) found.set(r.kind, []);
      const sess = bySession.get(r.session);
      const si = sessionIndex.get(r);
      found.get(r.kind).push({
        record: r,
        // The NUMBER, as §4.2 defines it. The composite stays the map key:
        // reporting `episode: "S3:5"` next to `session: "S3"` in an exception
        // is both redundant and unjoinable back to a Record.
        episode: r.episode,
        episodeKey,
        all: rs,
        get before() { return rs.slice(0, ei); },
        // Restored as a getter. It was dropped as "a window nothing ever read",
        // which was true and became false the moment replay had to ask whether
        // a blocked run went wrong AFTERWARDS — without it the cost proxy was
        // reading the whole episode and calling every fix-then-push run a
        // vindication of the rule.
        get after() { return rs.slice(ei + 1); },
        get sessionBefore() { return sess.slice(0, si); },
      });
    });
  }

  return [...found]
    .map(([kind, instances]) => ({ kind, instances, count: instances.length }))
    .filter((s) => s.count >= thresholds.minInstances)
    .sort((a, b) => b.count - a.count);
}

/**
 * Every consequential kind seen, whatever its count — so `audit` can say "1
 * push, and a rule needs at least 5 to mean anything" rather than printing
 * nothing and letting the user assume it found nothing to say.
 */
export function belowFloor(records, { thresholds = THRESHOLDS, consequential = CONSEQUENTIAL } = {}) {
  const counts = new Map();
  for (const r of records) {
    if (!consequential.has(r.kind)) continue;
    counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n < thresholds.minInstances)
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
}
