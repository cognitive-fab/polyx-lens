#!/usr/bin/env node
// Extract three hand-checked BPIC 2017 traces into a small XES fixture:
// the first trace, the first declined application, the first cancelled one.
// Requires corpora/bpic2017/BPI Challenge 2017.xes.gz.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traces } from 'polyx-lens';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', '..', 'corpora', 'bpic2017', 'BPI Challenge 2017.xes.gz');
const want = { first: null, declined: null, cancelled: null };
let i = 0;
for await (const t of traces(src)) {
  if (!want.first) want.first = { i, t };
  else if (!want.declined && t.includes('value="A_Denied"')) want.declined = { i, t };
  else if (!want.cancelled && t.includes('value="A_Cancelled"') && !t.includes('value="A_Pending"')) want.cancelled = { i, t };
  if (want.first && want.declined && want.cancelled) break;
  i++;
}
mkdirSync(here, { recursive: true });
const picked = [want.first, want.declined, want.cancelled];
const xml = `<?xml version="1.0" ?><log xes.version="1849.2016">${picked.map((p) => p.t).join('')}</log>`;
writeFileSync(join(here, 'bpic_sample.xes'), xml + '\n');
for (const p of picked) {
  const names = [...p.t.matchAll(/<event>[\s\S]*?<\/event>/g)].map((m) => {
    const name = /key="concept:name" value="([^"]+)"/.exec(m[0])[1];
    const lc = /key="lifecycle:transition" value="([^"]+)"/.exec(m[0])[1];
    const res = /key="org:resource" value="([^"]+)"/.exec(m[0])?.[1];
    return `${name}/${lc}/${res}`;
  });
  const head = p.t.slice(0, p.t.indexOf('<event>'));
  console.log('=== source index', p.i, head.replace(/<\/?string[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
  console.log(names.length, 'events:', names.slice(0, 12).join(' | '), '…', names.slice(-4).join(' | '));
}
