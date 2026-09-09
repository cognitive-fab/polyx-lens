// Where an agent's own logs already are.
//
// The lens exists to say something true on a first run, and a first run that
// begins "now write a config file" says nothing. Claude Code has been writing
// transcripts to a known directory for months before anyone installs this, so
// the default corpus is that directory, and configuring one is the exception
// rather than the entry.
//
// Nothing here reads a transcript. It resolves a path, and reports honestly
// when there is nothing at it — a tool that silently prints a clean report over
// an empty directory is worse than one that says it found nothing.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CorpusConfig } from '../config.ts';
import { alphabetsDir } from './builtin.ts';

/** The directory Claude Code writes its transcripts to. */
export function claudeProjectsDir(home = homedir()): string {
  return join(home, '.claude', 'projects');
}

export interface LocalCorpus {
  name: string;
  config: CorpusConfig;
  /** Project directories holding at least one transcript. */
  projects: number;
  sessions: number;
}

/**
 * The local Claude Code corpus, or `null` when there is nothing to read.
 *
 * **Read in place, deliberately.** polyx freezes a copy before mining, because
 * a corpus that grows under the run cannot reproduce a figure. A report is not
 * a figure: it describes the sessions that existed when it ran, and copying
 * gigabytes to say so would be a worse trade than the caveat.
 */
export function localCorpus(home = homedir()): LocalCorpus | null {
  const source = claudeProjectsDir(home);
  if (!existsSync(source) || !statSync(source).isDirectory()) return null;
  let projects = 0;
  let sessions = 0;
  for (const entry of readdirSync(source)) {
    const dir = join(source, entry);
    if (!statSync(dir).isDirectory()) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    if (!files.length) continue;
    projects++;
    sessions += files.length;
  }
  if (!sessions) return null;
  return {
    // The name has to start with the adapter's corpus family: both the
    // alphabet and the adapter assert that a record they produced belongs to
    // the corpus being loaded, which is what stops one corpus being typed by
    // another's alphabet.
    name: 'cc-local',
    projects,
    sessions,
    config: {
      adapter: 'cc',
      // The contract set is keyed by the system, and these are that system's
      // own transcripts.
      domain: 'claude-code',
      source,
      alphabet: join(alphabetsDir(), 'alphabet.cc.yaml'),
      // A Claude Code session holds many tasks; the null segmenter would make
      // one episode of a whole afternoon, and every per-task rule would then be
      // measured over the wrong span.
      segmenter: 'polyness',
    },
  };
}
