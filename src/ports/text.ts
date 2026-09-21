// The text-resolution port. It exists because of a deliberate absence: the
// canonical record has no `text` field, and `alphabet/redact.ts` states the
// reason as a commitment — "free text is never persisted at all, so this
// module only ever sees slots".
//
// That commitment is what makes polyx's privacy claim inspectable, and it is
// not being weakened here. Text still lives only in the analyst's source
// files, at the far end of an event's `RawRef`. What this port adds is a way
// to READ it, per adapter, at the moment a predicate needs it — and only then.
//
// A resolver is a pure function from ONE RESOLVED RAW RECORD to the utterance
// it carries. It does no file IO: following a `RawRef` into a source file is
// the caller's job, which keeps the set of modules that touch source content
// small and nameable (`show.ts` in polyx, and the annotation pass).
//
// An adapter with no resolver is not a defect. A BPIC event log carries no
// utterances at all, and the honest result is that the corpus is
// UNANNOTATABLE, reported as such rather than annotated with empty strings.
import type { Scalar } from '../record.ts';

export interface TextSource {
  readonly name: string;
  /**
   * The utterance in one resolved raw record, or null when it carries none.
   * Pure; never reads a file. Returning null is normal — an action turn, a
   * tool result, a segment of a shell command — and it means the site has no
   * text for a predicate to read, not that the predicate failed.
   */
  text(raw: unknown): string | null;
}

/** The default, and the right answer for any corpus without utterances. */
export const nullTextSource: TextSource = {
  name: 'null',
  text: () => null,
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * The synthetic fixture. Its turns carry `text` precisely so the redaction
 * scan can prove free text never reaches a stored artefact; here it is also
 * what makes the fixture a usable oracle for the whole observation path
 * (JT9.4), offline and with no key.
 */
export const syntheticTextSource: TextSource = {
  name: 'synthetic',
  text(raw) {
    const t = obj(raw);
    return t ? str(t.text) : null;
  },
};

/**
 * ABCD. A `delexed` turn is `{ speaker, text, turn_count, targets }`. Agent
 * and customer text carry `<account_id>`-style tokens already, but ACTION
 * turns often carry literal values in their prose ("account has been pulled up
 * for crystal minh."), which is why the adapter drops action text and why this
 * resolver does too. Redaction still runs downstream; this is defence in
 * depth, not a substitute for it.
 */
export const abcdTextSource: TextSource = {
  name: 'abcd',
  text(raw) {
    const t = obj(raw);
    if (!t) return null;
    if (t.speaker === 'action') return null;
    return str(t.text);
  },
};

/**
 * Claude Code sessions. A `RawRef` here points at one of three things,
 * because the adapter emits at three granularities:
 *
 *   /<line>                      a whole JSONL record, `message.content` a string
 *   /<line>/content/<block>      one content block: text, tool_use, tool_result
 *   /<line>/content/<block>/segment/<n>   one segment of a shell command
 *
 * The third does not resolve through a JSON pointer — there is no `segment`
 * key in the source — so the caller passes the block and this returns the
 * block's text. A segment's own text is the command string, which is an
 * argument value rather than an utterance, and is the case `source:
 * slot.<name>` is for.
 */
export const ccTextSource: TextSource = {
  name: 'cc',
  text(raw) {
    const r = obj(raw);
    if (!r) return null;
    // A whole record: user or assistant turn whose content is a plain string.
    const message = obj(r.message);
    if (message) {
      const content = message.content;
      if (typeof content === 'string') return str(content);
      return null;
    }
    // A content block.
    if (r.type === 'text') return str(r.text);
    if (r.type === 'tool_result') {
      const c = r.content;
      if (typeof c === 'string') return str(c);
      // A tool result's content is sometimes an array of blocks of its own.
      if (Array.isArray(c)) {
        const parts = c.map((b) => (obj(b)?.type === 'text' ? str(obj(b)!.text) : null)).filter((s): s is string => s !== null);
        return parts.length ? parts.join('\n') : null;
      }
      return null;
    }
    return null;
  },
};

const SOURCES: Record<string, TextSource> = {
  synthetic: syntheticTextSource,
  abcd: abcdTextSource,
  cc: ccTextSource,
  // tau2 and bpic have none, on purpose: one is a simulated tool trace and the
  // other an event log. Both resolve to `nullTextSource` and are reported as
  // unannotatable rather than silently observed over empty text.
};

export function textSourceFor(adapter: string): TextSource {
  return SOURCES[adapter] ?? nullTextSource;
}

/** Corpora whose adapter can supply text — what `audit` reports as annotatable. */
export function annotatableAdapters(): string[] {
  return Object.keys(SOURCES).sort();
}

export function registerTextSource(adapter: string, source: TextSource): void {
  SOURCES[adapter] = source;
}

/**
 * `episode.text`: the resolved event texts in `seq` order, joined. Composed
 * here rather than resolved separately so that a predicate reading an episode
 * and one reading an event are reading the same strings.
 *
 * Note for the review page (JT2.3, and the Control A measurement behind it): a
 * wider window is not free. Handing the model a more complete-looking record
 * made it MORE confident and no more correct on the cases where the missing
 * fact was missing from the wider window too. Prefer `event` unless the
 * question genuinely spans turns.
 */
export function joinEpisodeText(texts: Array<string | null>): string | null {
  const parts = texts.filter((t): t is string => t !== null && t.trim() !== '');
  return parts.length ? parts.join('\n') : null;
}

/** What a `source: slot.<name>` predicate reads. */
export function slotText(slots: Record<string, Scalar>, name: string): string | null {
  const v = slots[name];
  return v === undefined || v === null ? null : String(v);
}
