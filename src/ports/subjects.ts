// The subjects port (TS §6). The unit of mining is a consequential event, not
// a sequence. An INSTANCE is one occurrence of a subject plus the windows a
// rule can be measured over:
//
//   before         same episode, earlier    — what a per-episode rule sees
//   sessionBefore  same interaction, earlier — "did you verify before you
//                  refunded", even if the verification was two episodes ago
//   all            the whole episode         — for at-most-one / exactly-one
//
// Two implementations from day one: this file's naive extractor, and the
// polyness adapter under ports/polyness/. The port returns EVERY subject at
// any count — floors are the miner's business, and the audit needs the ones
// below the floor to say why nothing was proposed.
import type { Event, Interaction, Scalar } from '../record.ts';
import { cmp } from '../order.ts';

export interface Instance {
  interactionId: string;
  episodeId: string;
  seq: number;
  at: number;
  event: Event;
  before: Event[];
  sessionBefore: Event[];
  all: Event[];
  after: Event[];
  /** Who handled it — for provenance levels. */
  actor: Interaction['actor'];
  outcome?: Interaction['outcome'];
  /** Customer state at the start of the contact — the fact base data conditions are mined over. */
  facts?: Record<string, Scalar>;
  /**
   * Observed facts at this site, from the annotation store (JF5.1): `obs.*`
   * keyed, `true`/`false` emitted, `null` RECORDED AS WITHHELD. The null is
   * kept on purpose — it never reaches the fact base, but it tells the miner
   * the predicate was asked here, which is what makes an assert-only fact
   * a candidate condition at all (G2).
   */
  observed?: Record<string, boolean | null>;
}

export interface Subject {
  type: string;
  instances: Instance[];
}

export interface SubjectExtractor {
  readonly name: string;
  extract(interactions: Interaction[], consequential: Set<string>): Subject[] | Promise<Subject[]>;
}

/** Instances in corpus order: interaction start, then seq. Every implementation must agree on this. */
export function sortInstances(instances: Instance[], startedAt: Map<string, number>): Instance[] {
  return instances.sort(
    (a, b) =>
      (startedAt.get(a.interactionId) ?? 0) - (startedAt.get(b.interactionId) ?? 0) ||
      cmp(a.interactionId, b.interactionId) ||
      a.seq - b.seq,
  );
}

export function sortSubjects(subjects: Subject[]): Subject[] {
  return subjects.sort((a, b) => b.instances.length - a.instances.length || cmp(a.type, b.type));
}

export const naiveExtractor: SubjectExtractor = {
  name: 'naive',
  extract(interactions, consequential) {
    const found = new Map<string, Instance[]>();
    const startedAt = new Map<string, number>();
    for (const it of interactions) {
      startedAt.set(it.id, it.startedAt);
      const byEpisode = new Map<string, Event[]>();
      for (const e of it.events) {
        let ep = byEpisode.get(e.episode);
        if (!ep) byEpisode.set(e.episode, (ep = []));
        ep.push(e);
      }
      it.events.forEach((e, si) => {
        if (!consequential.has(e.type)) return;
        const all = byEpisode.get(e.episode)!;
        const ei = all.indexOf(e);
        const inst: Instance = {
          interactionId: it.id,
          episodeId: e.episode,
          seq: e.seq,
          at: e.at,
          event: e,
          before: all.slice(0, ei),
          sessionBefore: it.events.slice(0, si),
          all,
          after: all.slice(ei + 1),
          actor: it.actor,
        };
        if (it.outcome) inst.outcome = it.outcome;
        if (it.facts) inst.facts = it.facts;
        let list = found.get(e.type);
        if (!list) found.set(e.type, (list = []));
        list.push(inst);
      });
    }
    return sortSubjects([...found].map(([type, instances]) => ({ type, instances: sortInstances(instances, startedAt) })));
  },
};
