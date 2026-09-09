// The alphabet subsystem (TS §5). The set of event types, and the rule for
// assigning an event to a type, is an explicit, inspectable, per-corpus
// artefact — never implicit in code (F2.1). It is versioned, and the version
// is stamped on every derived figure (F2.2).
//
// This is the module on which every downstream number depends. A regex that
// moves one event from one type to another moves every support figure built
// on it, which is why `show` (F2.3) exists: to print the source records
// assigned to a type before anyone trusts a figure built on it.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { RawEvent, RawInteraction } from '../ingest/types.ts';
import {
  UNKNOWN_TYPE,
  UNSEGMENTED,
  type Event,
  type EventKind,
  type Interaction,
  type Outcome,
  type Scalar,
  EVENT_KINDS,
} from '../record.ts';
import { redactSlots, type RedactionConfig, type RedactionRule } from './redact.ts';

/**
 * What acting COSTS, as ACV 1.0 §6.3 defines it (docs/acv-1.0-spec.md): a
 * single total order from least to most severe.
 *
 *   none          no effect outside the acting system's own state — reads,
 *                 searches, notes. Never a mining subject (F3.2).
 *   reversible    the actor can restore the prior state at negligible cost,
 *                 and no other party observed or relied on the intermediate.
 *   compensable   another party can observe or rely on it, but a compensating
 *                 action is available TO THE ACTOR.
 *   irreversible  no compensating action is available. The effect stands.
 *
 * This replaces the earlier `consequential: boolean` + `reversibility` pair,
 * which could express `consequential: true, reversibility: free` — a type that
 * was legal to write and silently discarded. One ordinal removes the
 * redundancy and adds the `reversible` tier the pair could not express.
 *
 * Two consequences of ACV's definitions that are easy to get wrong:
 * observation by another party defeats `reversible`, and `compensable`
 * requires the compensating action to be available to the ACTOR — an effect
 * only a more privileged party can undo is `irreversible` from here.
 */
export type Consequence = 'none' | 'reversible' | 'compensable' | 'irreversible';

export const CONSEQUENCES: readonly Consequence[] = ['none', 'reversible', 'compensable', 'irreversible'];

export type MatchValue = Scalar | Scalar[] | { pattern: string };

export interface EventType {
  id: string;
  kind: EventKind;
  match: Record<string, MatchValue>;
  /** What acting costs (ACV §6.3). `none` types are never mining subjects. */
  consequence: Consequence;
  /**
   * Whether an advisory system MAY propose this action (ACV §6.4). REQUIRED
   * in the document when `consequence` is `irreversible` — the author is
   * obliged to decide exactly where a wrong default is unbounded — and
   * defaults to true otherwise.
   *
   * `false` does not prohibit the action. It states that proposing it is not
   * an advisory engine's business: the decision belongs to a human.
   */
  recommendable: boolean;
  /** If present, only these slots are kept. Otherwise every slot is kept (redacted). */
  slots?: string[];
  /** For a one-line description a reviewer reads instead of the id. */
  label?: string;
}

export interface OutcomeRule {
  label: string;
  when:
    | { any_event: string }
    | { closed_without: string }
    | { result: string }
    | { hint: string; equals: Scalar };
}

export interface Alphabet {
  corpus: string;
  version: number;
  eventTypes: EventType[];
  outcomes: OutcomeRule[];
  redaction: RedactionConfig;
  /** The default kind when a matched entry omits one, keyed by the `speaker` feature. */
  defaultKinds: Record<string, EventKind>;
}

const DEFAULT_KINDS: Record<string, EventKind> = {
  customer: 'customer_utterance',
  agent: 'agent_utterance',
  action: 'action',
  system: 'system',
};

export class AlphabetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlphabetError';
  }
}

function fail(msg: string): never {
  throw new AlphabetError(msg);
}

function parseKind(v: unknown, where: string): EventKind {
  if (typeof v !== 'string' || !(EVENT_KINDS as readonly string[]).includes(v)) {
    fail(`${where}: kind must be one of ${EVENT_KINDS.join(', ')}`);
  }
  return v as EventKind;
}

/** Parse and validate an alphabet document. Throws on anything ambiguous. */
export function parseAlphabet(text: string, where = 'alphabet'): Alphabet {
  const doc = parse(text) as Record<string, unknown>;
  if (typeof doc !== 'object' || doc === null) fail(`${where}: not a document`);
  if (typeof doc.corpus !== 'string' || !doc.corpus) fail(`${where}: corpus is required`);
  if (!Number.isInteger(doc.version) || (doc.version as number) < 1) fail(`${where}: version must be an integer ≥ 1`);
  const corpus = doc.corpus;

  const defaultKinds: Record<string, EventKind> = { ...DEFAULT_KINDS };
  if (doc.default_kinds !== undefined) {
    if (typeof doc.default_kinds !== 'object' || doc.default_kinds === null) fail(`${where}: default_kinds must be a map`);
    for (const [k, v] of Object.entries(doc.default_kinds as Record<string, unknown>)) {
      defaultKinds[k] = parseKind(v, `${where}: default_kinds.${k}`);
    }
  }

  if (!Array.isArray(doc.event_types)) fail(`${where}: event_types must be a list`);
  const seen = new Set<string>();
  const eventTypes: EventType[] = (doc.event_types as unknown[]).map((raw, i) => {
    const w = `${where}: event_types[${i}]`;
    if (typeof raw !== 'object' || raw === null) fail(`${w}: must be a map`);
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id) fail(`${w}: id is required`);
    if (e.id === UNKNOWN_TYPE) fail(`${w}: '${UNKNOWN_TYPE}' is reserved`);
    if (seen.has(e.id)) fail(`${w}: duplicate id ${e.id}`);
    seen.add(e.id);
    if (typeof e.match !== 'object' || e.match === null || Object.keys(e.match).length === 0) {
      fail(`${w} (${e.id}): match must be a non-empty map`);
    }
    const match = e.match as Record<string, MatchValue>;
    let kind: EventKind;
    if (e.kind !== undefined) kind = parseKind(e.kind, `${w} (${e.id})`);
    else {
      const speaker = match.speaker;
      const k = typeof speaker === 'string' ? defaultKinds[speaker] : undefined;
      if (!k) fail(`${w} (${e.id}): kind is required when match.speaker is not a known speaker`);
      kind = k;
    }
    // ACV §6.3/§6.4. `consequence` is a factual declaration about what the
    // world permits; `recommendable` is the policy decision laid on top of it.
    // The pair `consequential` + `reversibility` this replaced is refused
    // outright rather than translated: a silent migration of a field every
    // downstream figure depends on is exactly the change nobody notices.
    if (e.consequential !== undefined || e.reversibility !== undefined) {
      fail(
        `${w} (${e.id}): 'consequential' and 'reversibility' were replaced by ACV's 'consequence' ordinal ` +
          `(none | reversible | compensable | irreversible). consequential:false → none, costly → compensable, ` +
          `free → none, irreversible → irreversible + an explicit 'recommendable'.`,
      );
    }
    // Any kind may declare a consequence. The pair this replaced put no kind
    // restriction on `consequential`, so a `system` event that moves money —
    // a disbursement the environment records rather than the agent — was a
    // legal mining subject, and silently making it unexpressible would be a
    // capability removed under cover of an encoding change.
    // `kind: action` MUST declare one (ACV §6.3: a producer that cannot
    // determine a consequence declares `irreversible`, never omits it);
    // everything else defaults to `none`, which is what an utterance is.
    let consequence: Consequence = 'none';
    if (e.consequence !== undefined) {
      if (typeof e.consequence !== 'string' || !(CONSEQUENCES as readonly string[]).includes(e.consequence)) {
        fail(`${w} (${e.id}): consequence must be one of ${CONSEQUENCES.join(' | ')}`);
      }
      consequence = e.consequence as Consequence;
    } else if (kind === 'action') {
      fail(`${w} (${e.id}): an action type must declare consequence: ${CONSEQUENCES.join(' | ')}`);
    }
    // Required exactly where a wrong default is unbounded (ACV §6.4).
    if (consequence === 'irreversible' && typeof e.recommendable !== 'boolean') {
      fail(`${w} (${e.id}): an irreversible action must declare recommendable: true | false — no default applies`);
    }
    if (e.recommendable !== undefined && typeof e.recommendable !== 'boolean') {
      fail(`${w} (${e.id}): recommendable must be a boolean`);
    }
    const out: EventType = { id: e.id, kind, match, consequence, recommendable: e.recommendable !== false };
    if (e.slots !== undefined) {
      if (!Array.isArray(e.slots) || !e.slots.every((s) => typeof s === 'string')) fail(`${w} (${e.id}): slots must be a list of names`);
      out.slots = e.slots as string[];
    }
    if (typeof e.label === 'string') out.label = e.label;
    return out;
  });

  const outcomes: OutcomeRule[] = [];
  if (doc.outcomes !== undefined) {
    if (!Array.isArray(doc.outcomes)) fail(`${where}: outcomes must be a list`);
    for (const [i, raw] of (doc.outcomes as unknown[]).entries()) {
      const w = `${where}: outcomes[${i}]`;
      if (typeof raw !== 'object' || raw === null) fail(`${w}: must be a map`);
      const o = raw as Record<string, unknown>;
      if (typeof o.label !== 'string' || !o.label) fail(`${w}: label is required`);
      if (typeof o.when !== 'object' || o.when === null) fail(`${w}: when is required`);
      const when = o.when as Record<string, unknown>;
      const keys = Object.keys(when);
      if (keys.length === 0) fail(`${w}: when must name a condition`);
      if ('any_event' in when && typeof when.any_event === 'string') outcomes.push({ label: o.label, when: { any_event: when.any_event } });
      else if ('closed_without' in when && typeof when.closed_without === 'string') outcomes.push({ label: o.label, when: { closed_without: when.closed_without } });
      else if ('result' in when && typeof when.result === 'string') outcomes.push({ label: o.label, when: { result: when.result } });
      else if ('hint' in when && typeof when.hint === 'string' && 'equals' in when) outcomes.push({ label: o.label, when: { hint: when.hint, equals: when.equals as Scalar } });
      else fail(`${w}: when must be one of any_event | closed_without | result | hint+equals`);
    }
  }

  const rules: RedactionRule[] = [];
  if (doc.redaction !== undefined) {
    if (!Array.isArray(doc.redaction)) fail(`${where}: redaction must be a list`);
    for (const [i, raw] of (doc.redaction as unknown[]).entries()) {
      const w = `${where}: redaction[${i}]`;
      if (typeof raw !== 'object' || raw === null) fail(`${w}: must be a map`);
      const r = raw as Record<string, unknown>;
      if (r.strategy !== 'token' && r.strategy !== 'hash' && r.strategy !== 'drop') fail(`${w}: strategy must be token | hash | drop`);
      if (typeof r.slot === 'string') {
        const rule: RedactionRule = { slot: r.slot, strategy: r.strategy };
        if (r.except !== undefined) {
          if (r.slot !== '*') fail(`${w}: except only applies to the '*' wildcard`);
          if (!Array.isArray(r.except) || !r.except.every((s) => typeof s === 'string')) fail(`${w}: except must be a list of slot names`);
          rule.except = r.except as string[];
        }
        if (r.unless !== undefined) {
          if (!Array.isArray(r.unless)) fail(`${w}: unless must be a list of values`);
          rule.unless = (r.unless as unknown[]).map(String);
        }
        if (r.unless_pattern !== undefined) {
          if (typeof r.unless_pattern !== 'string') fail(`${w}: unless_pattern must be a string`);
          rule.unlessPattern = r.unless_pattern;
        }
        rules.push(rule);
      } else if (r.pattern === 'email' || r.pattern === 'phone' || r.pattern === 'digits') {
        const rule: RedactionRule = { pattern: r.pattern, strategy: r.strategy };
        if (typeof r.min_digits === 'number') rule.minDigits = r.min_digits;
        rules.push(rule);
      } else fail(`${w}: must name a slot or a pattern (email | phone | digits)`);
    }
  }

  return { corpus, version: doc.version as number, eventTypes, outcomes, redaction: { corpus, rules }, defaultKinds };
}

export function loadAlphabet(file: string): Alphabet {
  return parseAlphabet(readFileSync(file, 'utf8'), file);
}

// ---------------------------------------------------------------------------
// Matching

function matchesValue(actual: Scalar | undefined, expected: MatchValue): boolean {
  if (actual === undefined) return false;
  if (Array.isArray(expected)) return expected.some((e) => e === actual);
  if (typeof expected === 'object' && expected !== null) {
    return typeof actual === 'string' && new RegExp(expected.pattern).test(actual);
  }
  return actual === expected;
}

/** The first event type whose match holds, in document order. */
export function classify(alphabet: Alphabet, features: Record<string, Scalar>): EventType | undefined {
  return alphabet.eventTypes.find((t) => Object.entries(t.match).every(([k, v]) => matchesValue(features[k], v)));
}

/**
 * An id may carry `${feature}` placeholders — `intent:${intent}` — so a
 * corpus with fifty classified intents needs one entry, not fifty. The type
 * an event ends up with is always materialised: nothing downstream sees the
 * template. A placeholder with no value in the features is an `unknown`
 * event, not a type named "undefined".
 */
export function resolveTypeId(t: EventType, features: Record<string, Scalar>): string {
  if (!t.id.includes('${')) return t.id;
  let missing = false;
  const id = t.id.replace(/\$\{([a-zA-Z0-9_.]+)\}/g, (_, k: string) => {
    const v = features[k];
    if (v === undefined || v === null || v === '') {
      missing = true;
      return '';
    }
    return String(v).toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
  });
  return missing ? UNKNOWN_TYPE : id;
}

/**
 * The floor below which constraint mining produces regularities that are true
 * and unenforceable (ACV §8.2, which asks for a configured floor and asks that
 * it default to `compensable`).
 *
 * `none` is obvious — a read or a note changes nothing outside the acting
 * system. `reversible` is the tier the old `consequential` + `reversibility`
 * pair could not express and nothing yet uses: an effect the actor can undo at
 * negligible cost that no other party observed. An obligation guarding one
 * costs a reviewer's attention and buys nothing, because the mistake it
 * prevents is free to make.
 *
 * Not yet a CLI threshold. It becomes one the day an alphabet declares a
 * `reversible` type, which is the first day the choice can change a figure.
 */
export const MINING_FLOOR: Consequence = 'compensable';

const atLeast = (c: Consequence, floor: Consequence): boolean => CONSEQUENCES.indexOf(c) >= CONSEQUENCES.indexOf(floor);

/** The subjects mining runs over: every type at or above the floor (F3.2, ACV §8.2). */
export function consequentialTypes(alphabet: Alphabet, floor: Consequence = MINING_FLOOR): Set<string> {
  return new Set(alphabet.eventTypes.filter((t) => atLeast(t.consequence, floor)).map((t) => t.id));
}

/**
 * The actions an advisory system may PROPOSE (ACV §6.4, F4.2). A subset of
 * the mining subjects: an action can be worth an obligation — "never do this
 * without X" — while proposing it stays a human's decision. Recommendation
 * mining is gated on this; obligation mining is not.
 */
export function recommendableTypes(alphabet: Alphabet, floor: Consequence = MINING_FLOOR): Set<string> {
  return new Set(alphabet.eventTypes.filter((t) => atLeast(t.consequence, floor) && t.recommendable).map((t) => t.id));
}

// ---------------------------------------------------------------------------
// Application: RawInteraction → Interaction

function typeEvent(alphabet: Alphabet, e: RawEvent, seq: number): Event {
  const t = classify(alphabet, e.features);
  let slots = e.slots;
  if (t?.slots) {
    const keep = new Set(t.slots);
    slots = Object.fromEntries(Object.entries(slots).filter(([k]) => keep.has(k)));
  }
  const type = t ? resolveTypeId(t, e.features) : UNKNOWN_TYPE;
  // Unmatched — or matched to a template whose placeholder is empty — has
  // type `unknown` and, when the speaker feature says what it was, that
  // speaker's kind: an unknown ACTION still counts as an action in the
  // audit's breakdown. Nothing with type `unknown` is ever mined.
  const speaker = e.features.speaker;
  const kind: EventKind = t && type !== UNKNOWN_TYPE ? t.kind : (typeof speaker === 'string' && alphabet.defaultKinds[speaker]) || 'unknown';
  const out: Event = {
    seq,
    at: e.at,
    episode: UNSEGMENTED,
    kind,
    type,
    slots: redactSlots(slots, alphabet.redaction),
    raw: e.raw,
  };
  if (e.result !== undefined) out.result = e.result;
  return out;
}

function deriveOutcome(alphabet: Alphabet, raw: RawInteraction, events: Event[]): Outcome | undefined {
  if (raw.outcome) return raw.outcome;
  const last = events[events.length - 1];
  const at = last?.at ?? raw.startedAt;
  for (const rule of alphabet.outcomes) {
    const w = rule.when;
    let hit = false;
    if ('any_event' in w) hit = events.some((e) => e.type === w.any_event);
    else if ('closed_without' in w) hit = !events.some((e) => e.type === w.closed_without);
    else if ('result' in w) hit = last?.result === w.result;
    else hit = raw.hints?.[w.hint] === w.equals;
    if (hit) return { label: rule.label, at, lagMs: 0, source: 'in_band' };
  }
  return undefined;
}

/** Type, redact and label one raw interaction. Episodes stay `unsegmented`. */
export function applyAlphabet(alphabet: Alphabet, raw: RawInteraction): Interaction {
  const sorted = [...raw.events].sort((a, b) => a.at - b.at);
  const events = sorted.map((e, i) => typeEvent(alphabet, e, i));
  const out: Interaction = {
    id: raw.id,
    corpus: raw.corpus,
    actor: { ...raw.actor },
    startedAt: raw.startedAt,
    events,
  };
  const outcome = deriveOutcome(alphabet, raw, events);
  if (outcome) out.outcome = outcome;
  if (raw.facts) out.facts = redactSlots(raw.facts, alphabet.redaction);
  return out;
}
