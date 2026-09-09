// Redaction (TS §5.3). Applied at ingestion, on the slot map, before anything
// is persisted. Two strategies:
//
//   token  a stable per-corpus surrogate. The same input yields the same token
//          within a corpus, so joins across interactions survive; the input
//          does not.
//   hash   irreversible, unsalted by corpus — for values that must never be
//          joinable either.
//
// Free text is never persisted at all, so this module only ever sees slots.
// F1.3 is tested by scanning the database file for seeded identifiers, not by
// unit-testing this module — a redactor that is correct but not applied is the
// failure mode that matters.
import { createHash } from 'node:crypto';
import type { Scalar } from '../record.ts';

export type Strategy = 'token' | 'hash' | 'drop';

export interface SlotRule {
  /** A slot name, or '*' for every slot not named by another rule and not in `except`. */
  slot: string;
  strategy: Strategy;
  except?: string[];
  /**
   * An allowlist: the strategy is NOT applied to values in this list
   * (case-insensitive). For categorical slots a person types into —
   * membership level, shipping status — where the vocabulary is known and
   * anything outside it is, on inspection, usually a name.
   */
  unless?: string[];
  /** As `unless`, by shape: `^\d+(\.\d+)?$` keeps amounts and nothing else. */
  unlessPattern?: string;
}

/** A pattern rule scrubs any string slot value matching a named shape. */
export interface PatternRule {
  pattern: 'email' | 'phone' | 'digits';
  strategy: Strategy;
  /** Minimum digit run for `digits`. Default 6. */
  minDigits?: number;
}

export type RedactionRule = SlotRule | PatternRule;

export interface RedactionConfig {
  corpus: string;
  rules: RedactionRule[];
}

const PATTERNS = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // Loose on purpose: separators vary, and a redactor that misses a phone
  // number because of a stray dot has failed at its one job.
  phone: /(?:\+?\d[\d\s().-]{7,}\d)/g,
  digits: (min: number) => new RegExp(`\\d{${min},}`, 'g'),
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function token(corpus: string, slot: string, value: string): string {
  return `${slot}#${sha(`${corpus}\u0000${slot}\u0000${value}`).slice(0, 12)}`;
}

export function hash(value: string): string {
  return `h#${sha(value).slice(0, 24)}`;
}

function apply(strategy: Strategy, corpus: string, slot: string, value: string): string | null {
  switch (strategy) {
    case 'token':
      return token(corpus, slot, value);
    case 'hash':
      return hash(value);
    case 'drop':
      return null;
  }
}

function allowed(rule: SlotRule, v: Scalar): boolean {
  const s = String(v);
  if (rule.unless?.some((u) => u.toLowerCase() === s.toLowerCase())) return true;
  if (rule.unlessPattern !== undefined && new RegExp(rule.unlessPattern).test(s)) return true;
  return false;
}

/**
 * Redact one slot map. Returns a new object; never mutates the input.
 * Slot rules apply to the named slot whatever its value; pattern rules apply
 * to every string value no slot rule touched.
 */
export function redactSlots(slots: Record<string, Scalar>, config: RedactionConfig): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  const bySlot = new Map<string, SlotRule>();
  const patterns: PatternRule[] = [];
  let wildcard: SlotRule | undefined;
  for (const r of config.rules) {
    if (!('slot' in r)) patterns.push(r);
    else if (r.slot === '*') wildcard = r;
    else bySlot.set(r.slot, r);
  }
  for (const [k, v] of Object.entries(slots)) {
    let value: Scalar = v;
    let rule = bySlot.get(k);
    if (rule === undefined && wildcard && !wildcard.except?.includes(k)) rule = wildcard;
    // An absent value is absent: never manufacture a surrogate for null.
    if (v === null) {
      out[k] = null;
      continue;
    }
    let touched = false;
    if (rule !== undefined && !allowed(rule, v)) {
      const replaced = apply(rule.strategy, config.corpus, k, String(v));
      if (replaced === null) continue;
      value = replaced;
      touched = true;
    }
    // Pattern rules scrub values no slot rule touched. Surrogates are hex and
    // a `digits` pattern would mangle them — so a slot rule's output is final.
    if (!touched && typeof value === 'string') {
      for (const p of patterns) {
        const re = p.pattern === 'digits' ? PATTERNS.digits(p.minDigits ?? 6) : PATTERNS[p.pattern];
        value = value.replace(re, (m) => apply(p.strategy, config.corpus, k, m) ?? '');
      }
    }
    out[k] = value;
  }
  return out;
}
