// The fact base of an instance — what the agent had in front of it before a
// consequential action. Read by the miner to condition a rule, and by the lens
// to decide whether a contract clause applies at all.
//
// Four sources, in a fixed vocabulary:
//   obs.<name>              an observed fact from the annotation store — lowest precedence
//   customer.* / order.*   the interaction's facts — what the agent had on screen
//   episode.intent          the one classified intent in the episode, if there is exactly one
//   slot.<name>             a categorical slot value seen earlier in the same episode
//
// Observation is ADDITIVE and lowest (JF5.2). The namespaces are disjoint so
// nothing collides today, but the order is a MUST and not a default: an
// observed fact that overwrote a caller's could flip a true condition to
// false and withdraw a warning, and the whole safety invariant (JF7) rests on
// that never being possible.
//
// Redaction surrogates (`h#…`, `<slot>#…`) are never condition values: a
// condition on a hash is one nobody can read or satisfy.
import type { FactBase } from '../conditions.ts';
import type { Instance } from '../ports/subjects.ts';
import { UNKNOWN_TYPE, type Scalar } from '../record.ts';

const SURROGATE = /(^|#)[0-9a-f]{12,}$/;

const isCategorical = (v: Scalar): boolean =>
  typeof v === 'boolean' || (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && v.length <= 40 && !SURROGATE.test(v));

const memo = new WeakMap<Instance, FactBase>();

export function instanceFacts(i: Instance): FactBase {
  const cached = memo.get(i);
  if (cached) return cached;
  const facts: FactBase = {};
  memo.set(i, facts);
  // Observed first, so everything below overwrites it. A withheld (null)
  // observation contributes no key: the advisor must see unknown, never false.
  for (const [k, v] of Object.entries(i.observed ?? {})) if (v !== null) facts[k] = v;
  for (const [k, v] of Object.entries(i.facts ?? {})) if (isCategorical(v)) facts[k] = v;
  const intents = new Set(i.all.filter((e) => e.kind === 'customer_intent' && e.type !== UNKNOWN_TYPE).map((e) => e.type));
  if (intents.size === 1) facts['episode.intent'] = [...intents][0]!;
  for (const e of i.before) {
    for (const [k, v] of Object.entries(e.slots)) if (isCategorical(v)) facts[`slot.${k}`] = v;
  }
  return facts;
}
