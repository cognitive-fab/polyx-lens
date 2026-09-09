// Three-valued condition evaluation. Shared by the miner (to select the
// instances a conditioned rule is measured over) and the advisor (TS §8.1).
//
// A fact absent from the base is UNKNOWN, never false. Closed-world
// assumption is prohibited: "no record of income verification" is not
// "income was not verified", and in a bank the difference is the product.
import type { Scalar } from './record.ts';
import type { Condition } from './rule.ts';

export type FactBase = Record<string, Scalar>;
export type Truth = true | false | 'unknown';

export function evalCondition(c: Condition, facts: FactBase): Truth {
  if (!(c.fact in facts)) return 'unknown';
  const v = facts[c.fact];
  if (v === undefined || v === null) return 'unknown';
  switch (c.op) {
    // Facts arrive as strings from most adapters and as numbers from some; a
    // reviewer types "1". Equality is by string form so `order.num_products = 1`
    // means the same thing whichever side was typed.
    case 'eq':
      return v === c.value || (!Array.isArray(c.value) && String(v) === String(c.value));
    case 'neq':
      return !(v === c.value || (!Array.isArray(c.value) && String(v) === String(c.value)));
    case 'in':
      return Array.isArray(c.value) && c.value.includes(v);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof v !== 'number' || typeof c.value !== 'number') return 'unknown';
      if (c.op === 'gt') return v > c.value;
      if (c.op === 'gte') return v >= c.value;
      if (c.op === 'lt') return v < c.value;
      return v <= c.value;
    }
  }
}

/**
 * A conjunction. `false` dominates (the rule does not apply); otherwise any
 * `unknown` makes the whole antecedent unknown; only all-true fires.
 */
export function evalAll(conditions: Condition[], facts: FactBase): { truth: Truth; unknown: string[] } {
  const unknown: string[] = [];
  for (const c of conditions) {
    const t = evalCondition(c, facts);
    if (t === false) return { truth: false, unknown: [] };
    if (t === 'unknown') unknown.push(c.fact);
  }
  return unknown.length ? { truth: 'unknown', unknown } : { truth: true, unknown: [] };
}

export function renderCondition(c: Condition): string {
  const v = Array.isArray(c.value) ? `[${c.value.map(String).join(', ')}]` : String(c.value);
  const op = { eq: '=', neq: '≠', in: 'in', gt: '>', gte: '≥', lt: '<', lte: '≤' }[c.op];
  return `${c.fact} ${op} ${v}`;
}
