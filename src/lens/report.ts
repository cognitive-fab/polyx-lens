// The lens report: what your agents did, and which of the rules they were given
// they actually kept.
//
// Written for a reader who has installed nothing and configured nothing. Three
// properties it must hold to, because they are what make it worth reading:
//
//   1. **It leads with what it cannot see.** The unknown rate comes before any
//      finding, because a compliance figure computed over the share of actions
//      a parser happened to understand is not a measurement. (This is not
//      hypothetical: the adapter under it once dropped two thirds of one
//      corpus's pushes while reporting a 1.4% unknown rate.)
//   2. **Never exercised is not a pass.** "You never broke this" and "this
//      never came up" are different findings and merging them flatters.
//   3. **It says what it cannot answer at all.** Which rules you keep that
//      nobody wrote down is the other half of the picture, and no amount of
//      clause checking reaches it.
import type { LoadedCorpus } from '../pipeline.ts';
import type { ClauseExercise, ActionCount } from './check.ts';
import type { ContractSet } from './contracts.ts';

export interface LensReport {
  corpus: string;
  contracts: { name: string; version: number; scope?: string };
  coverage: {
    interactions: number;
    events: number;
    actions: number;
    unknownEvents: number;
    unknownRate: number;
  };
  inventory: ActionCount[];
  clauses: {
    total: number;
    expressible: number;
    inexpressible: number;
    kept: string[];
    violated: Array<{ id: string; text: string; violated: number; exercised: number }>;
    neverExercised: Array<{ id: string; text: string }>;
    unreachable: Array<{ id: string; text: string; reason: string }>;
  };
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

export function buildReport(corpus: LoadedCorpus, contracts: ContractSet, exercise: ClauseExercise[], inv: ActionCount[]): LensReport {
  const events = corpus.interactions.reduce((n, i) => n + i.events.length, 0);
  const unknown = [...corpus.unknownShapes.values()].reduce((n, c) => n + c, 0);
  const byId = new Map(contracts.clauses.map((c) => [c.id, c]));

  const violated = exercise
    .filter((e) => e.violated > 0)
    .sort((a, b) => b.violated / b.exercised - a.violated / a.exercised || b.violated - a.violated)
    .map((e) => ({ id: e.clauseId, text: byId.get(e.clauseId)?.text ?? e.clauseId, violated: e.violated, exercised: e.exercised }));

  return {
    corpus: corpus.name,
    contracts: { name: contracts.contracts, version: contracts.version, ...(contracts.scope ? { scope: contracts.scope } : {}) },
    coverage: {
      interactions: corpus.interactions.length,
      events,
      actions: inv.reduce((n, a) => n + a.count, 0),
      unknownEvents: unknown,
      unknownRate: events ? unknown / events : 0,
    },
    inventory: inv,
    clauses: {
      total: contracts.clauses.length,
      expressible: contracts.clauses.filter((c) => c.expressible).length,
      inexpressible: contracts.clauses.filter((c) => !c.expressible).length,
      kept: exercise.filter((e) => e.exercised > 0 && e.violated === 0).map((e) => e.clauseId),
      violated,
      neverExercised: exercise.filter((e) => e.exercised === 0).map((e) => ({ id: e.clauseId, text: byId.get(e.clauseId)?.text ?? e.clauseId })),
      unreachable: contracts.clauses.filter((c) => !c.expressible).map((c) => ({ id: c.id, text: c.text, reason: c.reason ?? '' })),
    },
  };
}

export function renderReport(r: LensReport, exercise: ClauseExercise[]): string {
  const L: string[] = [];
  const ex = new Map(exercise.map((e) => [e.clauseId, e]));
  const irreversible = r.inventory.filter((a) => a.consequence === 'irreversible');
  const compensable = r.inventory.filter((a) => a.consequence === 'compensable');

  L.push(`polyx lens — ${r.corpus} against the ${r.contracts.name} contracts (v${r.contracts.version})`);
  L.push('');
  L.push(`${r.coverage.interactions} sessions · ${r.coverage.events} events · ${r.coverage.actions} actions`);
  L.push(`${r.coverage.unknownEvents} events (${pct(r.coverage.unknownRate)}) this alphabet cannot name — every figure below is measured over the rest`);
  L.push('');

  L.push('WHAT YOUR AGENTS DID');
  const total = (xs: ActionCount[]) => xs.reduce((n, a) => n + a.count, 0);
  L.push(`  irreversible  ${String(total(irreversible)).padStart(6)}   no way back from this machine`);
  for (const a of irreversible.slice(0, 6)) L.push(`      ${String(a.count).padStart(6)}  ${a.label}${a.failed ? `  (${a.failed} failed)` : ''}`);
  L.push(`  compensable   ${String(total(compensable)).padStart(6)}   state moved, and there is a way back`);
  for (const a of compensable.slice(0, 4)) L.push(`      ${String(a.count).padStart(6)}  ${a.label}${a.failed ? `  (${a.failed} failed)` : ''}`);
  L.push('');

  L.push(`RULES YOU WERE GIVEN, AND KEPT (${r.clauses.kept.length})`);
  for (const id of r.clauses.kept) {
    const e = ex.get(id)!;
    L.push(`  ${String(e.exercised).padStart(6)} of ${String(e.exercised).padEnd(6)} ${id}`);
  }
  L.push('');

  L.push(`RULES YOU WERE GIVEN, AND BROKE (${r.clauses.violated.length})`);
  if (!r.clauses.violated.length) L.push('  none');
  for (const v of r.clauses.violated) {
    L.push(`  ${v.text}`);
    L.push(`      VIOLATED ${v.violated} of ${v.exercised} times (${pct(v.violated / v.exercised)})`);
    const e = ex.get(v.id)!;
    if (e.violations.length) L.push(`      e.g. ${e.violations.slice(0, 4).map((x) => `${x.interactionId}#${x.seq}`).join(' ')}`);
  }
  L.push('');

  if (r.clauses.neverExercised.length) {
    L.push(`NEVER CAME UP (${r.clauses.neverExercised.length}) — not a pass`);
    for (const c of r.clauses.neverExercised) L.push(`  ${c.id}  ${c.text}`);
    L.push('');
  }

  L.push(`WRITTEN, AND NOT CHECKABLE THIS WAY (${r.clauses.unreachable.length} of ${r.clauses.total})`);
  L.push('  A precedence between two typed actions cannot state a rule about intent,');
  L.push('  about a flag on a command, or about the content of an argument.');
  for (const c of r.clauses.unreachable.slice(0, 5)) L.push(`  ${c.text}\n      ${c.reason}`);
  if (r.clauses.unreachable.length > 5) L.push(`  … and ${r.clauses.unreachable.length - 5} more, each with its reason`);
  L.push('');

  L.push('WHAT THIS REPORT CANNOT TELL YOU');
  L.push('  Which rules your agents keep that nobody ever wrote down.');
  L.push('');
  L.push('  Everything above is measured against rules you already have. The');
  L.push('  regularities in this history that no document states — the ones your');
  L.push('  people follow because that is how the work is done here — are not in');
  L.push('  any clause set, so nothing here can find them. They are also the ones');
  L.push('  worth gating, because a rule nobody wrote down is a rule nobody');
  L.push('  checks. Finding them is what the miner does.');

  return L.join('\n');
}
