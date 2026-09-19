// Text redaction (JT7.1, JF0.1). The slot redactor next door has one job and
// states it: free text is never persisted, so it only ever sees slots. That
// commitment stands. What changed is that a predicate now READS text — at
// calibration, at annotation — and text that is read can leave the machine
// or land in a label file. So a second profile exists for text, declared per
// corpus, versioned, and named in every annotation line, because an
// annotation made under a weaker profile has to be identifiable after the
// fact.
//
// Pattern rules only. A slot rule is keyed by a slot NAME and means nothing
// over a span of prose; a pattern rule is the same in both places. The
// surrogates are the same functions the slot redactor uses, and a rule may
// say which slot it stands in for (`as: file`), so a path in a message and
// the same path in `slot.file` redact to ONE token. Without that a predicate
// could never relate what a message says to what an event carried.
//
// Two things this is not. It is not a substitute for the slot redactor: both
// run, on different things. And it is not a guarantee: a redactor that
// misses is the failure mode that matters (F1.3), which is why `annotate
// --dry-run` exists — the exact redacted payloads, reviewable before a key is
// ever configured (JT7.3).
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { hash, token, type Strategy } from './redact.ts';

export type TextPattern = 'email' | 'phone' | 'digits' | 'url' | 'path' | 'literal';

export interface TextRule {
  pattern: TextPattern;
  strategy: Strategy;
  /** `digits` only: minimum run. Default 6. */
  minDigits?: number;
  /** `literal` only: a regular expression, applied with the g flag. */
  match?: string;
  /**
   * The slot this stands in for. A `token` surrogate is keyed by it, so the
   * same value in text and in that slot yields one token and stays joinable.
   * Defaults to the pattern name.
   */
  as?: string;
}

export interface TextProfile {
  corpus: string;
  version: number;
  rules: TextRule[];
}

/** What every annotation line records (JT7.1): which profile the text left under. */
export const profileId = (p: TextProfile): string => `text.${p.corpus}@${p.version}`;

// Loose on purpose, as the slot patterns are: a redactor that misses a phone
// number because of a stray dot has failed at its one job. Over-matching
// costs a predicate some signal; under-matching costs a customer.
const PATTERNS: Record<Exclude<TextPattern, 'digits' | 'literal'>, RegExp> = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  phone: /(?:\+?\d[\d\s().-]{7,}\d)/g,
  url: /\bhttps?:\/\/[^\s<>"')\]]+/g,
  // A path. A Claude Code transcript is full of them, and each one names a
  // project, a person's home directory, or both. Four shapes, and the reason
  // for each:
  //
  //   C:\x, ~/x, ./x, ../x    rooted by a drive or a home or a dot: one segment is enough
  //   /a/b                    absolute: two segments, so `either/or` does not match
  //   a/b/c                   unrooted: three segments, so `TCP/IP` and `24/7` do not
  //   a/b.ext                 unrooted with an extension: `docs/spec.md`
  //
  // The separator is `[\\/]+`, plural, because a path pasted into a message
  // is often JSON-escaped — `C:\\Users\\…` — and the first dry run over the
  // real corpus found fifteen of those surviving a rule that wanted exactly
  // one backslash. Over-matching prose costs a predicate some signal;
  // under-matching a path costs a person their home directory.
  path: /(?:[A-Za-z]:|~|\.\.?)[\\/]+(?:[\w.-]+[\\/]+)*[\w.-]+|(?<![\w.-])[\\/]+(?:[\w.-]+[\\/]+)+[\w.-]+|(?:[\w.-]+[\\/]+){2,}[\w.-]+|[\w-]+[\\/]+[\w-]+\.[A-Za-z0-9]{1,8}\b/g,
};

export class TextProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextProfileError';
  }
}

function fail(msg: string): never {
  throw new TextProfileError(msg);
}

const STRATEGIES: readonly Strategy[] = ['token', 'hash', 'drop'];
const TEXT_PATTERNS: readonly TextPattern[] = ['email', 'phone', 'digits', 'url', 'path', 'literal'];

export function parseTextProfile(text: string, where = 'text profile'): TextProfile {
  const doc = parse(text) as Record<string, unknown>;
  if (typeof doc !== 'object' || doc === null) fail(`${where}: not a document`);
  if (typeof doc.corpus !== 'string' || !doc.corpus) fail(`${where}: corpus is required`);
  const corpus = doc.corpus;
  if (!Number.isInteger(doc.version) || (doc.version as number) < 1) fail(`${where}: version must be an integer >= 1`);
  const version = doc.version as number;
  if (!Array.isArray(doc.rules) || doc.rules.length === 0) {
    // An empty profile is a profile that redacts nothing, and it is a lie to
    // let it carry a version number as if it had been reviewed.
    fail(`${where}: rules must be a non-empty list — a profile that redacts nothing must not exist`);
  }
  const rules: TextRule[] = (doc.rules as unknown[]).map((raw, i) => {
    const w = `${where}: rules[${i}]`;
    if (typeof raw !== 'object' || raw === null) fail(`${w}: must be a map`);
    const r = raw as Record<string, unknown>;
    if (typeof r.pattern !== 'string' || !(TEXT_PATTERNS as readonly string[]).includes(r.pattern)) {
      fail(`${w}: pattern must be one of ${TEXT_PATTERNS.join(', ')}`);
    }
    const pattern = r.pattern as TextPattern;
    if (typeof r.strategy !== 'string' || !(STRATEGIES as readonly string[]).includes(r.strategy)) {
      fail(`${w}: strategy must be one of ${STRATEGIES.join(', ')}`);
    }
    const out: TextRule = { pattern, strategy: r.strategy as Strategy };
    if (pattern === 'literal') {
      if (typeof r.match !== 'string' || !r.match) fail(`${w}: a literal rule needs a match expression`);
      try {
        new RegExp(r.match, 'g');
      } catch (e) {
        fail(`${w}: match is not a valid expression: ${(e as Error).message}`);
      }
      out.match = r.match;
    }
    if (r.minDigits !== undefined) {
      if (!Number.isInteger(r.minDigits) || (r.minDigits as number) < 2) fail(`${w}: minDigits must be an integer >= 2`);
      out.minDigits = r.minDigits as number;
    }
    if (r.as !== undefined) {
      if (typeof r.as !== 'string' || !r.as) fail(`${w}: as must be a slot name`);
      out.as = r.as;
    }
    return out;
  });
  return { corpus, version, rules };
}

export function loadTextProfile(file: string): TextProfile {
  return parseTextProfile(readFileSync(file, 'utf8'), file);
}

const regexFor = (r: TextRule): RegExp => {
  if (r.pattern === 'digits') return new RegExp(`\\d{${r.minDigits ?? 6},}`, 'g');
  if (r.pattern === 'literal') return new RegExp(r.match!, 'g');
  return new RegExp(PATTERNS[r.pattern].source, 'g');
};

/** The shape every surrogate takes — `<key>#<12 hex>` or `h#<24 hex>`. */
const SURROGATE = /(?:[\w.-]+#[0-9a-f]{12}|h#[0-9a-f]{24})/g;

/**
 * Apply one rule, leaving every existing surrogate untouched.
 *
 * Checking whether the MATCH is a surrogate is not enough, and a test found
 * out why: a `digits` rule matched a six-digit run INSIDE an email token's
 * hex and hashed it, producing `email#5dh#8d67…`. So the spans of every
 * surrogate already in the text are found first, and a match that overlaps
 * one is left alone. "The surrogate is stable" is only true if nothing
 * re-redacts any part of it.
 */
function applyRule(text: string, r: TextRule, corpus: string): { out: string; n: number } {
  const protectedSpans: Array<[number, number]> = [];
  for (const m of text.matchAll(SURROGATE)) protectedSpans.push([m.index, m.index + m[0].length]);
  const overlaps = (a: number, b: number) => protectedSpans.some(([s, e]) => a < e && b > s);
  const key = r.as ?? r.pattern;
  let n = 0;
  const out = text.replace(regexFor(r), (m: string, ...args: unknown[]) => {
    const offset = args[args.length - 2] as number;
    if (overlaps(offset, offset + m.length)) return m;
    n++;
    switch (r.strategy) {
      case 'token':
        return token(corpus, key, m);
      case 'hash':
        return hash(m);
      case 'drop':
        return `<${key}>`;
    }
  });
  return { out, n };
}

/**
 * Redact one text. Returns a new string; the input is untouched.
 *
 * Rules apply in DOCUMENT ORDER and a later rule sees the earlier rule's
 * output, with every surrogate the earlier rule produced protected from it.
 */
export function redactText(text: string, profile: TextProfile): string {
  let out = text;
  for (const r of profile.rules) out = applyRule(out, r, profile.corpus).out;
  return out;
}

/**
 * The redacted payloads, side by side with what they were, for the dry-run
 * preview a compliance reviewer reads (JT7.3). `before` is present so the
 * reviewer can see what the rule caught; it is written ONLY to the preview
 * file, which never leaves the machine and is not the annotation store.
 */
export interface RedactionPreview {
  before: string;
  after: string;
  /** Which rules fired, and how many times each. Empty means the text was sent as-is. */
  fired: Record<string, number>;
}

export function previewRedaction(text: string, profile: TextProfile): RedactionPreview {
  const fired: Record<string, number> = {};
  let out = text;
  for (const r of profile.rules) {
    const res = applyRule(out, r, profile.corpus);
    out = res.out;
    if (res.n) fired[`${r.pattern}${r.as ? `→${r.as}` : ''}`] = res.n;
  }
  return { before: text, after: out, fired };
}
