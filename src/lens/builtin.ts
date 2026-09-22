// Where the artefacts that ship with this package live.
//
// Contract sets, alphabets and the sample corpus are data, not code, so they
// are not importable — and this package is consumed both as TypeScript source
// (its own tests, running under Node's type stripping) and as built JavaScript
// under `dist/` (every dependent). The directories sit at different depths in
// those two cases, so resolve them by walking up to this package's own
// `package.json` rather than by counting `..`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/** This package's own root, wherever it has been installed. */
export function packageRoot(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === '@cognitive-fab/polyx-lens') return (cached = dir);
      } catch {
        // a malformed package.json on the way up is not ours; keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('polyx-lens: cannot locate the package root, so the artefacts shipped with it are unreachable');
}

/** The `contracts/` directory shipped inside this package. */
export function contractsDir(): string {
  return join(packageRoot(), 'contracts');
}

/**
 * The `alphabets/` directory shipped inside this package.
 *
 * An alphabet is a REVIEWED artefact — the typing, redaction and consequence
 * rulings for one corpus family — and the ones here are the reviewed set for
 * the corpora this package can read. A deployment that types its own system
 * writes its own and names it by path; these are the defaults, not a ceiling.
 */
export function alphabetsDir(): string {
  return join(packageRoot(), 'alphabets');
}

/** The `fixtures/` directory shipped inside this package. */
export function fixturesDir(): string {
  return join(packageRoot(), 'fixtures');
}

/**
 * The contract set shipped for a system, or `null` when none is.
 *
 * Keyed by the SYSTEM rather than the corpus: two corpora of one harness share
 * its contracts, exactly as several corpora can share a domain. `:` is legal in
 * a domain name and not in a filename everywhere.
 */
export function builtinContracts(domain: string): string | null {
  const file = join(contractsDir(), `${domain.replace(/:/g, '-')}.yaml`);
  return existsSync(file) ? file : null;
}

/** A shipped alphabet by filename, or `null` when this package carries none. */
export function builtinAlphabet(name: string): string | null {
  const file = join(alphabetsDir(), name);
  return existsSync(file) ? file : null;
}

/**
 * The predicate set shipped for a corpus family, or `null` when none is.
 *
 * Keyed by the alphabet's corpus family rather than the configured corpus
 * name, for the same reason the alphabet is: `cc` and `cc-mimo` are both
 * Claude Code under one set of declared predicates, and two copies of a
 * reviewed artefact drift.
 *
 * Absent is normal and is not an error. A corpus with no predicate set is a
 * corpus that mines exactly as it does today (JF6.5).
 */
export function builtinPredicates(corpusFamily: string): string | null {
  const file = join(alphabetsDir(), `predicates.${corpusFamily.replace(/:/g, '-')}.yaml`);
  return existsSync(file) ? file : null;
}

/**
 * The text redaction profile shipped for a corpus family, or `null`. Keyed
 * as the alphabet and the predicate set are. Absent means the corpus cannot
 * be annotated, and `annotate` refuses it by name (JT7.2) — failing closed is
 * the point, not an inconvenience.
 */
export function builtinTextProfile(corpusFamily: string): string | null {
  const file = join(alphabetsDir(), `text.${corpusFamily.replace(/:/g, '-')}.yaml`);
  return existsSync(file) ? file : null;
}
