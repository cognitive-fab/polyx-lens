// F1.1: three hand-checked Claude Code sessions, field by field
// (fixture: test/fixtures/cc). The fixture is hand-authored rather than a
// clipping of a real transcript — the real corpus is one person's machine and
// does not belong in a repository — so every value below is a value someone
// wrote on purpose and can be checked by reading the JSONL beside it.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyAlphabet, loadAlphabet } from '../src/index.ts';
import { ccAdapter, isShellSyntax, projectOf, segments, verbOf } from '../src/index.ts';
import { FIXTURES, ROOT } from './helpers.ts';

const SOURCE = join(FIXTURES, 'cc');
const ALPHABET = join(ROOT, 'alphabets', 'alphabet.cc.yaml');

test('cc adapter: sess-aaaa — a shell command is one action per segment, not one action', async () => {
  const all = await ccAdapter.read(SOURCE);
  assert.equal(all.length, 3);
  const it = all[0]!;
  assert.equal(it.id, 'cc-demo-sess-aaa');
  assert.equal(it.corpus, 'cc');
  // operator = the project, agent = the model. Both provenance levels are real
  // on this corpus, unlike ABCD where it collapses to the operator (TS §4.1).
  assert.deepEqual(it.actor, { operatorId: 'demo', agentId: 'claude-test-1' });
  assert.equal(it.startedAt, Date.parse('2026-09-01T10:00:00.000Z'));

  const shape = it.events.map((e) =>
    [e.features.speaker, e.features.tool ?? '', e.features.event ?? '', e.features.verb ?? '', e.features.sub ?? '']
      .filter((v) => v !== '' && v !== undefined)
      .join(' '),
  );
  assert.deepEqual(shape, [
    'customer',
    'action Read',
    'system tool_result',
    'action Edit',
    'system tool_result',
    // `git status && git add -A && git commit -m 'tidy'` is three decisions.
    'action Bash git status',
    'action Bash git add',
    'action Bash git commit',
    'system tool_result',
    'agent',
  ]);

  const read = it.events[1]!;
  assert.deepEqual(read.slots, { file: '/repo/src/a.ts', ext: '.ts' });
  assert.deepEqual(read.raw, { file: join(SOURCE, 'C--Users-someone-code-demo', 'sess-aaaa.jsonl'), path: '/2/content/0' });
  // Segments of one call share the call's raw pointer plus their index, so
  // `--show` lands on the command that produced the event.
  assert.equal(it.events[6]!.raw.path, '/6/content/0/segment/1');
  assert.equal(it.events[6]!.at, it.events[5]!.at + 1, 'segments are ordered within the call');
  assert.equal(it.events[2]!.result, 'ok');

  // The branch is a fact because the standing rules are conditioned on it.
  assert.deepEqual(it.facts, {
    'project.name': 'demo',
    'git.branch': 'master',
    'git.on_default': true,
    'session.entrypoint': 'cli',
  });
  assert.equal(it.outcome!.label, 'resolved');
  assert.deepEqual(it.hints, { expected_episodes: 1, models: 1, model: 'claude-test-1', cliVersion: '2.1.0', errors: 0, interrupted: false });
});

test('cc adapter: sess-bbbb — a heredoc body is data, and a failed result is the outcome', async () => {
  const [, it] = await ccAdapter.read(SOURCE);
  // The heredoc contains `rm -rf /tmp/everything`. It is text being written to
  // a file, not a command being run, and an adapter that mined it would invent
  // an irreversible action that never happened.
  const verbs = it!.events.filter((e) => e.features.speaker === 'action').map((e) => e.features.verb);
  assert.deepEqual(verbs, ['cat']);
  assert.equal(it!.events.at(-1)!.result, 'failed');
  assert.equal(it!.outcome!.label, 'failed');
  assert.equal(it!.hints!.errors, 1);
  assert.equal(it!.facts!['git.on_default'], false, 'a feature branch is not the default branch');
});

test('cc adapter: sess-cccc — an interrupt is an event and an outcome, and prompts are episodes', async () => {
  const [, , it] = await ccAdapter.read(SOURCE);
  assert.equal(it!.actor.operatorId, 'other', 'a second project is a second operator');
  assert.equal(it!.actor.agentId, 'claude-test-2');
  assert.equal(it!.events.at(-1)!.features.event, 'interrupt');
  assert.equal(it!.outcome!.label, 'interrupted');
  // Two prompts in one session. This is the segmentation ground truth the
  // corpus ships and FS §10.4 says no other corpus polyx has could provide.
  assert.equal(it!.hints!.expected_episodes, 2);
});

test('cc adapter: the shell splitter respects quotes and skips a heredoc BODY', () => {
  assert.deepEqual(segments('a && b || c ; d'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(segments('grep "a;b" f | head'), ['grep "a;b" f | head'], 'a pipeline is one read');
  assert.deepEqual(segments("echo 'x && y'"), ["echo 'x && y'"]);
  assert.deepEqual(segments('a\nb'), ['a', 'b']);
  // The body is data and never a command.
  assert.deepEqual(segments('cat <<EOF\nrm -rf /\nEOF'), ['cat <<EOF']);
  // ...and the terminator ENDS it. Truncating the whole command at `<<` put
  // 200 of this corpus's 222 recorded pushes in the dark, and every cc figure
  // was computed over that hole (TS 15, rev. 15).
  assert.deepEqual(
    segments("git commit -m 'x' <<'EOF'\nbody with rm -rf /\nEOF\ngit push"),
    ["git commit -m 'x' <<'EOF'", 'git push'],
    'commands after the terminator survive',
  );
  assert.deepEqual(segments('cat <<-TAG\nstuff\nTAG\nnpm test'), ['cat <<-TAG', 'npm test'], '<<- is a heredoc too');
  assert.deepEqual(segments('echo <<<HERE && ls'), ['echo <<<HERE', 'ls'], 'a here-string has no body');
  // An escaped quote does not close a quoted region: a script body that split
  // on its own newlines would invent commands that never ran.
  assert.deepEqual(segments('node -e "a \\" b\nrm -rf /"'), ['node -e "a \\" b\nrm -rf /"']);
});

test('cc adapter: the verb is the command, not its configuration', () => {
  assert.deepEqual(verbOf('AWS_PROFILE=x aws s3 ls s3://b'), { verb: 'aws', sub: 's3' });
  assert.deepEqual(verbOf('sudo rm -rf build'), { verb: 'rm' });
  assert.deepEqual(verbOf('git -C ../other push --force'), { verb: 'git', sub: 'push' });
  assert.deepEqual(verbOf('/usr/bin/node script.mjs'), { verb: 'node', sub: 'script.mjs' });
  assert.equal(verbOf('# a comment'), null);
  assert.equal(verbOf('done'), null, 'shell syntax is not a command');
  assert.equal(verbOf('FOO=1'), null);
  // Not silently dropped: a segment the parser mis-reads keeps its verb, fails
  // to match the alphabet and lands in the unknown rate where it can be seen.
  assert.deepEqual(verbOf('const x = 1'), { verb: 'const' });
  // `VAR=$(cmd ...)` RUNS cmd; skipping the token made the head vanish and the
  // sub-verb become the verb (`verb=secretsmanager`, which matches nothing).
  assert.deepEqual(verbOf('KEY=$(aws secretsmanager get-secret-value --id x)'), { verb: 'aws', sub: 'secretsmanager' });
  assert.deepEqual(verbOf('USER_ID=$(gh api user)'), { verb: 'gh', sub: 'api' });
  // A flag's value is skipped by name, not by looking for a slash in it.
  assert.deepEqual(verbOf('git -C tmp push'), { verb: 'git', sub: 'push' });
});

test('cc adapter: shell syntax is the only class of segment that is not an event', () => {
  assert.ok(isShellSyntax('done'));
  assert.ok(isShellSyntax('fi'));
  assert.ok(!isShellSyntax('}'), 'a stray brace is not a keyword - it is counted unknown, not dropped');
  assert.ok(!isShellSyntax('git push'));
});

test('cc adapter: the operator id is the project, with the user prefix stripped', () => {
  assert.equal(projectOf('C--Users-someone-code-demo'), 'demo');
  assert.equal(projectOf('C--Users-someone-code-a-b'), 'a-b');
  assert.equal(projectOf('C--Users-someone-Documents-thing'), 'Documents-thing');
  assert.equal(projectOf('plain'), 'plain');
  // A macOS or Linux transcript directory carries no drive letter, and the
  // username must not survive into the operator id.
  assert.equal(projectOf('-Users-alice-Documents-thing'), 'Documents-thing');
  assert.equal(projectOf('-home-alice-work-x'), 'work-x');
});

test('cc alphabet: reads are guards, publishing is irreversible and not recommendable', async () => {
  const alphabet = loadAlphabet(ALPHABET);
  const all = await ccAdapter.read(SOURCE);
  const typed = applyAlphabet(alphabet, all[0]!);
  const types = typed.events.map((e) => e.type);
  assert.deepEqual(types, [
    'customer:prompt',
    'action:read_file',
    'system:tool_result',
    'action:edit_file',
    'system:tool_result',
    'action:git_inspect',
    'action:git_stage',
    'action:git_commit',
    'system:tool_result',
    'agent:utterance',
  ]);
  // A prompt is an episode boundary as a matter of record, not of inference.
  assert.equal(typed.events[0]!.kind, 'customer_intent');

  const by = (id: string) => alphabet.eventTypes.find((t) => t.id === id)!;
  assert.equal(by('action:read_file').consequence, 'none', 'a read is never a mining subject');
  assert.equal(by('action:git_inspect').consequence, 'none');
  assert.equal(by('action:git_commit').consequence, 'compensable');
  assert.equal(by('action:git_push').consequence, 'irreversible');
  // The five where a wrong default is unbounded (ACV §6.4).
  for (const id of ['action:git_discard', 'action:fs_delete', 'action:publish_artifact', 'action:mail_send', 'action:cloud_control']) {
    assert.equal(by(id).consequence, 'irreversible', id);
    assert.equal(by(id).recommendable, false, `${id} must not be recommendable`);
  }
  // The file path is the binding a per-file obligation needs, so it is
  // tokenised rather than hashed: joinable, and identifying nothing.
  const fileRule = alphabet.redaction.rules.find((r) => 'slot' in r && r.slot === 'file');
  assert.equal(fileRule?.strategy, 'token');
});
