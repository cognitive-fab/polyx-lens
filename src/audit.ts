// `polyx audit` (FS §S1). What this corpus repeats, what it does not support,
// and what fell below the floor and why. It says NOTHING when there is nothing
// to say, in those words, and every figure resolves to records.
import { consequentialTypes } from './alphabet/index.ts';
import type { LoadedCorpus } from './pipeline.ts';
import { UNKNOWN_TYPE, type Event, type Interaction } from './record.ts';
import type { Thresholds } from './thresholds.ts';
import { cmp } from './order.ts';

export interface TypeFigure {
  type: string;
  kind: string;
  count: number;
  interactions: number;
  /** What acting costs (ACV §6.3). `none` types are never mining subjects. */
  consequence: string;
  /** Whether an advisory system may propose it (ACV §6.4). */
  recommendable: boolean;
}

export interface SubjectFigure {
  type: string;
  count: number;
  episodes: number;
  aboveFloor: boolean;
}

export interface Audit {
  corpus: string;
  domain: string;
  corpusRevision: string;
  alphabetVersion: number;
  segmenter: string;
  thresholds: Thresholds;
  interactions: number;
  events: number;
  kinds: Record<string, number>;
  types: TypeFigure[];
  unknown: {
    count: number;
    rate: number;
    gate: number;
    /** True when the rate is over the gate: the audit refuses to emit proposals (F1.2). */
    refused: boolean;
    /** The unmatched feature shapes, most common first — what the alphabet is missing. */
    shapes: Array<{ features: string; count: number }>;
  };
  episodes: {
    count: number;
    perInteraction: number;
    /** Share of episodes containing no consequential action (F3.3). */
    zeroConsequentialShare: number;
    /**
     * Where the source states how many episodes an interaction holds (ABCD:
     * one subflow per conversation), the share of those interactions the
     * segmenter got exactly right. Absent when no interaction carries a truth.
     */
    groundTruth?: { interactions: number; agreement: number };
  };
  subjects: SubjectFigure[];
  belowFloor: SubjectFigure[];
  outcomes: Record<string, number>;
  actors: { operators: number; teams: number; agents: number };
  /** No consequential action clears the floor: there is nothing to say. */
  nothingToSay: boolean;
}

export function audit(corpus: LoadedCorpus, thresholds: Thresholds, unknownShapes: Map<string, number> = corpus.unknownShapes): Audit {
  const { interactions, alphabet } = corpus;
  const consequential = consequentialTypes(alphabet);
  const byType = new Map<string, TypeFigure & { seen: Set<string> }>();
  const kinds: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const episodes = new Map<string, Event[]>();
  const subjectEpisodes = new Map<string, Set<string>>();
  let events = 0;
  let unknown = 0;
  const operators = new Set<string>();
  const teams = new Set<string>();
  const agents = new Set<string>();

  for (const it of interactions) {
    operators.add(it.actor.operatorId);
    if (it.actor.teamId) teams.add(it.actor.teamId);
    if (it.actor.agentId) agents.add(it.actor.agentId);
    if (it.outcome) outcomes[it.outcome.label] = (outcomes[it.outcome.label] ?? 0) + 1;
    for (const e of it.events) {
      events++;
      kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
      if (e.type === UNKNOWN_TYPE) unknown++;
      const t = alphabet.eventTypes.find((x) => x.id === e.type);
      let f = byType.get(e.type);
      if (!f) {
        f = {
          type: e.type,
          kind: e.kind,
          count: 0,
          interactions: 0,
          // ACV §8.4: a term with no declaration in any loaded profile MUST be
          // treated as irreversible and not recommendable, and MUST NOT be
          // silently treated as `none`. Only `unknown` reaches this branch, and
          // reporting the events the alphabet failed to classify as costless
          // and proposable is the one direction this must never fail in.
          consequence: t?.consequence ?? 'irreversible',
          recommendable: t?.recommendable ?? false,
          seen: new Set(),
        };
        byType.set(e.type, f);
      }
      f.count++;
      f.seen.add(it.id);
      let ep = episodes.get(e.episode);
      if (!ep) episodes.set(e.episode, (ep = []));
      ep.push(e);
      if (consequential.has(e.type)) {
        let s = subjectEpisodes.get(e.type);
        if (!s) subjectEpisodes.set(e.type, (s = new Set()));
        s.add(e.episode);
      }
    }
  }

  const types = [...byType.values()]
    .map(({ seen, ...f }) => ({ ...f, interactions: seen.size }))
    .sort((a, b) => b.count - a.count || cmp(a.type, b.type));

  const allSubjects: SubjectFigure[] = [...consequential]
    .map((type) => ({
      type,
      count: byType.get(type)?.count ?? 0,
      episodes: subjectEpisodes.get(type)?.size ?? 0,
      aboveFloor: (byType.get(type)?.count ?? 0) >= thresholds.minInstances,
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || cmp(a.type, b.type));

  let zeroConsequential = 0;
  for (const ep of episodes.values()) if (!ep.some((e) => consequential.has(e.type))) zeroConsequential++;

  let withTruth = 0;
  let agreed = 0;
  for (const it of interactions) {
    const expected = corpus.hints.get(it.id)?.expected_episodes;
    if (typeof expected !== 'number') continue;
    withTruth++;
    if (new Set(it.events.map((e) => e.episode)).size === expected) agreed++;
  }

  const rate = events === 0 ? 0 : unknown / events;
  const shapes = [...unknownShapes].map(([features, count]) => ({ features, count })).sort((a, b) => b.count - a.count || cmp(a.features, b.features));

  return {
    corpus: corpus.name,
    domain: corpus.domain,
    corpusRevision: corpus.revision,
    alphabetVersion: alphabet.version,
    segmenter: corpus.segmenter,
    thresholds,
    interactions: interactions.length,
    events,
    kinds,
    types,
    unknown: { count: unknown, rate, gate: thresholds.unknownRateGate, refused: rate > thresholds.unknownRateGate, shapes },
    episodes: {
      count: episodes.size,
      perInteraction: interactions.length === 0 ? 0 : episodes.size / interactions.length,
      zeroConsequentialShare: episodes.size === 0 ? 0 : zeroConsequential / episodes.size,
      ...(withTruth > 0 ? { groundTruth: { interactions: withTruth, agreement: agreed / withTruth } } : {}),
    },
    subjects: allSubjects.filter((s) => s.aboveFloor),
    belowFloor: allSubjects.filter((s) => !s.aboveFloor),
    outcomes,
    actors: { operators: operators.size, teams: teams.size, agents: agents.size },
    nothingToSay: allSubjects.every((s) => !s.aboveFloor),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function renderAudit(a: Audit): string {
  const lines: string[] = [];
  lines.push(`polyx audit — ${a.corpus} (alphabet v${a.alphabetVersion}, corpus ${a.corpusRevision}, segmenter ${a.segmenter})`);
  lines.push('');
  lines.push(`${a.interactions} interactions, ${a.events} events, ${a.episodes.count} episodes (${a.episodes.perInteraction.toFixed(2)} per interaction)`);
  lines.push(`${a.actors.operators} operator(s), ${a.actors.teams} team(s), ${a.actors.agents} agent(s)`);
  lines.push(`episodes with no consequential action: ${pct(a.episodes.zeroConsequentialShare)}`);
  if (a.episodes.groundTruth) {
    lines.push(`segmentation agrees with the source's episode count on ${pct(a.episodes.groundTruth.agreement)} of ${a.episodes.groundTruth.interactions} interactions that state one`);
  }
  const oc = Object.entries(a.outcomes).sort((x, y) => y[1] - x[1]);
  if (oc.length) lines.push(`outcomes: ${oc.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push('');
  if (a.unknown.refused) {
    lines.push(`!! UNKNOWN RATE ${pct(a.unknown.rate)} EXCEEDS THE ${pct(a.unknown.gate)} GATE — this corpus will not be mined until the alphabet covers it (F1.2)`);
  } else {
    lines.push(`unknown events: ${a.unknown.count} (${pct(a.unknown.rate)} of events; gate ${pct(a.unknown.gate)})`);
  }
  if (a.unknown.shapes.length) {
    lines.push('  unmatched shapes:');
    for (const s of a.unknown.shapes.slice(0, 10)) lines.push(`    ${s.count.toString().padStart(5)}  ${s.features}`);
  }
  lines.push('');
  lines.push('event types:');
  for (const t of a.types) {
    const tag =
      t.type === UNKNOWN_TYPE || t.consequence === 'none'
        ? ''
        : `  [${t.consequence}${t.recommendable ? '' : ', not recommendable'}]`;
    lines.push(`  ${t.count.toString().padStart(6)}  ${t.type}  (${t.kind}, in ${t.interactions} interactions)${tag}`);
  }
  lines.push('');
  if (a.nothingToSay) {
    lines.push(`Nothing to say: no consequential action occurs at least ${a.thresholds.minInstances} times, and a rule on fewer cannot mean anything.`);
  } else {
    lines.push(`consequential actions with enough instances to support a rule (floor ${a.thresholds.minInstances}):`);
    for (const s of a.subjects) lines.push(`  ${s.count.toString().padStart(6)}  ${s.type}  (in ${s.episodes} episodes)`);
  }
  if (a.belowFloor.length) {
    lines.push('below the floor — no rule will be proposed for these:');
    for (const s of a.belowFloor) lines.push(`  ${s.count.toString().padStart(6)}  ${s.type}  (needs ${a.thresholds.minInstances})`);
  }
  lines.push('');
  lines.push('expand any figure: polyx audit <corpus> --show unknown | --show type:<id> | --show subject:<id>');
  return lines.join('\n');
}

/** The events behind one audit figure. */
export function figureEvents(corpus: LoadedCorpus, selector: string): Array<{ interaction: Interaction; event: Event }> {
  const [what, arg] = selector.split(':', 2) as [string, string | undefined];
  const rest = selector.slice(what.length + 1);
  const out: Array<{ interaction: Interaction; event: Event }> = [];
  for (const interaction of corpus.interactions) {
    for (const event of interaction.events) {
      if (what === 'unknown' && event.type === UNKNOWN_TYPE) out.push({ interaction, event });
      else if ((what === 'type' || what === 'subject') && arg !== undefined && event.type === rest) out.push({ interaction, event });
      else if (what === 'kind' && event.kind === rest) out.push({ interaction, event });
      else if (what === 'interaction' && interaction.id === rest) out.push({ interaction, event });
    }
  }
  return out;
}
