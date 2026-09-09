// TS §6: a port with one implementation is a wish. Both segmenters and both
// subject extractors run on the fixture corpora; where they should agree they
// must, and where they differ the difference is reported as a figure.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consequentialTypes } from '../src/index.ts';
import { audit } from '../src/index.ts';
import { loadCorpus } from '../src/index.ts';
import { polynessExtractor } from '../src/index.ts';
import { polynessSegmenter } from '../src/index.ts';
import { nullSegmenter } from '../src/index.ts';
import { naiveExtractor, type Subject } from '../src/index.ts';
import { tempWorkspace } from './helpers.ts';

const shape = (s: Subject[]) =>
  s.map((x) => ({
    type: x.type,
    n: x.instances.length,
    instances: x.instances.map((i) => [i.interactionId, i.seq, i.episodeId, i.before.length, i.sessionBefore.length, i.all.length, i.after.length]),
  }));

test('null and polyness segmenters produce the same episodes on the synthetic corpus (one intent per interaction)', async () => {
  const ws = tempWorkspace();
  try {
    const a = await loadCorpus(ws.config, 'synthetic', { segmenter: 'null' });
    const b = await loadCorpus(ws.config, 'synthetic', { segmenter: 'polyness' });
    assert.equal(a.segmenter, 'null');
    assert.equal(b.segmenter, 'polyness');
    const eps = (c: typeof a) => c.interactions.map((it) => it.events.map((e) => e.episode));
    assert.deepEqual(eps(b), eps(a));
    const ra = audit(a, ws.thresholds);
    const rb = audit(b, ws.thresholds);
    assert.deepEqual(ra.episodes.groundTruth, { interactions: 46, agreement: 1 });
    assert.deepEqual(rb.episodes.groundTruth, { interactions: 46, agreement: 1 });
  } finally {
    ws.cleanup();
  }
});

test('the polyness segmenter opens a new episode at every classified intent and drops nothing', async () => {
  const events = [
    { seq: 0, at: 0, episode: 'x', kind: 'agent_utterance', type: 'agent:utterance', slots: {}, raw: { file: 'f', path: '/0' } },
    { seq: 1, at: 1, episode: 'x', kind: 'customer_intent', type: 'intent:a', slots: {}, raw: { file: 'f', path: '/1' } },
    { seq: 2, at: 2, episode: 'x', kind: 'action', type: 'action:x', slots: {}, raw: { file: 'f', path: '/2' } },
    { seq: 3, at: 3, episode: 'x', kind: 'customer_intent', type: 'intent:b', slots: {}, raw: { file: 'f', path: '/3' } },
    { seq: 4, at: 4, episode: 'x', kind: 'action', type: 'action:y', slots: {}, raw: { file: 'f', path: '/4' } },
    { seq: 5, at: 5, episode: 'x', kind: 'customer_intent', type: 'intent:c', slots: {}, raw: { file: 'f', path: '/5' } },
  ] as const;
  const local = await polynessSegmenter.segment([...events], { interactionId: 'i' });
  assert.deepEqual(
    [...local].sort((p, q) => p[0] - q[0]),
    [
      [0, '0'],
      [1, '1'],
      [2, '1'],
      [3, '2'],
      [4, '2'],
      [5, '2'], // trailing intent: nothing follows, so it joins the last episode
    ],
  );
  assert.deepEqual([...(await nullSegmenter.segment([...events], { interactionId: 'i' })).values()], ['0', '0', '0', '0', '0', '0']);
});

test('naive and polyness subject extractors agree instance for instance', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const consequential = consequentialTypes(corpus.alphabet);
    const a = await naiveExtractor.extract(corpus.interactions, consequential);
    const b = await polynessExtractor.extract(corpus.interactions, consequential);
    assert.deepEqual(shape(b), shape(a));
    assert.deepEqual(
      a.map((s) => [s.type, s.instances.length]),
      [
        ['action:apply_credit', 50],
        ['action:reverse_credit', 50],
        ['action:issue_refund', 20],
        ['action:quote_rate', 16],
        ['action:escalate', 5],
        ['action:offer_credit', 5],
      ],
    );
    // windows: the planted slip has no verify-identity before its refund
    const refunds = a.find((s) => s.type === 'action:issue_refund')!;
    const slip = refunds.instances.find((i) => i.interactionId === 'syn-0008')!;
    assert.ok(!slip.before.some((e) => e.type === 'action:verify_identity'));
    assert.ok(refunds.instances.filter((i) => i.before.some((e) => e.type === 'action:verify_identity')).length === 19);
    // and free actions are never subjects
    assert.ok(!a.some((s) => s.type === 'action:add_note'));
  } finally {
    ws.cleanup();
  }
});
