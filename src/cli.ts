// `polyx-lens <corpus>` — the whole tool.
//
// One command, because one question: which of the rules your agents were given
// do they actually keep? It reads a corpus and a contract set, and prints a
// report. There is no store to set up, no adjudication step, no model call, and
// no network code in this package at all.
import { existsSync } from 'node:fs';
import { audit, renderAudit } from './audit.ts';
import { corpusConfig, loadConfig } from './config.ts';
import { builtinContracts } from './lens/builtin.ts';
import { claudeProjectsDir, localCorpus, type LocalCorpus } from './lens/local.ts';
import { exerciseClauses, inventory } from './lens/check.ts';
import { loadContracts } from './lens/contracts.ts';
import { buildReport, renderReport } from './lens/report.ts';
import { loadCorpus } from './pipeline.ts';

const USAGE = `polyx-lens — what your agents did, and which of the rules they were given they kept

  polyx-lens
      report on your own Claude Code transcripts, read from
      ~/.claude/projects. No configuration, nothing to set up
  polyx-lens <corpus> [--contracts <file>] [--json]
      report on a corpus named in polyx.config.json
  polyx-lens audit [<corpus>]
      what the alphabet could and could not name, before any finding

A contract set for the corpus's system ships with this package; --contracts
points at your own.

Nothing leaves this machine: there is no network code in this package.
`;

export async function run(argv: string[], out: (s: string) => void = console.log, err: (s: string) => void = console.error): Promise<number> {
  const args = argv.filter((a) => a !== '--');
  if (args.includes('--help') || args.includes('-h')) {
    out(USAGE);
    return 0;
  }
  const json = args.includes('--json');
  const ci = args.indexOf('--contracts');
  const explicit = ci >= 0 ? args[ci + 1] : undefined;
  // `ci + 1` is the value of --contracts, and must not be read as a corpus
  // name. When the flag is absent ci is -1, and ci + 1 is the FIRST argument —
  // which is the corpus, so the guard has to check the flag was given at all.
  const positional = args.filter((a, i) => !a.startsWith('-') && !(ci >= 0 && i === ci + 1));

  const config = loadConfig();
  let found: LocalCorpus | null = null;
  const sub = positional[0] === 'audit' ? 'audit' : 'report';
  let corpusName = sub === 'audit' ? positional[1] : positional[0];

  // No corpus named: read the transcripts the agent has already been writing.
  // This is the entry that matters — a first run that begins "now write a
  // config file" says nothing to the person who has not decided to care yet.
  if (!corpusName) {
    const local = localCorpus();
    if (!local) {
      const configured = Object.keys(config.corpora);
      err(`no Claude Code transcripts at ${claudeProjectsDir()}.`);
      err(configured.length ? `Name a corpus instead: ${configured.join(', ')}` : 'Nothing to read, and no corpus configured in polyx.config.json.');
      return 1;
    }
    corpusName = local.name;
    config.corpora[local.name] = local.config;
    err(`reading ${local.sessions} sessions across ${local.projects} projects from ${local.config.source}`);
    found = local;
  }

  corpusConfig(config, corpusName);
  const corpus = await loadCorpus(config, corpusName);

  // A session that never called a tool has nothing to check, and the adapter
  // drops it. Saying "378 sessions" and then reporting on 134 without a word
  // would be the same failure the unknown rate exists to prevent: a denominator
  // the reader cannot see.
  if (found) {
    const skipped = found.sessions - corpus.interactions.length;
    if (skipped > 0) err(`${corpus.interactions.length} of them called a tool at least once; ${skipped} are conversation only and cannot be checked`);
    err('');
  }

  if (sub === 'audit') {
    const a = audit(corpus, config.thresholds);
    out(json ? JSON.stringify(a, null, 2) : renderAudit(a));
    return 0;
  }

  const file = explicit ?? builtinContracts(corpus.domain);
  if (!file || !existsSync(file)) {
    err(`no contract set for ${corpusName}: nothing ships for '${corpus.domain}' and no --contracts given.`);
    return 1;
  }
  const contracts = loadContracts(file);
  const exercise = await exerciseClauses(corpus, contracts.clauses);
  const report = buildReport(corpus, contracts, exercise, inventory(corpus));
  out(json ? JSON.stringify({ ...report, exercise }, null, 2) : renderReport(report, exercise));
  return 0;
}
