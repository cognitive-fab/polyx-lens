#!/usr/bin/env node
// Generates the sample corpus: Claude Code transcripts, shaped like the real
// thing and containing none of it. Deterministic — same code, same bytes. Run
// `node fixtures/sample/generate.mjs` and commit the output.
//
// **Why generated and not obfuscated.** A real transcript can have its names
// hashed and its paths tokenised, and what survives is still the shape of
// somebody's work: which projects, how long the sessions ran, what was done in
// what order. That shape is the whole reason a corpus is worth mining, so
// redacting it is not possible without destroying the thing being tested. This
// package is public; a corpus in it must contain nothing to leak.
//
// It is also better test data. Every figure the lens reports on this corpus is
// PLANTED here, so the tests assert a known answer rather than locking in
// whatever the code happened to produce:
//
//   cc-read-before-edit        18 of 24 kept   — 6 edits with no prior Read
//   cc-read-before-write        13 of 13 kept   — every overwrite is read first
//   cc-status-before-commit      3 of  4 kept   — one commit with no status
//   cc-status-before-push        2 of  3 kept   — one force-push with no status
//   cc-status-before-rm          0 of  2 kept   — neither delete checked first
//   cc-read-before-delete        1 of  2 kept   — one looked, one did not
//   cc-toolsearch-before-drive   2 of  2 kept   — the tools are always loaded
//   cc-skill-before-browser      0 of  2 kept   — the skill never is
//
// 4 sessions, 189 events, 91 actions, and an unknown rate of exactly 0: every
// verb the generator emits is one the alphabet names, so a change that breaks
// the parser shows up as an unknown rather than as a quietly smaller number.
//
// The last pair is the interesting one and it is planted deliberately: two
// written rules govern the same action, and the corpus keeps one and breaks the
// other. That is not a hypothetical — it is what the real corpus showed, and a
// fixture that could not express it would not be testing the thing that matters.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const T0 = Date.UTC(2026, 4, 4, 9, 0, 0);

let clock = T0;
const at = () => new Date((clock += 1000)).toISOString();

const line = (o) => JSON.stringify(o);

/** One session file. `blocks` is a list of turns; a string starts a new task. */
function session(project, id, model, turns) {
  const rows = [];
  let promptId = 0;
  for (const t of turns) {
    if (typeof t === 'string') {
      promptId++;
      rows.push(
        line({ type: 'user', sessionId: id, promptId: `p${promptId}`, gitBranch: 'main', version: '2.1.0', timestamp: at(), message: { role: 'user', content: t } }),
      );
      continue;
    }
    rows.push(
      line({
        type: 'assistant',
        sessionId: id,
        promptId: `p${promptId}`,
        version: '2.1.0',
        timestamp: at(),
        message: { role: 'assistant', model, content: [{ type: 'tool_use', name: t.name, input: t.input ?? {} }] },
      }),
    );
    rows.push(
      line({
        type: 'user',
        sessionId: id,
        promptId: `p${promptId}`,
        timestamp: at(),
        message: { role: 'user', content: [{ type: 'tool_result', is_error: t.failed === true }] },
      }),
    );
  }
  return { project, id, text: rows.join('\n') + '\n' };
}

// --- the building blocks, named after what they plant --------------------
const read = (f) => ({ name: 'Read', input: { file_path: f } });
const edit = (f) => ({ name: 'Edit', input: { file_path: f } });
const write = (f) => ({ name: 'Write', input: { file_path: f } });
const bash = (command, failed = false) => ({ name: 'Bash', input: { command }, failed });
const skill = (s) => ({ name: 'Skill', input: { skill: s } });
const toolSearch = (q) => ({ name: 'ToolSearch', input: { query: q } });
const browser = (tool) => ({ name: `mcp__claude-in-chrome__${tool}`, input: {} });

const files = ['src/parser.ts', 'src/report.ts', 'src/index.ts', 'test/parser.test.ts', 'README.md', 'config.json'];
const f = (i) => files[i % files.length];

const sessions = [];

// --- widget-shop: the well-behaved project -------------------------------
// 12 edits, all preceded by a Read. 4 commits, 3 with a status first.
{
  const turns = ['fix the parser'];
  for (let i = 0; i < 6; i++) turns.push(read(f(i)), edit(f(i)));
  turns.push(bash('npm test'), bash('git status --short'), bash('git add -A'), bash('git commit -m "fix the parser"'));
  turns.push('now the report');
  for (let i = 6; i < 12; i++) turns.push(read(f(i)), edit(f(i)));
  turns.push(bash('git status'), bash('git commit -m "report"'), bash('git status'), bash('git push origin main'));
  sessions.push(session('widget-shop', 'aaaa1111', 'claude-sample-1', turns));
}

// --- ledger-api: the hurried one -----------------------------------------
// 12 edits, 6 with no Read at all. 4 blind Writes. A commit and a push with
// no status. Two deletes, one looked at first.
{
  const turns = ['ship the hotfix'];
  for (let i = 0; i < 6; i++) turns.push(edit(f(i)));
  for (let i = 0; i < 6; i++) turns.push(read(f(i)), edit(f(i)));
  turns.push(write('dist/bundle.js'), write('dist/bundle.js.map'), write('dist/meta.json'), write('dist/stats.json'));
  turns.push('clean up and ship');
  turns.push(bash('rm -rf dist/old'), read('scripts/clean.sh'), bash('rm scripts/clean.sh'));
  turns.push(bash('git commit -am "hotfix"'), bash('git push --force origin main'));
  sessions.push(session('ledger-api', 'bbbb2222', 'claude-sample-1', turns));
}

// --- kiosk-ui: reads, writes and the browser -----------------------------
// 8 Writes, 8 with a prior Read. Three browser drives, each preceded by a
// ToolSearch and none by the skill.
{
  const turns = ['check the checkout page'];
  for (let i = 0; i < 8; i++) turns.push(read(f(i)), write(f(i)));
  turns.push(toolSearch('select:mcp__claude-in-chrome__navigate'), browser('navigate'));
  turns.push(browser('computer'), browser('read_page'));
  turns.push('write it up');
  turns.push(skill('artifact-design'), write('report.html'), read('report.html'), { name: 'Artifact', input: { file_path: 'report.html' } });
  turns.push(bash('git status'), bash('git commit -m "checkout report"'), bash('git status'), bash('git push'));
  sessions.push(session('kiosk-ui', 'cccc3333', 'claude-sample-2', turns));
}

// --- freight-worker: a short session that fails ---------------------------
{
  const turns = ['run the migration'];
  turns.push(read('migrations/003.sql'), bash('node scripts/migrate.mjs', true), bash('git status'), bash('git checkout -- .'));
  sessions.push(session('freight-worker', 'dddd4444', 'claude-sample-2', turns));
}

for (const s of sessions) {
  const dir = join(here, `C--Users-sample-code-${s.project}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${s.id}.jsonl`), s.text);
}

writeFileSync(
  join(here, 'SOURCE.json'),
  JSON.stringify({ generatedBy: 'fixtures/sample/generate.mjs', takenAt: new Date(T0).toISOString(), projects: sessions.length, note: 'Generated. Contains no real transcript.' }, null, 2) + '\n',
);

console.log(`wrote ${sessions.length} sessions across ${new Set(sessions.map((s) => s.project)).size} projects`);
