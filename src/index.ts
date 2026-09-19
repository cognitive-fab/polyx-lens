// polyx-lens — read an agent's own logs, and report which of the rules it was
// given it actually kept.
//
// This package is the front half of polyx, and it is deliberately the half that
// answers a question without asking anything of the reader: a corpus and a
// contract set go in, a compliance report comes out. No mining, no store, no
// adjudication, no model call, and no network code anywhere — the claim that
// nothing leaves the machine is inspectable rather than promised.
//
// What it cannot do is the other half, and the report says so in as many words:
// finding the rules an organisation keeps that nobody ever wrote down needs a
// miner, and that is a separate, commercial thing.

// The canonical record. Everything downstream consumes this and nothing else.
export {
  EVENT_KINDS,
  UNKNOWN_TYPE,
  validateInteraction,
  RecordError,
  type Event,
  type EventKind,
  type EventResult,
  type EpisodeId,
  type Interaction,
  type Outcome,
  type RawRef,
  type Scalar,
} from './record.ts';
export { cmp } from './order.ts';
// The rule format. It lives in the free half deliberately: the commercial split
// is that the MINER is paid and the format a rule is written in is not, so
// anything can read, write or check a rule without a licence.
export {
  fraction,
  ratio,
  type Condition,
  type InstanceRef,
  type Level,
  type Rule,
  type RuleFamily,
  type RuleStatus,
  type Support,
  type Verdict,
  type Window,
} from './rule.ts';

// Configuration, corpora and the alphabet.
export { CONFIG_FILE, corpusConfig, loadConfig, type Config, type CorpusConfig } from './config.ts';
export { THRESHOLDS, withThresholds, type Thresholds } from './thresholds.ts';
export {
  applyAlphabet,
  classify,
  consequentialTypes,
  loadAlphabet,
  parseAlphabet,
  recommendableTypes,
  resolveTypeId,
  AlphabetError,
  type Alphabet,
  type EventType,
} from './alphabet/index.ts';
export { adapterFor, type Adapter, type RawEvent, type RawInteraction } from './ingest/index.ts';
// The adapters individually, because a reader checking one format's parse
// against a hand-checked example should not have to go through the registry.
export { abcdAdapter } from './ingest/abcd.ts';
export { bpicAdapter } from './ingest/bpic.ts';
export { ccAdapter, isShellSyntax, projectOf, segments, toRaw, verbOf } from './ingest/cc.ts';
export { syntheticAdapter } from './ingest/synthetic.ts';
export { tau2Adapter, tau2Meta } from './ingest/tau2.ts';
export {
  loadCorpus,
  registerSegmenter,
  segmenterFor,
  type LoadOptions,
  type LoadedCorpus,
} from './pipeline.ts';
export { corpusRevision, codeCommit, newRunId, type Manifest } from './manifest.ts';
export { audit, figureEvents, renderAudit } from './audit.ts';

// The ports. Each has two implementations by construction — a port with one is
// a wish — and the polyness side is vendored so a checkout installs standalone.
export { episodeId, nullSegmenter, type SegmentContext, type Segmenter } from './ports/segmentation.ts';
export {
  naiveExtractor,
  sortInstances,
  sortSubjects,
  type Instance,
  type Subject,
  type SubjectExtractor,
} from './ports/subjects.ts';
export { simpleClassifier, type Elsewhere, type ProvenanceClassifier } from './ports/provenance.ts';
// The observation port. Its second implementation is the Jev adapter, which
// lives in polyx because it holds a paid third-party dependency and a network
// call — keeping it out of this package means the Apache-2.0 half makes no
// network call at all, under any configuration, which `check:offline` proves
// rather than promises.
export {
  checkSeparation,
  emit,
  isAssertOnly,
  isInert,
  nullObserver,
  observedFacts,
  separation,
  validateBands,
  PredicateError,
  JITTER,
  MIN_BAND_WIDTH,
  MIN_LABEL_SEPARATION,
  PROHIBITED_QUADRANT,
  QUANTUM,
  type Bands,
  type Calibration,
  type Observation,
  type Observer,
  type Predicate,
  type PredicateStatus,
  type PredicateWindow,
  type Quadrant,
} from './ports/observation.ts';
// Text resolution. The canonical record deliberately carries no text; this is
// how a predicate reads one, per adapter, without weakening that.
export {
  abcdTextSource,
  annotatableAdapters,
  ccTextSource,
  joinEpisodeText,
  nullTextSource,
  registerTextSource,
  slotText,
  syntheticTextSource,
  textSourceFor,
  type TextSource,
} from './ports/text.ts';
export { polynessSegmenter } from './ports/polyness/segmenter.ts';
export { polynessExtractor } from './ports/polyness/subjects.ts';
export { polynessClassifier } from './ports/polyness/provenance.ts';

// Three-valued conditions. An absent fact is unknown, never false — the closed
// world assumption is prohibited, here and in anything built on this.
export { evalAll, evalCondition, renderCondition, type FactBase, type Truth } from './conditions.ts';

// The lens itself.
export { loadContracts, parseContracts, type Contract, type ContractSet } from './lens/contracts.ts';
export { alphabetsDir, builtinAlphabet, builtinContracts, contractsDir, fixturesDir, packageRoot } from './lens/builtin.ts';
export { claudeProjectsDir, localCorpus, type LocalCorpus } from './lens/local.ts';
export { exerciseClauses, inventory, type ActionCount, type ClauseExercise } from './lens/check.ts';
export { buildReport, renderReport, type LensReport } from './lens/report.ts';
export { instanceFacts } from './lens/facts.ts';
export { ref, sample } from './lens/refs.ts';
