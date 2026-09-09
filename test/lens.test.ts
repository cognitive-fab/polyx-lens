// The lens against the sample corpus, whose answers are planted in
// fixtures/sample/generate.mjs.
//
// The sample is GENERATED, not obfuscated. A real transcript with its names
// hashed still carries the shape of somebody's work — which projects, how long,
// what in what order — and that shape is the whole reason a corpus is worth
// mining. This package is public, so its corpus contains nothing to leak, and
// every figure asserted below was planted rather than discovered.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinContracts } from '../src/lens/builtin.ts';
import { exerciseClauses, inventory } from '../src/lens/check.ts';
import { loadContracts } from '../src/lens/contracts.ts';
import { buildReport, renderReport } from '../src/lens/report.ts';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/pipeline.ts';

const sample = async () => loadCorpus(loadConfig(), 'cc-sample');
const kept = (ex: Awaited<ReturnType<typeof exerciseClauses>>, id: string) => {
  const e = ex.find((x) => x.clauseId === id);
  assert.ok(e, `${id} was not checked`);
  return `${e.exercised - e.violated}/${e.exercised}`;
};

test('the sample corpus is read whole: nothing unknown, nothing dropped', async () => {
  const corpus = await sample();
  assert.equal(corpus.interactions.length, 4);
  assert.equal([...corpus.unknownShapes.values()].reduce((n, c) => n + c, 0), 0, 'every verb the generator emits is one the alphabet names');
  assert.equal(corpus.interactions.reduce((n, i) => n + i.events.length, 0), 189);
});

test('every clause outcome is the one the generator planted', async () => {
  const corpus = await sample();
  const contracts = loadContracts(builtinContracts('claude-code')!);
  const ex = await exerciseClauses(corpus, contracts.clauses);

  assert.equal(kept(ex, 'cc-read-before-edit'), '18/24', 'six edits with no prior Read');
  assert.equal(kept(ex, 'cc-read-before-write'), '13/13', 'every overwrite is read first');
  assert.equal(kept(ex, 'cc-status-before-commit'), '3/4');
  assert.equal(kept(ex, 'cc-status-before-push'), '2/3', 'one force-push with no status');
  assert.equal(kept(ex, 'cc-status-before-rm'), '0/2');
  assert.equal(kept(ex, 'cc-read-before-delete'), '1/2');

  // The pair that matters: two written rules govern the same action, the corpus
  // keeps one and breaks the other. A fixture that could not express this would
  // not be testing the thing the lens exists to find.
  assert.equal(kept(ex, 'cc-toolsearch-before-browser-drive'), '2/2');
  assert.equal(kept(ex, 'cc-skill-before-browser-drive'), '0/2');
});

test('the window is what the clause says: a session-scoped rule is not judged per task', async () => {
  const corpus = await sample();
  const contracts = loadContracts(builtinContracts('claude-code')!);
  const asWritten = await exerciseClauses(corpus, contracts.clauses);
  // The same clauses forced to the episode window — what the checker did before
  // the window was part of the model. kiosk-ui writes across two tasks, so the
  // stricter reading turns kept instances into violations.
  const perEpisode = await exerciseClauses(
    corpus,
    contracts.clauses.map((c) => ({ ...c, window: 'episode' as const })),
  );
  const id = 'cc-read-before-write';
  const after = asWritten.find((e) => e.clauseId === id)!;
  const before = perEpisode.find((e) => e.clauseId === id)!;
  // kiosk-ui writes its report in a second task, having read files in the
  // first. The Write contract scopes itself to a file "you have already Read",
  // with no task boundary — so as written it is kept, and only the stricter
  // reading turns it into a violation.
  assert.equal(after.violated, 0, 'read earlier in the session, so the rule is kept');
  assert.equal(before.violated, 1, 'judged per task, the same history reads as a violation');
});

test('the report names what it cannot see and what it cannot answer', async () => {
  const corpus = await sample();
  const contracts = loadContracts(builtinContracts('claude-code')!);
  const ex = await exerciseClauses(corpus, contracts.clauses);
  const inv = inventory(corpus);
  assert.equal(inv.find((a) => a.type === 'action:git_push')!.count, 3);
  assert.equal(inv.find((a) => a.type === 'action:git_push')!.consequence, 'irreversible');
  assert.equal(inv.find((a) => a.type === 'action:run_script')!.failed, 1, 'a failed tool result is carried onto the action');

  const text = renderReport(buildReport(corpus, contracts, ex, inv), ex);
  const lines = text.split('\n');
  assert.ok(lines.findIndex((l) => l.includes('cannot name')) < lines.findIndex((l) => l.startsWith('RULES YOU WERE GIVEN')));
  assert.match(text, /WHAT THIS REPORT CANNOT TELL YOU/);
  assert.match(text, /15 of 28/, 'the inexpressible half is reported, not hidden');
});
