// Checking written rules against what actually happened. No mining, no store,
// no model call — for every clause, walk the corpus and count.
//
// This is the whole of the free lens's engine, and it is deliberately small:
// the compliance question ("which of the rules you wrote do you keep?") needs
// only the clauses and the corpus. The expensive half — which rules you keep
// that nobody ever wrote down — is what the miner is for, and nothing here can
// answer it. Saying so is the point of §"what this cannot tell you" in the
// report.
import { consequentialTypes } from '../alphabet/index.ts';
import { evalCondition } from '../conditions.ts';
import type { LoadedCorpus } from '../pipeline.ts';
import { naiveExtractor } from '../ports/subjects.ts';
import type { Instance } from '../ports/subjects.ts';
import type { InstanceRef } from '../rule.ts';
import type { Contract } from './contracts.ts';
import { instanceFacts } from './facts.ts';
import { ref, sample } from './refs.ts';

export interface ClauseExercise {
  clauseId: string;
  /** Instances of the subject within the clause's scope. */
  exercised: number;
  /** Of those, how many violated the clause. */
  violated: number;
  /** A sample of the violating instances — every finding links to records (F8.2). */
  violations: InstanceRef[];
  /** A sample of the instances that kept it. */
  kept: InstanceRef[];
}

/**
 * For every expressible clause: how often the corpus exercised it, and how
 * often it broke it.
 *
 * A clause the corpus never exercised is not a pass. It is a clause about a
 * situation that never arose, and the report has to say which it is — "you
 * never violated this" and "this never came up" are different findings and
 * conflating them flatters the reader.
 */
export async function exerciseClauses(corpus: LoadedCorpus, clauses: readonly Contract[]): Promise<ClauseExercise[]> {
  const subjects = await naiveExtractor.extract(corpus.interactions, consequentialTypes(corpus.alphabet));
  const bySubject = new Map(subjects.map((s) => [s.type, s.instances]));
  const out: ClauseExercise[] = [];
  for (const c of clauses) {
    if (!c.expressible || !c.subject) continue;
    const instances = (bySubject.get(c.subject) ?? []).filter(
      (i) => !c.when || evalCondition({ fact: c.when.fact, op: 'eq', value: c.when.value }, instanceFacts(i)) === true,
    );
    const bad: Instance[] = [];
    const good: Instance[] = [];
    if (c.shape === 'precedence') {
      // The window is what the rule says, not a default. A clause scoped to the
      // conversation is kept by a guard two episodes back; measured per episode
      // it reads as a violation, and on a corpus whose sessions hold twenty
      // tasks that difference is most of the figure.
      const seenIn = c.window === 'interaction' ? (i: Instance) => i.sessionBefore : (i: Instance) => i.before;
      for (const i of instances) (seenIn(i).some((e) => e.type === c.guard) ? good : bad).push(i);
    } else if (c.shape === 'at-most-one') {
      const seen = new Set<string>();
      for (const i of instances) {
        if (seen.has(i.episodeId)) continue;
        seen.add(i.episodeId);
        (i.all.filter((e) => e.type === c.subject).length > 1 ? bad : good).push(i);
      }
    }
    out.push({ clauseId: c.id, exercised: instances.length, violated: bad.length, violations: sample(bad, 20).map(ref), kept: sample(good, 20).map(ref) });
  }
  return out;
}

/** What the agent did, by how far outside its own system the effect reaches. */
export interface ActionCount {
  type: string;
  label: string;
  consequence: string;
  count: number;
  /** Occurrences whose recorded result was a failure. */
  failed: number;
}

/**
 * The action inventory. Most readers have never counted how many irreversible
 * things their agents did last month, and the count alone changes the
 * conversation before a single rule is checked.
 */
export function inventory(corpus: LoadedCorpus): ActionCount[] {
  const byType = new Map<string, { count: number; failed: number }>();
  for (const it of corpus.interactions) {
    it.events.forEach((e, i) => {
      if (e.kind !== 'action') return;
      const cur = byType.get(e.type) ?? { count: 0, failed: 0 };
      cur.count++;
      // An adapter may record the outcome on the action, or as the environment
      // response that follows it — a tool result is a separate event, and the
      // failure is a fact about the action that provoked it. Counting only the
      // first left the column permanently zero on every transcript corpus.
      const next = it.events[i + 1];
      if (e.result === 'failed' || (next?.kind === 'system' && next.result === 'failed')) cur.failed++;
      byType.set(e.type, cur);
    });
  }
  const declared = new Map(corpus.alphabet.eventTypes.map((t) => [t.id, t]));
  return [...byType]
    .map(([type, n]) => {
      const t = declared.get(type);
      return { type, label: t?.label ?? type.replace(/^[a-z]+:/, '').replace(/[_-]+/g, ' '), consequence: t?.consequence ?? 'unknown', count: n.count, failed: n.failed };
    })
    .sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : 1));
}
