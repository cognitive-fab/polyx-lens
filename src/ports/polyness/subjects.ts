// polyness behind the subjects port. polyness's `subjects()` groups records
// by consequential kind and gives each instance its `before` / `sessionBefore`
// / `all` / `after` windows as getters; polyx's Instance is the same shape
// with the polyx names on it.
//
// polyness filters by its own `minInstances`; the port does not — floors are
// the miner's — so the threshold is set to 1 here and re-applied downstream.
//
// Modification of upstream: none.
import { subjects as polynessSubjects } from 'polyness/src/subjects.mjs';
import type { Event, Interaction } from '../../record.ts';
import { sortInstances, sortSubjects, type Instance, type Subject, type SubjectExtractor } from '../subjects.ts';

interface Rec {
  kind: string;
  session: string;
  episode: string;
  at: number;
  event: Event;
  interaction: Interaction;
}

export const polynessExtractor: SubjectExtractor = {
  name: 'polyness',
  extract(interactions, consequential) {
    const records: Rec[] = [];
    const startedAt = new Map<string, number>();
    for (const it of interactions) {
      startedAt.set(it.id, it.startedAt);
      for (const e of it.events) records.push({ kind: e.type, session: it.id, episode: e.episode, at: e.at, event: e, interaction: it });
    }
    const found = polynessSubjects<Rec>(records, { thresholds: { minInstances: 1 }, consequential });
    const out: Subject[] = found.map(({ kind, instances }) => ({
      type: kind,
      instances: sortInstances(
        instances.map((i) => {
          const inst: Instance = {
            interactionId: i.record.session,
            episodeId: i.record.episode,
            seq: i.record.event.seq,
            at: i.record.at,
            event: i.record.event,
            before: i.before.map((r) => r.event),
            sessionBefore: i.sessionBefore.map((r) => r.event),
            all: i.all.map((r) => r.event),
            after: i.after.map((r) => r.event),
            actor: i.record.interaction.actor,
          };
          if (i.record.interaction.outcome) inst.outcome = i.record.interaction.outcome;
          if (i.record.interaction.facts) inst.facts = i.record.interaction.facts;
          return inst;
        }),
        startedAt,
      ),
    }));
    return sortSubjects(out);
  },
};
