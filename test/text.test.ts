// The text-resolution port. A resolver is pure and does no file IO; these
// tests hand it the shapes the adapters' own fixture tests assert against.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annotatableAdapters, joinEpisodeText, nullTextSource, slotText, textSourceFor } from '../src/index.ts';

test('an adapter with no utterances resolves to the null source, and the corpus is unannotatable', () => {
  // Not a defect: a BPIC event log carries no text, and the honest answer is
  // "this corpus cannot be annotated" rather than an empty string per site.
  assert.equal(textSourceFor('bpic').name, 'null');
  assert.equal(textSourceFor('tau2').name, 'null');
  assert.equal(textSourceFor('no-such-adapter').name, 'null');
  assert.equal(nullTextSource.text({ text: 'ignored' }), null);
  assert.deepEqual(annotatableAdapters(), ['abcd', 'cc', 'synthetic']);
});

test('synthetic turns carry the text the redaction scan exists to catch', () => {
  const s = textSourceFor('synthetic');
  assert.equal(s.text({ speaker: 'customer', text: 'I want a refund for order 4417.' }), 'I want a refund for order 4417.');
  assert.equal(s.text({ speaker: 'action', button: 'issue-refund' }), null);
  assert.equal(s.text({ speaker: 'customer', text: '   ' }), null, 'whitespace is not an utterance');
  assert.equal(s.text(null), null);
  assert.equal(s.text('a bare string'), null);
});

test('abcd drops action text, because action turns carry literal values in their prose', () => {
  const s = textSourceFor('abcd');
  assert.equal(s.text({ speaker: 'customer', text: 'my order never arrived', turn_count: 3 }), 'my order never arrived');
  assert.equal(s.text({ speaker: 'agent', text: 'let me pull that up', turn_count: 4 }), 'let me pull that up');
  assert.equal(
    s.text({ speaker: 'action', text: 'account has been pulled up for crystal minh.', turn_count: 5 }),
    null,
    'an action turn names the customer in prose; redaction runs downstream but this never reaches it',
  );
});

test('cc resolves a whole record and a content block, and declines the rest', () => {
  const s = textSourceFor('cc');
  // A whole JSONL record whose content is a plain string.
  assert.equal(s.text({ type: 'user', message: { role: 'user', content: 'add a test for the parser' } }), 'add a test for the parser');
  // A record whose content is an array is resolved one block down, not here.
  assert.equal(s.text({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }), null);
  // One content block.
  assert.equal(s.text({ type: 'text', text: 'I will start by reading the file.' }), 'I will start by reading the file.');
  assert.equal(s.text({ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }), null, 'a command is an argument value, not an utterance');
  assert.equal(s.text({ type: 'tool_result', content: 'file not found' }), 'file not found');
  assert.equal(s.text({ type: 'tool_result', content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }] }), 'line one\nline two');
  assert.equal(s.text({ type: 'tool_result', content: [{ type: 'image' }] }), null);
});

test('episode text is the event texts in order, and empty when there are none', () => {
  assert.equal(joinEpisodeText(['first', null, 'second']), 'first\nsecond');
  assert.equal(joinEpisodeText([null, null]), null);
  assert.equal(joinEpisodeText([]), null);
  assert.equal(joinEpisodeText(['  ', 'kept']), 'kept');
});

test('a slot source reads the slot, including a falsy one', () => {
  assert.equal(slotText({ reason: 'damaged' }, 'reason'), 'damaged');
  assert.equal(slotText({ amount: 0 }, 'amount'), '0', '0 is a value, not an absence');
  assert.equal(slotText({ ok: false }, 'ok'), 'false');
  assert.equal(slotText({ reason: null }, 'reason'), null);
  assert.equal(slotText({}, 'reason'), null);
});
