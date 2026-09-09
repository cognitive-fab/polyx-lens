// The free lens: contract sets, the clause checker, and the report.
//
// The lens is the half that becomes a separate Apache-2.0 package, so these
// tests exercise it through its own modules only — nothing here imports the
// miner, the store or the evaluator.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinContracts, exerciseClauses, inventory } from '../src/index.ts';
import { loadContracts, parseContracts } from '../src/index.ts';
import { buildReport, renderReport } from '../src/index.ts';
import { loadCorpus } from '../src/index.ts';
import { tempWorkspace } from './helpers.ts';

const CONTRACTS = builtinContracts('claude-code')!;

test('a contract set states what it cannot check, and refuses to be vague about it', () => {
  const set = loadContracts(CONTRACTS);
  assert.equal(set.contracts, 'claude-code');
  assert.ok(set.scope, 'a contract set that does not say what it excludes is claiming completeness');
  const inexpressible = set.clauses.filter((c) => !c.expressible);
  assert.ok(inexpressible.length > 0);
  // The reason is the whole value of recording one: it turns "we cannot check
  // that" into a specific claim someone can argue with.
  assert.ok(inexpressible.every((c) => c.reason && c.reason.length > 10));
  assert.throws(
    () => parseContracts('contracts: x\nversion: 1\nclauses:\n  - { id: a, text: t, expressible: false }\n'),
    /must say why/,
  );
  assert.throws(
    () => parseContracts('contracts: x\nversion: 1\nclauses:\n  - { id: a, text: t, expressible: true, subject: s }\n'),
    /needs a shape/,
  );
});

test('the window is part of what a clause says, and defaults to the stricter reading', () => {
  const set = parseContracts(
    'contracts: x\nversion: 1\nclauses:\n' +
      '  - { id: a, text: t, expressible: true, shape: precedence, subject: s, guard: g }\n' +
      '  - { id: b, text: t, expressible: true, shape: precedence, subject: s, guard: g, window: interaction }\n',
  );
  assert.equal(set.clauses[0]!.window, 'episode', 'absent means per-task, which is the stricter claim');
  assert.equal(set.clauses[1]!.window, 'interaction');
  assert.throws(() => parseContracts('contracts: x\nversion: 1\nclauses:\n  - { id: a, text: t, expressible: true, shape: precedence, subject: s, guard: g, window: forever }\n'), /window must be/);
});

test('checking a clause counts what happened, and a clause never exercised is not a pass', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const set = parseContracts(
      'contracts: t\nversion: 1\nclauses:\n' +
        '  - { id: refund-after-verify, text: t, expressible: true, shape: precedence, subject: "action:issue_refund", guard: "action:verify_identity" }\n' +
        '  - { id: never-happens, text: t, expressible: true, shape: precedence, subject: "action:cancel_order", guard: "action:escalate" }\n' +
        '  - { id: at-most-one-refund, text: t, expressible: true, shape: at-most-one, subject: "action:issue_refund" }\n' +
        '  - { id: unreachable, text: t, expressible: false, reason: "needs the operator intent, which the record does not carry" }\n',
    );
    const ex = await exerciseClauses(corpus, set.clauses);
    // The synthetic corpus plants exactly one unverified refund (syn-0008).
    const refund = ex.find((e) => e.clauseId === 'refund-after-verify')!;
    assert.ok(refund.exercised > 0);
    assert.equal(refund.violated, 1);
    assert.equal(refund.violations[0]!.interactionId, 'syn-0008');
    assert.ok(refund.kept.length > 0, 'the instances that KEPT it are sampled too');
    // At most one refund per episode holds everywhere in the fixture.
    assert.equal(ex.find((e) => e.clauseId === 'at-most-one-refund')!.violated, 0);
    // An inexpressible clause is not checked at all — it is not silently a pass.
    assert.ok(!ex.some((e) => e.clauseId === 'unreachable'));

    const report = buildReport(corpus, set, ex, inventory(corpus));
    // `action:cancel_order` is a step this corpus never took, so the clause is
    // neither kept nor broken. Reporting it as kept would be the flattering lie.
    assert.ok(report.clauses.neverExercised.some((c) => c.id === 'never-happens'));
    assert.ok(!report.clauses.kept.includes('never-happens'), 'never exercised is never counted as kept');
    assert.equal(report.clauses.inexpressible, 1);
  } finally {
    ws.cleanup();
  }
});

test('the inventory counts consequential actions by how far their effect reaches', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const inv = inventory(corpus);
    const refund = inv.find((a) => a.type === 'action:issue_refund')!;
    assert.ok(refund, 'refunds are counted');
    assert.equal(refund.consequence, 'compensable');
    assert.equal(refund.label, 'issue a refund', 'the alphabet names it, not the type id');
    // Reads are actions too, and typed `none` — the inventory reports them
    // rather than hiding what the agent looked at.
    assert.equal(inv.find((a) => a.type === 'action:verify_identity')!.consequence, 'none');
  } finally {
    ws.cleanup();
  }
});

test('the report leads with what it cannot see, and says what it cannot answer', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const set = loadContracts(CONTRACTS);
    const ex = await exerciseClauses(corpus, set.clauses);
    const text = renderReport(buildReport(corpus, set, ex, inventory(corpus)), ex);
    const unknownLine = text.split('\n').findIndex((l) => l.includes('cannot name'));
    const firstFinding = text.split('\n').findIndex((l) => l.startsWith('RULES YOU WERE GIVEN'));
    assert.ok(unknownLine > 0 && unknownLine < firstFinding, 'the unknown rate comes before any finding');
    assert.match(text, /WHAT THIS REPORT CANNOT TELL YOU/);
    assert.match(text, /nobody ever wrote down/);
    // The claude-code contracts name Claude Code's own types, which the
    // synthetic alphabet does not have: every clause is unexercised, and the
    // report must not read as a clean bill of health.
    assert.doesNotMatch(text, /RULES YOU WERE GIVEN, AND BROKE \(0\)\n\n(?!.*NEVER CAME UP)/s);
  } finally {
    ws.cleanup();
  }
});
