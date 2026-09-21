// Text redaction (JT7.1). A redactor that is correct but not applied is the
// failure mode that matters, so the polyx-side scan over stored artefacts is
// the real test (redaction.test.ts). This is the unit half: the rules catch
// what they claim to, surrogates are stable and joinable with slots, and a
// surrogate is never re-redacted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  builtinTextProfile,
  loadTextProfile,
  parseTextProfile,
  previewRedaction,
  profileId,
  redactText,
  redactSlots,
  TextProfileError,
} from '../src/index.ts';

const SYN = loadTextProfile(builtinTextProfile('synthetic')!);
const CC = loadTextProfile(builtinTextProfile('cc')!);

test('the shipped profiles load, and carry the id every annotation line records', () => {
  assert.equal(profileId(SYN), 'text.synthetic@1');
  assert.equal(profileId(CC), 'text.cc@1');
  assert.equal(builtinTextProfile('bpic2017'), null, 'an event log carries no text and declares no profile');
});

test('every identifier the fixture seeds is caught', () => {
  const seeded = (JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'synthetic', 'seeded.json'), 'utf8')) as { identifiers: string[] }).identifiers;
  const text = `Hi, my email is jane.doe@example.com and raj.patel@example.org; call +1-555-0100-7788 or +44 20 7946 0958 about ACC-99887766 and ACC-11223344.`;
  const out = redactText(text, SYN);
  for (const id of seeded) assert.ok(!out.includes(id), `${id} survived: ${out}`);
});

test('a token surrogate is stable within a corpus, and joinable with the slot it stands in for', () => {
  const a = redactText('refund to jane.doe@example.com please', SYN);
  const b = redactText('jane.doe@example.com again', SYN);
  const tok = /email#[0-9a-f]{12}/.exec(a)?.[0];
  assert.ok(tok, a);
  assert.ok(b.includes(tok!), 'same value, same corpus, same token — joins survive');
  // `as: account` keys the surrogate by the slot name, so the text token and
  // the slot token are one token.
  const inText = /account#[0-9a-f]{12}/.exec(redactText('about ACC-99887766', SYN))?.[0];
  const inSlot = redactSlots({ account: 'ACC-99887766' }, { corpus: SYN.corpus, rules: [{ slot: 'account', strategy: 'token' }] }).account;
  assert.equal(inText, inSlot, 'a path in a message and the same path in a slot must redact identically');
});

test('hash is not joinable across corpora; token is scoped to one', () => {
  const other = { ...SYN, corpus: 'elsewhere' };
  assert.notEqual(redactText('jane.doe@example.com', SYN), redactText('jane.doe@example.com', other));
});

test('a surrogate is never re-redacted, whatever order the rules run in', () => {
  // The email token is `email#<12 hex>`; a digits rule after it must leave
  // the hex alone or "the surrogate is stable" is false.
  const once = redactText('jane.doe@example.com', SYN);
  assert.equal(redactText(once, SYN), once, 'idempotent');
  assert.match(once, /^email#[0-9a-f]{12}$/);
});

test('the cc profile tokenises paths under the file slot, drops credentials, keeps prose', () => {
  const r = previewRedaction('Read C:\\Users\\jjd\\code\\polyx\\src\\serve\\advisor.ts, then push. Key is sk-abcdefghijklmnop123456 and see https://example.com/x?y=1', CC);
  assert.ok(!r.after.includes('jjd'), r.after);
  assert.ok(!r.after.includes('sk-abcdef'), r.after);
  assert.ok(!r.after.includes('example.com/x'), r.after);
  assert.match(r.after, /file#[0-9a-f]{12}/, 'a path becomes the same kind of token slot.file carries');
  assert.match(r.after, /<secret>/);
  assert.ok(r.after.includes('then push'), 'the words around the identifiers survive');
  assert.deepEqual(Object.keys(r.fired).sort(), ['literal→secret', 'path→file', 'url']);
});

test('a profile that redacts nothing may not exist', () => {
  assert.throws(() => parseTextProfile('corpus: x\nversion: 1\nrules: []\n'), TextProfileError);
  assert.throws(() => parseTextProfile('corpus: x\nversion: 1\nrules: []\n'), /must not exist/);
  assert.throws(() => parseTextProfile('corpus: x\nversion: 1\nrules:\n  - { pattern: literal, strategy: token }\n'), /needs a match expression/);
  assert.throws(() => parseTextProfile('corpus: x\nversion: 1\nrules:\n  - { pattern: literal, match: "(", strategy: token }\n'), /not a valid expression/);
});

test('the preview keeps the original beside the result, for the reviewer and for nothing else', () => {
  const r = previewRedaction('mail jane.doe@example.com', SYN);
  assert.equal(r.before, 'mail jane.doe@example.com');
  assert.notEqual(r.after, r.before);
  assert.deepEqual(r.fired, { email: 1 });
});

test('the path rule catches JSON-escaped and spaced paths, and leaves prose fractions alone', () => {
  // Every one of these survived the first dry run over the real corpus.
  const escaped = redactText('"file": "C:\\Users\\jjd\\code\\polysec\\scripts\\lib.mjs"', CC);
  assert.ok(!escaped.includes('jjd'), escaped);
  const bare = redactText("node x.mjs 'C:\\Users\\jjd' --tidy", CC);
  assert.ok(!bare.includes('jjd'), bare);
  const posix = redactText('<bash-stdout>/c/Users/jjd/code/kanjo</bash-stdout>', CC);
  assert.ok(!posix.includes('jjd'), posix);
  const rel = redactText('read src/serve/advisor.ts and docs/spec.md', CC);
  assert.ok(!rel.includes('advisor.ts') && !rel.includes('spec.md'), rel);
  // Prose that merely contains a slash is not a path, and tokenising it
  // would cost the predicate the very words it reads.
  const prose = redactText('either/or, and/or, TCP/IP, 24/7, yes/no', CC);
  assert.equal(prose, 'either/or, and/or, TCP/IP, 24/7, yes/no');
});

test("Claude Code's dash-encoded project directory is caught as a project token", () => {
  const out = redactText('35 `C--Users-jjd-code-polysec` entries and "project": "C--Users-jjd"', CC);
  assert.ok(!out.includes('jjd'), out);
  assert.match(out, /project#[0-9a-f]{12}/);
});
