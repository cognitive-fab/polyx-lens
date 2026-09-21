// The annotation store (JT3). Stable order, a digest that pins it, a partial
// marker that cannot be mistaken for complete, and a diff that measures drift.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  annotationPath,
  diffAnnotations,
  digestOf,
  indexAnnotations,
  observedFactsAt,
  readAnnotations,
  serialiseLines,
  writeAnnotations,
  type AnnotationLine,
} from '../src/index.ts';

const line = (i: string, seq: number, pred: string, p: number, value: boolean | null): AnnotationLine => ({
  i, e: `${i}#0`, seq, pred, p, fact: `obs.${pred}`, value, pv: 1, redaction: 'text.synthetic@1', sha: 'abcdef0123456789', at: 1758240000,
});

test('lines are written sorted by (interaction, episode, seq, predicate) whatever order they arrive in', () => {
  const lines = [line('b', 2, 'z', 0.9, true), line('a', 1, 'z', 0.1, null), line('a', 1, 'a', 0.9, true), line('a', 0, 'z', 0.5, null)];
  const out = serialiseLines(lines).trim().split('\n').map((l) => JSON.parse(l) as AnnotationLine);
  assert.deepEqual(out.map((l) => `${l.i}/${l.seq}/${l.pred}`), ['a/0/z', 'a/1/a', 'a/1/z', 'b/2/z']);
});

test('a withheld observation is a written line with value null, not a missing line (JT3.2)', () => {
  const s = serialiseLines([line('a', 0, 'z', 0.5, null)]);
  assert.match(s, /"value":null/);
  assert.match(s, /"p":0\.5/, 'p is retained on a withheld line (JT3.3)');
});

test('the digest is over the bytes, sixteen hex, and reads like a corpusRevision', () => {
  const s = serialiseLines([line('a', 0, 'z', 0.9, true)]);
  assert.match(digestOf(s), /^[0-9a-f]{16}$/);
  assert.equal(digestOf(s), digestOf(serialiseLines([line('a', 0, 'z', 0.9, true)])), 'same lines, same digest');
  assert.notEqual(digestOf(s), digestOf(serialiseLines([line('a', 0, 'z', 0.91, true)])), 'one quantum of jitter changes the digest — which is the point');
});

test('write is atomic and a partial pass is renamed so it cannot pass for complete (JT3.4, JT8.5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-ann-'));
  try {
    const path = annotationPath(dir, 'synthetic', 1);
    const full = writeAnnotations(path, [line('a', 0, 'z', 0.9, true)]);
    assert.equal(full.path, path);
    assert.equal(full.partial, false);
    assert.equal(readFileSync(path, 'utf8'), serialiseLines(full.lines));
    assert.equal(readAnnotations(path)!.digest, full.digest);

    const part = writeAnnotations(annotationPath(dir, 'other', 1), [line('a', 0, 'z', 0.9, true)], { partial: true });
    assert.match(part.path, /other@1\.partial\.jsonl$/);
    const back = readAnnotations(annotationPath(dir, 'other', 1))!;
    assert.equal(back.partial, true, 'a reader asked for the complete file is told it got the partial one');
    assert.equal(readAnnotations(annotationPath(dir, 'none', 1)), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('facts at a site omit withheld lines, so the advisor sees unknown', () => {
  const file = { path: '', digest: '', partial: false, lines: [line('a', 3, 'x', 0.9, true), line('a', 3, 'y', 0.5, null), line('a', 3, 'z', 0.02, false)] };
  assert.deepEqual(observedFactsAt(file, 'a', 'a#0', 3), { 'obs.x': true, 'obs.z': false });
  assert.equal(indexAnnotations(file).get('a\u0000a#0\u00003')!.length, 3, 'the index keeps the withheld line: the predicate WAS asked');
});

test('the diff counts changed facts, not moved probabilities (JF6.6)', () => {
  const before = { path: '', digest: '', partial: false, lines: [line('a', 0, 'x', 0.93, true), line('a', 1, 'x', 0.5, null), line('a', 2, 'x', 0.84, null), line('b', 0, 'x', 0.9, true)] };
  const after = { path: '', digest: '', partial: false, lines: [line('a', 0, 'x', 0.94, true), line('a', 1, 'x', 0.55, null), line('a', 2, 'x', 0.85, true), line('c', 0, 'x', 0.9, true)] };
  const d = diffAnnotations(before, after);
  assert.equal(d.shared, 3);
  assert.equal(d.changed, 1, 'only a/2 crossed the band');
  assert.equal(d.moved, 1, 'a/1 moved by more than the jitter but stayed withheld');
  assert.equal(d.onlyBefore, 1);
  assert.equal(d.onlyAfter, 1);
  assert.deepEqual(d.byPredicate, { x: { shared: 3, changed: 1 } });
});
