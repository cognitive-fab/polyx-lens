// Corpus → canonical interactions: adapter, alphabet, segmentation, validation.
// Everything downstream (audit, mine, evaluate) consumes a LoadedCorpus and
// nothing else, so every figure any of them prints is traceable to one
// alphabet version and one segmenter.
import { adapterFor } from './ingest/index.ts';
import { applyAlphabet, classify, loadAlphabet, type Alphabet } from './alphabet/index.ts';
import { corpusConfig, type Config, type CorpusConfig } from './config.ts';
import { corpusRevision } from './manifest.ts';
import { episodeId, nullSegmenter, type Segmenter } from './ports/segmentation.ts';
import { validateInteraction, type Interaction, type Scalar } from './record.ts';
import { cmp } from './order.ts';

export interface LoadedCorpus {
  name: string;
  domain: string;
  config: CorpusConfig;
  alphabet: Alphabet;
  /** The alphabet file that actually typed this load — the override, when one was given. */
  alphabetFile: string;
  revision: string;
  segmenter: string;
  interactions: Interaction[];
  /** Feature shapes the alphabet did not match, with counts — what it is missing. */
  unknownShapes: Map<string, number>;
  /** Source-level labels per interaction (ABCD's subflow, split). Read by the audit for quality figures; never mined. */
  hints: Map<string, Record<string, Scalar>>;
  /** What produced a generated corpus (backbone, simulator, benchmark commit). Empty for recorded corpora. */
  meta: Record<string, string>;
}

const SEGMENTERS: Record<string, () => Promise<Segmenter>> = {
  null: async () => nullSegmenter,
  polyness: async () => (await import('./ports/polyness/segmenter.ts')).polynessSegmenter,
};

export function registerSegmenter(name: string, load: () => Promise<Segmenter>): void {
  SEGMENTERS[name] = load;
}

export async function segmenterFor(name: string): Promise<Segmenter> {
  const load = SEGMENTERS[name];
  if (!load) throw new Error(`no segmenter named '${name}' (known: ${Object.keys(SEGMENTERS).join(', ')})`);
  return load();
}

export interface LoadOptions {
  /** Override the configured alphabet file — used by tests and by `alphabet show`. */
  alphabetFile?: string;
  segmenter?: string;
  /**
   * Cross-domain provenance (FS §6.4): treat a source hint — ABCD's `flow`,
   * τ²'s `backbone` — as the operator, so a rule mined in one is scored in
   * the others and the lattice reports where borrowed evidence lands. Team
   * and agent are cleared: the hint is the only actor level that means
   * anything under this remap.
   */
  scopeBy?: string;
}

export async function loadCorpus(config: Config, name: string, opts: LoadOptions = {}): Promise<LoadedCorpus> {
  const cc = corpusConfig(config, name);
  const alphabetFile = opts.alphabetFile ?? cc.alphabet;
  const alphabet = loadAlphabet(alphabetFile);
  // An alphabet names the corpus family it types (`tau2-retail`); several
  // configured corpora — one per backbone — share it. The name must match
  // the corpus or be a prefix of it.
  if (alphabet.corpus !== name && !name.startsWith(alphabet.corpus + '-')) {
    throw new Error(`alphabet ${alphabetFile} is for corpus '${alphabet.corpus}', not '${name}'`);
  }
  const segmenter = await segmenterFor(opts.segmenter ?? cc.segmenter ?? config.segmenter);
  const adapter = adapterFor(cc.adapter);
  const raw = await adapter.read(cc.source);
  const meta = adapter.meta ? adapter.meta(cc.source) : {};
  const unknownShapes = new Map<string, number>();
  const hints = new Map<string, Record<string, Scalar>>();
  const interactions: Interaction[] = [];
  for (const r of raw) {
    for (const e of r.events) {
      if (classify(alphabet, e.features)) continue;
      const shape = Object.entries(e.features)
        .sort(([a], [b]) => cmp(a, b))
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ');
      unknownShapes.set(shape, (unknownShapes.get(shape) ?? 0) + 1);
    }
    // The adapter asserts which corpus family a record belongs to; the config names the corpus. They must agree.
    if (r.corpus !== name && !name.startsWith(r.corpus + '-')) {
      throw new Error(`adapter '${cc.adapter}' produced a record for corpus '${r.corpus}' while loading '${name}'`);
    }
    const typed = applyAlphabet(alphabet, r);
    if (opts.scopeBy) {
      const v = r.hints?.[opts.scopeBy];
      if (v === undefined || v === null) throw new Error(`--scope-by ${opts.scopeBy}: ${r.id} carries no such hint`);
      typed.actor = { operatorId: String(v) };
    }
    const ctx = r.hints ? { interactionId: r.id, hints: r.hints } : { interactionId: r.id };
    const local = await segmenter.segment(typed.events, ctx);
    for (const e of typed.events) {
      const l = local.get(e.seq);
      if (l === undefined) throw new Error(`segmenter '${segmenter.name}' left ${r.id} seq ${e.seq} unassigned`);
      e.episode = episodeId(r.id, l);
    }
    if (r.hints) hints.set(r.id, r.hints);
    interactions.push(validateInteraction(typed, `${name}/${r.id}`));
  }
  // Stable order whatever the adapter did: identity and determinism depend on it.
  interactions.sort((a, b) => a.startedAt - b.startedAt || cmp(a.id, b.id));
  return {
    name,
    domain: cc.domain ?? name,
    config: cc,
    alphabet,
    alphabetFile,
    revision: corpusRevision(cc.source),
    segmenter: segmenter.name,
    interactions,
    unknownShapes,
    hints,
    meta,
  };
}

/** Events grouped by episode, in seq order, across a corpus. */
export function episodes(interactions: Interaction[]): Map<string, { interaction: Interaction; events: Interaction['events'] }> {
  const out = new Map<string, { interaction: Interaction; events: Interaction['events'] }>();
  for (const it of interactions) {
    for (const e of it.events) {
      let ep = out.get(e.episode);
      if (!ep) out.set(e.episode, (ep = { interaction: it, events: [] }));
      ep.events.push(e);
    }
  }
  return out;
}
