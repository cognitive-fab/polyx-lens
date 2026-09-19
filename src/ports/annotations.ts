// The annotation store (JT3). One line per (site, predicate), newline-
// delimited JSON, sorted so the file is stable and diffable, digested so the
// manifest can pin it.
//
// This is the file that makes mining reproducible after a model has been
// consulted. A Jev call is not bit-stable — the vendor says "similar answers
// for similar inputs", and sampling is parallel — so the answers are recorded
// ONCE, in a separate pass, and everything downstream reads the recording.
// Same corpus, same alphabet, same thresholds, same annotation file: same
// rule set, byte for byte. The digest is the pin.
//
// Reading lives in the free half because `polyx-lens` has to be able to read
// an annotation file to produce its report. Writing lives here too, because
// it is pure file IO and the part that must never vary — sort order, the
// digest, the partial marker — belongs beside the reader that depends on it.
// The only thing not here is the call that produces a line's `p`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cmp } from '../order.ts';

export interface AnnotationLine {
  /** interactionId */
  i: string;
  /** episodeId */
  e: string;
  seq: number;
  /** predicate id */
  pred: string;
  /** Raw probability, retained on every line including withheld (JT3.3). */
  p: number;
  fact: string;
  /** true | false | null. null is a RECORDED withholding and is always written (JT3.2). */
  value: boolean | null;
  /** predicate-set version */
  pv: number;
  /** The text redaction profile the text left under (JT7.1). */
  redaction: string;
  /** sha256 of the redacted text sent, 16 hex — the text-cache key, and how a reader confirms two sites shared one call (JT3.1). */
  sha: string;
  /** Unix seconds of the call. */
  at: number;
  /**
   * Whatever else the answer carried, verbatim and unread (W0.3). Kept for
   * the same reason `p` is: retaining a field costs bytes, discarding it
   * costs a fresh pass over the corpus.
   */
  raw?: Record<string, unknown>;
}

/** The order every file is written in (JT3): stable, so two passes over one corpus diff line by line. */
export function sortLines(lines: AnnotationLine[]): AnnotationLine[] {
  return [...lines].sort((a, b) => cmp(a.i, b.i) || cmp(a.e, b.e) || a.seq - b.seq || cmp(a.pred, b.pred));
}

export function serialiseLines(lines: AnnotationLine[]): string {
  return sortLines(lines)
    .map((l) => JSON.stringify(l))
    .join('\n') + (lines.length ? '\n' : '');
}

/** JT3.5 — sha256 over the file bytes, 16 hex, exactly as `corpusRevision` is. */
export function digestOf(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

export interface AnnotationFile {
  path: string;
  digest: string;
  partial: boolean;
  lines: AnnotationLine[];
}

/**
 * JT3.4 — write to a temporary path, digest, rename. A reader never sees a
 * half-written file. A pass that stopped on its budget is renamed with a
 * `.partial` marker (JT8.5): usable, and visibly incomplete.
 */
export function writeAnnotations(path: string, lines: AnnotationLine[], opts: { partial?: boolean } = {}): AnnotationFile {
  const body = serialiseLines(lines);
  const digest = digestOf(body);
  const final = opts.partial ? path.replace(/\.jsonl$/, '.partial.jsonl') : path;
  mkdirSync(dirname(final), { recursive: true });
  const tmp = `${final}.${process.pid}.tmp`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, final);
  return { path: final, digest, partial: Boolean(opts.partial), lines: sortLines(lines) };
}

export function readAnnotations(path: string): AnnotationFile | null {
  const partialPath = path.replace(/\.jsonl$/, '.partial.jsonl');
  const actual = existsSync(path) ? path : existsSync(partialPath) ? partialPath : null;
  if (!actual) return null;
  const body = readFileSync(actual, 'utf8');
  const lines: AnnotationLine[] = body
    .split('\n')
    .filter((l) => l.trim())
    .map((l, n) => {
      const o = JSON.parse(l) as AnnotationLine;
      if (typeof o.i !== 'string' || typeof o.pred !== 'string' || typeof o.p !== 'number' || !('value' in o)) {
        throw new Error(`${actual}:${n + 1}: not an annotation line`);
      }
      return o;
    });
  return { path: actual, digest: digestOf(body), partial: actual !== path, lines };
}

/** The path an annotation file lives at (JF6.1). */
export function annotationPath(workspace: string, corpus: string, predicateSetVersion: number): string {
  return `${workspace}/annotations/${corpus}@${predicateSetVersion}.jsonl`;
}

/** Observed facts at one site, keyed by fact name: what the miner and the replay read. */
export function factsAt(file: AnnotationFile, interactionId: string, episodeId: string, seq: number): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const l of file.lines) {
    if (l.i === interactionId && l.e === episodeId && l.seq === seq && l.value !== null) out[l.fact] = l.value;
  }
  return out;
}

/** An index for the miner: every line at a site, in one lookup. */
export function indexAnnotations(file: AnnotationFile): Map<string, AnnotationLine[]> {
  const idx = new Map<string, AnnotationLine[]>();
  for (const l of file.lines) {
    const k = `${l.i}\u0000${l.e}\u0000${l.seq}`;
    let a = idx.get(k);
    if (!a) idx.set(k, (a = []));
    a.push(l);
  }
  return idx;
}

export const siteKey = (interactionId: string, episodeId: string, seq: number): string => `${interactionId}\u0000${episodeId}\u0000${seq}`;

export interface AnnotationDiff {
  /** Sites present in both. */
  shared: number;
  /** Emitted fact changed: true↔false, or emitted↔withheld. The drift figure (JF6.6). */
  changed: number;
  /** Withheld in both, but p moved by more than the jitter. Not drift, but worth seeing. */
  moved: number;
  onlyBefore: number;
  onlyAfter: number;
  /** Which predicates drifted, and how much. */
  byPredicate: Record<string, { shared: number; changed: number }>;
}

/**
 * JF6.6 — `annotate --diff`. Re-annotating an unchanged corpus with an
 * unchanged predicate set produces a different file, because `p` jitters.
 * How many EMITTED FACTS changed is the drift measurement, and if the bands
 * are separated per JT4 it should be near zero. When it is not, either the
 * bands sit where the samples are — JT4.2 — or the vendor moved the model
 * under `jev-latest`, and this is the only detector for that until dated
 * ids exist.
 */
export function diffAnnotations(before: AnnotationFile, after: AnnotationFile, jitter = 0.01): AnnotationDiff {
  const key = (l: AnnotationLine) => `${siteKey(l.i, l.e, l.seq)}\u0000${l.pred}`;
  const a = new Map(before.lines.map((l) => [key(l), l]));
  const b = new Map(after.lines.map((l) => [key(l), l]));
  const byPredicate: Record<string, { shared: number; changed: number }> = {};
  let shared = 0;
  let changed = 0;
  let moved = 0;
  for (const [k, x] of a) {
    const y = b.get(k);
    if (!y) continue;
    shared++;
    const bp = (byPredicate[x.pred] ??= { shared: 0, changed: 0 });
    bp.shared++;
    if (x.value !== y.value) {
      changed++;
      bp.changed++;
    } else if (Math.abs(x.p - y.p) > jitter + 1e-9) {
      moved++;
    }
  }
  return {
    shared,
    changed,
    moved,
    onlyBefore: before.lines.length - shared,
    onlyAfter: after.lines.length - shared,
    byPredicate,
  };
}
