// The run manifest (TS §11). Every command writes one: corpus revision,
// alphabet version, thresholds, seed, code commit and — where generated —
// backbone and policy revision. A figure without that stamp is not
// reproducible and should not leave the machine.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Thresholds } from './thresholds.ts';

export interface Manifest {
  runId: string;
  command: string;
  at: number;
  corpus: string;
  corpusRevision: string;
  alphabetVersion: number;
  alphabetFile: string;
  thresholds: Thresholds;
  seed: number;
  codeCommit: string | null;
  segmenter: string;
  /**
   * Observation (JF6.2). Present only on a run that read annotations.
   *
   * `predicateSetVersion` pins the declared questions and their bands;
   * `annotationDigest` pins the recorded answers, and is computed exactly as
   * `corpusRevision` is so the two read alike in a manifest. A figure carrying
   * both is reproducible by anyone holding that annotation file, with no key
   * and no network — which is the whole reason the model is called in a
   * separate pass rather than during mining.
   */
  predicateSetVersion?: number;
  annotationDigest?: string;
  /** A pass that stopped on its budget (JT8.5). The figure is still usable; it is not complete. */
  annotationPartial?: boolean;
  /** Generated corpora only: what produced the trajectories. */
  backbone?: string;
  policyRevision?: string;
  /** Everything else the adapter knows about the source (simulator, benchmark commit, seed). */
  source?: Record<string, string>;
}

/**
 * sha256 over the source's bytes — a file, or every file under a directory in
 * sorted order. Paths inside a directory are hashed RELATIVE to it, so the
 * same corpus in two checkouts has one revision.
 */
export function corpusRevision(source: string): string {
  const h = createHash('sha256');
  const walk = (p: string, rel: string) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const name of readdirSync(p).sort()) walk(join(p, name), rel ? `${rel}/${name}` : name);
      return;
    }
    h.update(rel);
    h.update(readFileSync(p));
  };
  walk(source, '');
  return h.digest('hex').slice(0, 16);
}

export function codeCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

export function newRunId(command: string, at: number): string {
  return `${command}-${new Date(at).toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${createHash('sha1')
    .update(`${command}${at}${process.pid}`)
    .digest('hex')
    .slice(0, 6)}`;
}
