// The rule model (TS §7). Rules are data. Each pattern knows how to emit its
// predicate in a target language; the MVP ships one target (JS closures) and
// a second target is a new column in the same table, not a migration.
import type { Scalar } from './record.ts';

export type RuleFamily = 'obligation' | 'recommendation';
export type Window = 'episode' | 'interaction';

/**
 * Lifecycle (TS §7.6, rev. 2).
 *
 *   proposed      own evidence; awaiting adjudication
 *   real          adjudicated real — the only status the advisor serves
 *   not_real      adjudicated not real — not re-proposed unless support moves ≥ δ
 *   narrowed      adjudicated "needs a condition" — re-mined as a child rule
 *   retired       automatic: support fell below the floor, or no longer mined
 *   refused       no own evidence at any level (F4.4) — kept for the refusal-correctness metric, never reviewed
 *   suppressed    implied by another proposed rule (TS §7.2), or vacuous
 *   contradicted  member of a mutually exclusive pair (F4.6)
 */
export type RuleStatus = 'proposed' | 'real' | 'not_real' | 'narrowed' | 'retired' | 'refused' | 'suppressed' | 'contradicted';

/** A data condition on customer state or episode slots. Three-valued at evaluation time. */
export interface Condition {
  fact: string; // 'customer.member_level' | 'episode.intent' | 'slot.membership_level'
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value: Scalar | Scalar[];
}

export type Level = 'agent' | 'team' | 'operator';

export type Verdict =
  | { kind: 'own'; level: Level; scope: string }
  | { kind: 'borrowed'; foundIn: string[] }
  | { kind: 'neither' };

export interface Support {
  holds: number;
  of: number;
}

export interface InstanceRef {
  interactionId: string;
  episodeId: string;
  seq: number;
}

export interface Rule {
  id: string; // stable across runs — see store/identity.ts
  family: RuleFamily;
  pattern: string; // 'X-implies-prior-Y' | 'antecedent-implies-action' | ...
  bindings: Record<string, string>; // { subject: 'action:quote_rate', guard: 'action:disclose' }
  conditions: Condition[]; // data conditions on customer state
  window: Window;
  /** Support at the scope the verdict names — what the evidence sentence quotes. */
  support: Support;
  /** Support over the whole scope being mined (the operator). Equal to `support` for own@operator. */
  corpusSupport: Support;
  /** Recommendations only (TS §7.3): of the matches with a known outcome, how many were good. */
  outcomeSupport?: Support;
  counterexamples: InstanceRef[]; // capped, sampled, always non-empty when of > holds
  examples: InstanceRef[]; // supporting instances, capped and sampled
  provenance: Verdict;
  status: RuleStatus;
  predicates: { js: string }; // the emitter's targets; one for now
  alphabetVersion: number;
  minedAt: number;
  /** Human-readable form in domain vocabulary. */
  text: string;
  /** Why the history supports it, in the reviewer's terms. */
  evidence: string;
  corpus: string;
  /** The operator the rule was mined for. */
  scope: string;
  /** Set when redundancy pruning suppressed this rule in favour of another (TS §7.2). */
  suppressedBy?: string;
  /** The rule a `narrowed` verdict spawned this one from. */
  parentId?: string;
  /** Why a not_real rule is back on the review list (F5.3). */
  reproposedReason?: string;
  /** Why a rule was retired (TS §7.6). */
  retiredReason?: string;
}

export const ratio = ({ holds, of }: Support): number => (of === 0 ? 0 : holds / of);

export const fraction = ({ holds, of }: Support): string => `${holds}/${of}`;
