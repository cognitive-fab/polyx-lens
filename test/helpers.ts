// Shared test scaffolding. The fixtures are the ones this package ships, so a
// test reads what a dependent reads.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../src/config.ts';
import { alphabetsDir, fixturesDir } from '../src/lens/builtin.ts';
import { withThresholds, type Thresholds } from '../src/thresholds.ts';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const FIXTURES = fixturesDir();
export const ALPHABETS = alphabetsDir();
export const SYNTHETIC_SOURCE = join(FIXTURES, 'synthetic', 'synthetic.json');
export const SYNTHETIC_ALPHABET = join(ALPHABETS, 'alphabet.synthetic.yaml');

export interface TempWorkspace {
  dir: string;
  config: Config;
  thresholds: Thresholds;
  cleanup: () => void;
}

export function tempWorkspace(overrides: Partial<Thresholds> = {}): TempWorkspace {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-lens-'));
  const thresholds = withThresholds(overrides);
  const config: Config = {
    root: ROOT,
    policyRoots: [join(FIXTURES, 'synthetic')],
    workspace: dir,
    dbPath: join(dir, 'polyx.db'),
    corpora: {
      synthetic: { adapter: 'synthetic', source: SYNTHETIC_SOURCE, alphabet: SYNTHETIC_ALPHABET },
    },
    thresholds,
    segmenter: 'null',
    seed: 1,
  };
  return { dir, config, thresholds, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Collect output lines from a CLI invocation. */
export function capture() {
  const lines: string[] = [];
  const errs: string[] = [];
  return { lines, errs, out: (s: string) => lines.push(s), err: (s: string) => errs.push(s), text: () => lines.join('\n') };
}
