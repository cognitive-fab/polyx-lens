#!/usr/bin/env node
// Writes the committed annotation file for the observable fixture (JT9.4):
// what `polyx annotate synthetic-observable` would have recorded had a
// model been asked, produced by a stub that reads the text for real.
//
// Deterministic — a fixed `at`, a substring test, no jitter — so the file's
// digest is stable and a test can pin it. Run after generate.mjs and commit
// the output.
//
// This script does what the polyx-side pass does, in miniature, using only
// the free half: resolve each customer turn's text, redact it under the
// synthetic text profile, ask the stub, write one line per (site,
// predicate) with withheld lines included. It is the reference for what an
// annotation line looks like, as much as it is a fixture.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  builtinAlphabet,
  builtinPredicates,
  builtinTextProfile,
  emit,
  loadAlphabet,
  loadPredicateSet,
  loadTextProfile,
  profileId,
  redactText,
  syntheticAdapter,
  applyAlphabet,
  textSourceFor,
  writeAnnotations,
} from '../../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'synthetic-observable.json');

const alphabet = loadAlphabet(builtinAlphabet('alphabet.synthetic.yaml'));
const { set } = loadPredicateSet(builtinPredicates('synthetic'));
const profile = loadTextProfile(builtinTextProfile('synthetic'));
const text = textSourceFor('synthetic');
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// The stub: reads the text, as the model would, and is right every time
// because the fixture was written to make it so.
const stub = (t) => (/charged twice|billed twice|taken twice|double charge|identical charges/i.test(t) ? 0.96 : 0.04);

const raw = await syntheticAdapter.read(source);
const doc = JSON.parse(readFileSync(source, 'utf8'));
const lines = [];
for (const r of raw) {
  const typed = applyAlphabet(alphabet, r);
  for (const e of typed.events) {
    // One episode per interaction in this family: the null segmenter's id.
    const episode = `${r.id}#0`;
    const rawRecord = r.events[e.seq];
    // Follow the adapter's RawRef back into the source, the way show.ts would.
    const turn = doc.interactions[Number(rawRecord.raw.path.split('/')[2])].turns[Number(rawRecord.raw.path.split('/')[4])];
    const t = text.text(turn);
    if (t === null) continue;
    const redacted = redactText(t, profile);
    for (const p of set.predicates) {
      const prob = stub(redacted);
      lines.push({ i: r.id, e: episode, seq: e.seq, pred: p.id, p: prob, fact: p.fact, value: emit(prob, p.bands), pv: set.version, redaction: profileId(profile), sha: sha16(redacted), at: 1758240000 });
    }
  }
}
const out = writeAnnotations(join(here, `synthetic-observable@${set.version}.jsonl`), lines);
console.log(`wrote ${out.lines.length} lines, digest ${out.digest}`);
