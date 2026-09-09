// Where the shipped contract sets live.
//
// A contract set is data, not code, so it is not importable — and this package
// is consumed both as TypeScript source (its own tests, running under Node's
// type stripping) and as built JavaScript under `dist/` (every dependent). The
// directory sits at different depths in those two cases, so resolve it by
// walking up to this package's own `package.json` rather than by counting `..`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/** The `contracts/` directory shipped inside this package. */
export function contractsDir(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === 'polyx-lens') {
          return (cached = join(dir, 'contracts'));
        }
      } catch {
        // a malformed package.json on the way up is not ours; keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('polyx-lens: cannot locate the package root, so the built-in contract sets are unreachable');
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
