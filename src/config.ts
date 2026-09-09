// Workspace configuration: `polyx.config.json` in the working directory.
//
//   {
//     "workspace": ".polyx",
//     "corpora": {
//       "synthetic": { "adapter": "synthetic", "source": "test/fixtures/synthetic/synthetic.json",
//                      "alphabet": "alphabets/alphabet.synthetic.yaml" }
//     },
//     "thresholds": { "minInstances": 5 },
//     "segmenter": "null",
//     "policies": ["../polyx-bench/policies", "../polyx-eval/policies"]
//   }
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { withThresholds, type Thresholds } from './thresholds.ts';

export interface CorpusConfig {
  adapter: string;
  source: string;
  alphabet: string;
  /** Domain-level identity for cross-domain provenance ('abcd', 'tau2:retail'). Defaults to the corpus name. */
  domain?: string;
  /**
   * The segmenter this corpus needs, overriding the installation default.
   * Which segmenter is right is a property of the corpus, not of the machine:
   * ABCD holds exactly one task per conversation and `null` is correct there
   * by construction, while a Claude Code session holds a median of twenty and
   * `null` would make one episode of a whole afternoon. `--segmenter` still
   * overrides this, so the comparison between the two stays one command.
   */
  segmenter?: string;
  /**
   * The clause set to evaluate against, when it is not
   * the default name under the policy root. Two corpora can be produced
   * under one rulebook — `cc` and `cc-mimo` are both Claude Code under the same
   * standing rules — and duplicating the decomposition to satisfy a filename
   * would put two copies of an answer key in the repository, which is how they
   * drift.
   *
   * A bare filename resolves against `policyRoot`; anything with a separator
   * resolves against the repository root, which is how a fixture clause set
   * that ships with the tests is named.
   */
  policy?: string;
}

export interface Config {
  root: string;
  /**
   * Where clause sets live, searched in order. **They are not in this
   * repository.** A clause set is an answer key, and a shipped answer key is a
   * shipped evaluation, so they sit in sibling checkouts and a tree that
   * contains one fails `npm run check:shippable`.
   *
   * There are two by default because they are not the same kind of thing.
   * polyx-bench decomposes PUBLIC benchmark rulebooks and is Apache-2.0, so a
   * reader can disagree with a clause rather than with a number. polyx-eval
   * holds what is derived from a private corpus and is licensed to nobody.
   *
   * Order: `POLYX_POLICIES` (colon- or semicolon-separated), then `"policies"`
   * in the config file, then `../polyx-bench/policies` and
   * `../polyx-eval/policies` beside this checkout.
   */
  policyRoots: string[];
  workspace: string;
  dbPath: string;
  corpora: Record<string, CorpusConfig>;
  thresholds: Thresholds;
  segmenter: string;
  seed: number;
}

export const CONFIG_FILE = 'polyx.config.json';

export function loadConfig(cwd = process.cwd(), file = CONFIG_FILE): Config {
  const path = resolve(cwd, file);
  // Paths in the file are relative to the file, not to wherever polyx was started.
  const root = dirname(path);
  const raw = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  const workspace = resolve(root, typeof raw.workspace === 'string' ? raw.workspace : '.polyx');
  const configured = Array.isArray(raw.policies) ? (raw.policies as string[]) : typeof raw.policies === 'string' ? [raw.policies] : ['../polyx-bench/policies', '../polyx-eval/policies'];
  const policyRoots = process.env.POLYX_POLICIES
    ? process.env.POLYX_POLICIES.split(/[;:](?![\\/])/).filter(Boolean).map((d) => resolve(process.cwd(), d))
    : configured.map((d) => resolve(root, d));
  const corpora: Record<string, CorpusConfig> = {};
  for (const [name, c] of Object.entries((raw.corpora as Record<string, unknown>) ?? {})) {
    const cc = c as Record<string, unknown>;
    if (typeof cc.adapter !== 'string' || typeof cc.source !== 'string') {
      throw new Error(`${file}: corpora.${name} needs adapter and source`);
    }
    const out: CorpusConfig = {
      adapter: cc.adapter,
      source: resolve(root, cc.source),
      alphabet: resolve(root, typeof cc.alphabet === 'string' ? cc.alphabet : `alphabets/alphabet.${name}.yaml`),
    };
    if (typeof cc.domain === 'string') out.domain = cc.domain;
    if (typeof cc.segmenter === 'string') out.segmenter = cc.segmenter;
    // A bare filename is looked up in each clause-set root, in order; anything
    // with a separator is a path from the repository root, which is how the
    // fixture clause set that ships with the tests is named.
    if (typeof cc.policy === 'string') {
      out.policy = /[\\/]/.test(cc.policy)
        ? resolve(root, cc.policy)
        : (policyRoots.map((d) => resolve(d, cc.policy as string)).find((f) => existsSync(f)) ?? resolve(policyRoots[0]!, cc.policy));
    }
    corpora[name] = out;
  }
  return {
    root,
    policyRoots,
    workspace,
    dbPath: resolve(workspace, 'polyx.db'),
    corpora,
    thresholds: withThresholds(raw.thresholds as Partial<Thresholds> | undefined),
    segmenter: typeof raw.segmenter === 'string' ? raw.segmenter : 'null',
    seed: typeof raw.seed === 'number' ? raw.seed : 1,
  };
}

export function corpusConfig(config: Config, name: string): CorpusConfig {
  const c = config.corpora[name];
  if (!c) throw new Error(`no corpus named '${name}' in ${CONFIG_FILE} (known: ${Object.keys(config.corpora).join(', ') || 'none'})`);
  return c;
}
