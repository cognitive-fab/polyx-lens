#!/usr/bin/env node
// Extract three hand-checked conversations from the real ABCD file into a
// fixture (candidates stripped — they are retrieval distractors, not data).
// Requires corpora/abcd/abcd_v1.1.json (node corpora/fetch-abcd.mjs).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const d = JSON.parse(readFileSync(join(root, 'corpora', 'abcd', 'abcd_v1.1.json'), 'utf8'));

const pick = [
  d.train[0],
  d.train.find((c) => c.delexed.some((t) => t.targets[2] === 'offer-refund')),
  d.dev.find((c) => c.delexed.some((t) => t.targets[2] === 'make-purchase')),
];
const strip = (c) => ({
  convo_id: c.convo_id,
  scenario: c.scenario,
  original: c.original,
  delexed: c.delexed.map((t) => ({ speaker: t.speaker, text: t.text, turn_count: t.turn_count, targets: t.targets })),
});
mkdirSync(here, { recursive: true });
writeFileSync(join(here, 'abcd_sample.json'), JSON.stringify({ train: [strip(pick[0]), strip(pick[1])], dev: [strip(pick[2])], test: [] }, null, 1) + '\n');
copyFileSync(join(root, 'corpora', 'abcd', 'ontology.json'), join(here, 'ontology.json'));

for (const c of pick) {
  console.log('===', c.convo_id, c.scenario.flow, c.scenario.subflow, JSON.stringify(c.scenario.personal), JSON.stringify(c.scenario.order));
  c.delexed.forEach((t, i) =>
    console.log(i, t.speaker, t.turn_count, t.targets[2] || '', JSON.stringify(t.targets[3]), t.speaker !== 'action' ? '' : '| ' + t.text),
  );
}
