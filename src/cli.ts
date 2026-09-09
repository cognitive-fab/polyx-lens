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
import { exerciseClauses, inventory } from './lens/check.ts';
import { loadContracts } from './lens/contracts.ts';
import { buildReport, renderReport } from './lens/report.ts';
import { loadCorpus } from './pipeline.ts';

const USAGE = `polyx-lens — what your agents did, and which of the rules they were given they kept

  polyx-lens <corpus> [--contracts <file>] [--json]
      the report
  polyx-lens audit <corpus>
      what the alphabet could and could not name, before any finding

Corpora are configured in polyx.config.json. A contract set for the corpus's
system ships with this package; --contracts points at your own.

Nothing leaves this machine: there is no network code in this package.
`;

export async function run(argv: string[], out: (s: string) => void = console.log, err: (s: string) => void = console.error): Promise<number> {
  const args = argv.filter((a) => a !== '--');
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    out(USAGE);
    return args.length ? 0 : 1;
  }
  const json = args.includes('--json');
  const ci = args.indexOf('--contracts');
  const explicit = ci >= 0 ? args[ci + 1] : undefined;
  // `ci + 1` is the value of --contracts, and must not be read as a corpus
  // name. When the flag is absent ci is -1, and ci + 1 is the FIRST argument —
  // which is the corpus, so the guard has to check the flag was given at all.
  const positional = args.filter((a, i) => !a.startsWith('-') && !(ci >= 0 && i === ci + 1));

  const config = loadConfig();
  const sub = positional[0] === 'audit' ? 'audit' : 'report';
  const corpusName = sub === 'audit' ? positional[1] : positional[0];
  if (!corpusName) {
    err('which corpus? (configured: ' + (Object.keys(config.corpora).join(', ') || 'none') + ')');
    return 1;
  }
  corpusConfig(config, corpusName);
  const corpus = await loadCorpus(config, corpusName);

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
