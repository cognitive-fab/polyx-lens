// A CONTRACT SET: rules an agent was told to follow, written down, in a form
// that can be checked against what it actually did.
//
// **This is not an answer key.** A clause set under `polyx-bench` or
// `polyx-eval` decomposes someone's rulebook in order to *score the miner*, and
// never ships. A contract set decomposes the rules a harness publishes about
// itself — "read the file before editing it" — and ships WITH the product,
// because a reader's first run has to say something true with no configuration
// at all. Same shape, opposite purpose, and the distinction is why
// `check-shippable.mjs` allows one and refuses the other.
//
// The vocabulary is deliberately the same as the evaluation side's: whatever a
// contract can state, a clause can state, so a contract set can later be
// measured against the miner exactly like any other clause set.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { Scalar } from '../record.ts';

/** What a clause says, in the only two shapes a precedence-and-absence language has. */
export interface Contract {
  id: string;
  text: string;
  /**
   * Can this be checked at all? A written rule about intent, about a flag on a
   * command, or about the content of an argument is real guidance that this
   * language cannot state — recorded with a reason rather than dropped, because
   * the honest denominator says how much was left out.
   */
  expressible: boolean;
  reason?: string;
  /** Verbatim from the source, or reconstructed? A reconstruction is weaker evidence. */
  quoted?: boolean;
  shape?: 'precedence' | 'at-most-one';
  /**
   * The span the rule is measured over. **This is part of what a rule SAYS**,
   * not a tuning knob: "read the file before editing it" is scoped by the Edit
   * contract to *this conversation*, while "review what is staged before
   * committing" is about the piece of work in hand.
   *
   * Defaults to `episode`, which is the stricter reading and the right one
   * wherever a contact holds a single task. On a corpus whose sessions hold
   * twenty, the difference is most of the answer — checking a
   * conversation-scoped rule per episode reported 1,833 violations of
   * `cc-read-before-write` where the contract's own wording gives far fewer.
   */
  window?: 'episode' | 'interaction';
  subject?: string;
  guard?: string;
  /** Does the source list the two steps side by side, or merely in order? */
  adjacent?: boolean;
  /** Absent = the clause holds everywhere. */
  when?: { fact: string; value: Scalar };
}

export interface ContractSet {
  /** Stable name, e.g. `claude-code`. */
  contracts: string;
  version: number;
  /** Where the wording came from — a URL, a file, a prompt. */
  source?: string;
  /** What this set does NOT cover. A contract set that claims completeness is lying. */
  scope?: string;
  clauses: Contract[];
}

export function parseContracts(text: string, where = 'contracts'): ContractSet {
  const doc = parse(text) as Record<string, unknown>;
  if (typeof doc?.contracts !== 'string') throw new Error(`${where}: a contract set needs a name`);
  if (!Number.isInteger(doc.version)) throw new Error(`${where}: version must be an integer`);
  if (!Array.isArray(doc.clauses)) throw new Error(`${where}: clauses must be a list`);
  const clauses = (doc.clauses as Record<string, unknown>[]).map((c, i) => {
    const at = `${where}: clause ${typeof c.id === 'string' ? c.id : i}`;
    if (typeof c.id !== 'string' || typeof c.text !== 'string') throw new Error(`${at} needs an id and text`);
    if (typeof c.expressible !== 'boolean') throw new Error(`${at} must say whether it is expressible`);
    if (!c.expressible) {
      // The reason is the whole value of recording an inexpressible clause: it
      // turns "we cannot check that" into a specific, arguable statement.
      if (typeof c.reason !== 'string' || !c.reason) throw new Error(`${at} is inexpressible and must say why`);
      return { id: c.id, text: c.text, expressible: false, reason: c.reason, ...(typeof c.quoted === 'boolean' ? { quoted: c.quoted } : {}) } as Contract;
    }
    if (c.shape !== 'precedence' && c.shape !== 'at-most-one') throw new Error(`${at} is expressible and needs a shape`);
    if (typeof c.subject !== 'string') throw new Error(`${at} needs a subject`);
    if (c.shape === 'precedence' && typeof c.guard !== 'string') throw new Error(`${at} is a precedence and needs a guard`);
    if (c.window !== undefined && c.window !== 'episode' && c.window !== 'interaction') throw new Error(`${at}: window must be episode or interaction`);
    const out: Contract = { id: c.id, text: c.text, expressible: true, shape: c.shape, subject: c.subject, window: (c.window as 'episode' | 'interaction') ?? 'episode' };
    if (typeof c.guard === 'string') out.guard = c.guard;
    if (typeof c.adjacent === 'boolean') out.adjacent = c.adjacent;
    if (typeof c.quoted === 'boolean') out.quoted = c.quoted;
    if (typeof c.reason === 'string') out.reason = c.reason;
    if (c.when && typeof c.when === 'object') {
      const w = c.when as { fact?: unknown; value?: unknown };
      if (typeof w.fact !== 'string') throw new Error(`${at}: when needs a fact`);
      out.when = { fact: w.fact, value: w.value as Scalar };
    }
    return out;
  });
  const set: ContractSet = { contracts: doc.contracts, version: doc.version as number, clauses };
  if (typeof doc.source === 'string') set.source = doc.source;
  if (typeof doc.scope === 'string') set.scope = doc.scope;
  return set;
}

export function loadContracts(file: string): ContractSet {
  return parseContracts(readFileSync(file, 'utf8'), file);
}
