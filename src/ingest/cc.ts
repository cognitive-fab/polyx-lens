// Claude Code transcripts (TS §4.4) — an AI agent taking consequential actions
// against real systems, recorded by the tool that took them.
//
// Source: a directory of frozen session transcripts, `corpora/cc/<project>/
// <sessionId>.jsonl`, produced by `corpora/link-cc.mjs`. One JSONL line is one
// transcript record; the ones that matter carry `message.content` blocks.
//
// Mapping:
//   assistant `tool_use`, not a shell    → one `action` (features: tool name)
//   assistant `tool_use`, Bash/PowerShell→ one `action` PER COMMAND SEGMENT (see below)
//   assistant text only                  → agent_utterance
//   user text                            → customer_utterance — the operator's prompt
//   user text, interrupt marker          → `system` event; also sets the outcome
//   `tool_result`                        → `system`, result ok | failed from is_error
//
// **Why a shell command is not one action.** 63% of the tool calls in this
// corpus are Bash, and `git status && git commit` is two decisions, one of
// which is irreversible. Typing the whole call `action:Bash` would put `ls`
// and `git push --force` in the same event type and make the alphabet — and
// therefore every figure — meaningless. So the command is split on `&&`, `||`,
// `;` and newlines (never on `|`: a pipeline is one logical read), each
// segment's head verb is extracted, and a second token is kept where the verb
// is a multiplexer (`git push`, `npm run`, `aws s3`). Nothing is dropped:
// `cd` and `export` are events too, typed `consequence: none` by the alphabet,
// because an event the adapter discards is an event no unknown-rate ever
// counts. A command containing a heredoc is parsed only up to the `<<`, since
// the body is data and may contain anything.
//
// **Free text is never persisted.** Shell command bodies, file contents, edit
// strings and prompts hold paths, host names, credentials and customer data.
// Only the verb (a feature, matched by the alphabet) and the file path (a
// slot, tokenised at ingestion so it stays joinable) survive. Everything else
// is reachable through `RawRef` and stays on this disk.
//
// **Provenance levels.** operator = the project; agent = the model. Seven
// models appear across 34 projects, each handed the same standing rules and
// none handed the others' — so unlike τ²'s backbones (TS §9.4, where every
// backbone got the same prompt and the experiment was uninformative by
// construction) `own` / `borrowed` / `neither` across models is a real
// question here: is a habit this model's, or the operator's norm?
//
// The written policy this corpus was produced under — the standing rules in
// the agent's own prompt, the project `CLAUDE.md` files, the permission rules
// in `settings.json` — is the answer key, and lives behind the wall under
// `policies/` like every other. It carries τ²'s confounder in full: the agent
// was handed its policy in the prompt, so recall over the clause subset the
// agent ever violated is the figure that means anything (TS §9.4, control 1).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Scalar } from '../record.ts';
import type { Adapter, RawEvent, RawInteraction } from './types.ts';

interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  is_error?: boolean;
}

interface Record_ {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  promptId?: string;
  timestamp?: string;
  gitBranch?: string;
  cwd?: string;
  entrypoint?: string;
  version?: string;
  sessionId?: string;
  message?: { role?: string; model?: string; content?: string | Block[] };
}

/** Shell verbs that carry their meaning in the second token: `git push`, `npm run`. */
const MULTIPLEXERS = new Set([
  'git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'gh', 'aws', 'gcloud', 'az', 'docker', 'kubectl',
  'cargo', 'go', 'python', 'python3', 'node', 'dotnet', 'terraform', 'systemctl', 'apt', 'brew',
]);

/** Prefixes that modify a command without being one. */
const PREFIXES = new Set(['sudo', 'time', 'nohup', 'exec', 'command', 'env', 'nice', 'xargs']);

/**
 * Shell syntax, not commands. `for f in *; do rm $f; done` splits into three
 * segments and only the middle one is a decision — the other two are the loop.
 * Dropping these is the same call as dropping a leading `VAR=value`, and it is
 * the only class of segment dropped: anything the parser fails on for another
 * reason (an inline `node -e` script leaking `const`, say) is emitted, matches
 * nothing, and shows up in the unknown rate where it belongs.
 */
const KEYWORDS = new Set([
  'for', 'do', 'done', 'if', 'then', 'else', 'elif', 'fi', 'while', 'until',
  'case', 'esac', 'in', 'function', 'select', 'return', 'break', 'continue',
]);

const DEFAULT_BRANCHES = new Set(['master', 'main', 'trunk']);

/**
 * A heredoc's BODY is data and may contain anything, including lines that look
 * like commands. Its terminator ends it, and what follows is command text again.
 *
 * Until 7 Sep 2026 this truncated the whole command at the first `<<`, which
 * discarded every command after the terminator: measured on the corpus, 2,748
 * of 3,598 heredoc-bearing calls had real commands thrown away — 200 `git push`
 * against 222 recorded in total, so nearly half of this corpus's irreversible
 * pushes were invisible and every `cc` figure was computed over that hole.
 * Skipping only the body is both the stated intent and one loop.
 *
 * `<<<` is a here-STRING and has no body, so the lookarounds keep it out.
 */
function withoutHeredocBodies(command: string): string {
  if (!command.includes('<<')) return command;
  const lines = command.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    kept.push(line);
    for (const m of line.matchAll(/(?<!<)<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1(?!<)/g)) {
      const tag = m[2]!;
      i++;
      // Skip the body and the terminator line itself. An unterminated heredoc
      // runs to the end of the command, which is what the shell does too.
      while (i < lines.length && lines[i]!.trim() !== tag) i++;
    }
  }
  return kept.join('\n');
}

/**
 * Split a shell command into segments on `&&`, `||`, `;` and newlines, ignoring
 * separators inside quotes. Not a shell parser and does not pretend to be, but
 * it must never INVENT a command: heredoc bodies are skipped above, and a
 * backslash escape does not close a quoted region — `\"` inside a double-quoted
 * script body used to, and the body then split into pseudo-commands.
 */
export function segments(command: string): string[] {
  const src = withoutHeredocBodies(command);
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    // POSIX single quotes do not honour escapes; everywhere else `\x` is one
    // literal character and can be neither a separator nor a quote.
    if (c === '\\' && quote !== "'" && i + 1 < src.length) {
      buf += c + src[i + 1]!;
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      buf += c;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      buf += c;
      continue;
    }
    if (c === '\n' || c === ';') {
      out.push(buf);
      buf = '';
      continue;
    }
    if ((c === '&' || c === '|') && src[i + 1] === c) {
      out.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Flags that take a separate value. `git -C ../other push` must read as `git
 * push`, and the value is skipped by NAME rather than by shape: the old test
 * ("a path is never a sub-verb") only worked when the value contained a slash,
 * so `git -C tmp push` read as `git tmp` and fell through to `action:git_other`.
 */
const VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--exec-path', '--config', '--prefix', '--cwd', '-w', '--workspace']);

interface Head {
  verb: string;
  tokens: string[];
  /** Index of the head token. */
  i: number;
}

/** The head verb of a segment, INCLUDING shell keywords — see `isShellSyntax`. */
function headOf(segment: string): Head | null {
  const tokens = segment.split(/\s+/).filter((t) => t.length > 0);
  let i = 0;
  // Leading `VAR=value` assignments are configuration, not the command — but
  // `VAR=$(cmd …)` is not configuration: the substitution RUNS cmd, and running
  // it is the decision. Skipping the token made the substituted command's head
  // vanish and its sub-verb become the verb, so `KEY=$(aws secretsmanager …)`
  // read as `verb=secretsmanager`, matched nothing, and landed in the unknown
  // table — 434 segments, `aws` x122 among them. Unwrap it instead.
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) {
    const substituted = /^[A-Za-z_][A-Za-z0-9_]*=(?:\$\(|`)(.+)$/.exec(tokens[i]!);
    if (substituted) {
      tokens[i] = substituted[1]!;
      break;
    }
    i++;
  }
  while (i < tokens.length && PREFIXES.has(tokens[i]!)) i++;
  const head = tokens[i];
  if (!head || head.startsWith('#')) return null;
  // A bare assignment line, a subshell or a redirect head is not a verb.
  const verb = basename(head.replace(/^[('"`]+/, ''));
  if (!verb || !/^[A-Za-z_][\w.+-]*$/.test(verb)) return null;
  return { verb, tokens, i };
}

/**
 * Shell syntax — `if`, `fi`, `done`, `else`. The one class of segment that is
 * not an event, and so the only thing the adapter may drop without counting it.
 */
export function isShellSyntax(segment: string): boolean {
  const h = headOf(segment);
  return h !== null && KEYWORDS.has(h.verb);
}

/** The verb a segment invokes, and its sub-verb where the verb is a multiplexer. */
export function verbOf(segment: string): { verb: string; sub?: string } | null {
  const h = headOf(segment);
  if (!h || KEYWORDS.has(h.verb)) return null;
  const { verb, tokens, i } = h;
  if (!MULTIPLEXERS.has(verb)) return { verb };
  // The sub-verb is the first token that is neither a flag nor a flag's value.
  let rest: string | undefined;
  for (let j = i + 1; j < tokens.length; j++) {
    const t = tokens[j]!;
    if (t.startsWith('-')) {
      if (VALUE_FLAGS.has(t)) j++;
      continue;
    }
    if (/[/\\]/.test(t)) continue;
    rest = t;
    break;
  }
  return rest && /^[A-Za-z_][\w:.-]*$/.test(rest) ? { verb, sub: rest } : { verb };
}

/**
 * The operator id for a transcript directory. Claude Code names these after the
 * working directory, so `C--Users-someone-code-polyx` is the polyx repository.
 * The user's own path prefix is stripped — it identifies a person, it is the
 * same for every row, and it would only travel into figures.
 */
export function projectOf(dir: string): string {
  const m = /-code-(.+)$/.exec(dir);
  if (m) return m[1]!;
  // The drive letter is Windows-only: a macOS or Linux transcript directory is
  // `-Users-alice-…` or `-home-alice-…`, and requiring `C--` left the username
  // in the operator id — the one outcome this function exists to prevent.
  return dir.replace(/^-?([A-Za-z]--)?(Users|home)-[^-]+-/, '');
}

/**
 * The harness's own marker, bracketed. An unanchored phrase match flipped a
 * whole session's outcome to `interrupted` whenever the text merely discussed
 * an interruption — and this corpus contains the sessions in which this very
 * adapter was written, so the false positive is in the data.
 */
const INTERRUPT = /\[Request interrupted/i;

/**
 * Features the alphabet may MATCH on, beyond the tool name. A slot is data
 * carried by an event; a feature is what decides which event type it is, and
 * the two are not interchangeable — `classify` reads features only.
 *
 * `Skill` is here because a written rule can name one skill ("load the
 * artifact-design skill before publishing"), and a guard that fires on any
 * skill load does not state that rule. Which skills are worth their own type
 * is the alphabet's judgement, not the adapter's: the adapter publishes the
 * name and the reviewed artefact decides.
 */
function featuresFor(name: string, input: Record<string, unknown> | undefined): Record<string, Scalar> {
  if (name === 'Skill' && typeof input?.skill === 'string' && input.skill.length > 0) return { skill: input.skill };
  return {};
}

function slotsFor(name: string, input: Record<string, unknown> | undefined): Record<string, Scalar> {
  const slots: Record<string, Scalar> = {};
  if (!input) return slots;
  const file = input.file_path ?? input.notebook_path;
  if (typeof file === 'string' && file.length > 0) {
    slots.file = file;
    slots.ext = extname(file).toLowerCase() || '(none)';
  }
  if (name === 'Agent' && typeof input.subagent_type === 'string') slots.subagent_type = input.subagent_type;
  if (name === 'Skill' && typeof input.skill === 'string') slots.skill = input.skill;
  return slots;
}

export function toRaw(text: string, file: string, project: string): RawInteraction | null {
  const events: RawEvent[] = [];
  const prompts = new Set<string>();
  const models = new Map<string, number>();
  let startedAt = 0;
  let at = 0;
  let branch: string | undefined;
  let entrypoint: string | undefined;
  let version: string | undefined;
  let sessionId: string | undefined;
  let interrupted = false;
  let lastResultFailed = false;
  let errors = 0;

  /**
   * Every event, in strictly increasing `at` order. The transcript stamps one
   * timestamp per RECORD, so several events share it and `applyAlphabet` sorts
   * by `at` — which let a later record's event sort between two segments of an
   * earlier one. The whole miner is a before/after question, so order is not a
   * presentation detail. A shared timestamp is nudged forward by a millisecond
   * rather than by a per-block counter, which could reach the next record.
   */
  let lastAt = -1;
  const emit = (e: RawEvent): void => {
    e.at = Math.max(e.at, lastAt + 1);
    lastAt = e.at;
    events.push(e);
  };

  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    if (!line) continue;
    let r: Record_;
    try {
      r = JSON.parse(line) as Record_;
    } catch {
      continue; // a truncated tail line; the rest of the session still counts
    }
    if (r.timestamp) {
      const t = Date.parse(r.timestamp);
      if (Number.isFinite(t)) {
        at = t;
        if (!startedAt) startedAt = t;
      }
    }
    sessionId ??= r.sessionId;
    version ??= r.version;
    entrypoint ??= r.entrypoint;
    if (branch === undefined && typeof r.gitBranch === 'string') branch = r.gitBranch;
    if (r.promptId) prompts.add(r.promptId);
    if (r.message?.model) models.set(r.message.model, (models.get(r.message.model) ?? 0) + 1);

    const path = `/${li}`;
    const content = r.message?.content;

    if (typeof content === 'string') {
      if (r.isMeta) continue;
      if (INTERRUPT.test(content)) {
        interrupted = true;
        emit({ at, features: { speaker: 'system', event: 'interrupt' }, slots: {}, raw: { file, path } });
      } else if (r.type === 'user') {
        emit({ at, features: { speaker: 'customer' }, slots: {}, raw: { file, path } });
      }
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const [bi, b] of content.entries()) {
      const raw = { file, path: `${path}/content/${bi}` };
      if (b.type === 'tool_result') {
        const failed = b.is_error === true;
        if (failed) errors++;
        lastResultFailed = failed;
        emit({
          at,
          features: { speaker: 'system', event: 'tool_result' },
          slots: {},
          result: failed ? 'failed' : 'ok',
          raw,
        });
        continue;
      }
      if (b.type === 'text' && r.message?.role === 'assistant') {
        if (INTERRUPT.test(b.text ?? '')) interrupted = true;
        emit({ at, features: { speaker: 'agent' }, slots: {}, raw });
        continue;
      }
      if (b.type !== 'tool_use' || !b.name) continue;

      const command = b.input?.command;
      if ((b.name === 'Bash' || b.name === 'PowerShell') && typeof command === 'string') {
        const segs = segments(command);
        let emitted = 0;
        for (const seg of segs) {
          const v = verbOf(seg);
          // Shell syntax is not an event. Anything else the parser cannot type
          // IS one, and is emitted without a verb so the alphabet counts it
          // unknown — 14% of segments used to vanish here instead, which meant
          // the unknown rate was measured over what the parser happened to
          // understand and the header's "nothing is dropped" was not true.
          if (!v && isShellSyntax(seg)) continue;
          const features: Record<string, Scalar> = v
            ? { speaker: 'action', tool: b.name, verb: v.verb, ...(v.sub ? { sub: v.sub } : {}) }
            : { speaker: 'action', tool: b.name };
          emit({ at, features, slots: {}, raw: { file, path: `${raw.path}/segment/${emitted}` } });
          emitted++;
        }
        // A command that parses to nothing is still a decision the agent made.
        // It is emitted with no verb so the alphabet counts it as unknown
        // rather than the adapter silently swallowing it.
        if (emitted === 0) {
          emit({ at, features: { speaker: 'action', tool: b.name }, slots: {}, raw });
        }
        continue;
      }
      emit({
        at,
        features: { speaker: 'action', tool: b.name, ...featuresFor(b.name, b.input) },
        slots: slotsFor(b.name, b.input),
        raw,
      });
    }
  }

  if (!events.some((e) => e.features.speaker === 'action')) return null;
  if (!startedAt) startedAt = 0;

  const model = [...models.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  const session = (sessionId ?? basename(file, '.jsonl')).slice(0, 8);
  const label = interrupted ? 'interrupted' : lastResultFailed ? 'failed' : 'resolved';

  const facts: Record<string, Scalar> = { 'project.name': project };
  if (branch !== undefined) {
    facts['git.branch'] = branch;
    facts['git.on_default'] = DEFAULT_BRANCHES.has(branch);
  }
  if (entrypoint) facts['session.entrypoint'] = entrypoint;

  return {
    id: `cc-${project}-${session}`,
    corpus: 'cc',
    actor: { operatorId: project, ...(model ? { agentId: model } : {}) },
    startedAt,
    events,
    facts,
    outcome: { label, at: at || startedAt, lagMs: 0, source: 'in_band' },
    hints: {
      // Every user prompt starts a task. This is real segmentation ground
      // truth on a corpus with several tasks per contact, which FS §10.4 says
      // does not ship with any corpus polyx had.
      expected_episodes: prompts.size || 1,
      models: models.size,
      ...(model ? { model } : {}),
      ...(version ? { cliVersion: version } : {}),
      errors,
      interrupted,
    },
  };
}

/** Every `<project>/<session>.jsonl` under the corpus root, in a stable order. */
function files(source: string): Array<{ file: string; project: string }> {
  if (!statSync(source).isDirectory()) return [{ file: source, project: projectOf(basename(source, '.jsonl')) }];
  const out: Array<{ file: string; project: string }> = [];
  for (const dir of readdirSync(source).sort()) {
    const full = join(source, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const f of readdirSync(full).sort()) {
      if (f.endsWith('.jsonl')) out.push({ file: join(full, f), project: projectOf(dir) });
    }
  }
  return out;
}

export const ccAdapter: Adapter = {
  name: 'cc',
  async read(source: string): Promise<RawInteraction[]> {
    const out: RawInteraction[] = [];
    // Two sessions in one project can share a truncated id prefix; keep both.
    // The suffix counts occurrences OF THAT ID, not sessions read so far: the
    // store keys adjudications and evidence pointers by interaction id, and a
    // suffix that moved when an unrelated transcript was added or removed
    // silently repointed them at the next corpus revision.
    const seen = new Map<string, number>();
    for (const { file, project } of files(source)) {
      const r = toRaw(readFileSync(file, 'utf8'), file, project);
      if (!r) continue;
      const n = seen.get(r.id) ?? 0;
      seen.set(r.id, n + 1);
      if (n) r.id = `${r.id}-${n}`;
      out.push(r);
    }
    return out;
  },
  meta(source) {
    const meta: Record<string, string> = { transcripts: String(files(source).length) };
    try {
      const s = JSON.parse(readFileSync(join(source, 'SOURCE.json'), 'utf8')) as {
        takenAt?: string;
        projects?: number;
      };
      if (s.takenAt) meta.takenAt = s.takenAt;
      if (s.projects !== undefined) meta.projects = String(s.projects);
    } catch {
      // A single-file source has no register; the manifest still hashes it.
    }
    return meta;
  },
};
