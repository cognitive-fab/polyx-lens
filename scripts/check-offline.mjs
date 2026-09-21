#!/usr/bin/env node
// "No mining, no model call, nothing leaves the machine." That sentence is the
// first line of this package's description and the reason it can be read by
// someone who will not read a licence. Until now it was a promise; this makes
// it a check.
//
// The claim is structural, not behavioural: the package must contain no code
// that COULD make a network call, under any configuration, whether or not a
// key is set. An adapter reads files from disk and that is all. The Jev
// adapter lives in polyx, behind the observation port, precisely so that this
// check can pass here.
//
// Treat a failure as a licensing and privacy bug, not hygiene. Anyone who
// installed this package on the strength of that sentence is relying on it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

// `vendor/` is excluded: it is a vendored dependency with its own licence and
// its own audit, and pretending this script reviewed it would be worse than
// saying it did not.
const FORBIDDEN = [
  [/\bfrom\s+['"]node:(https?|net|tls|dgram|dns)['"]/, 'a node network module'],
  [/\brequire\(\s*['"]node:?(https?|net|tls|dgram|dns)['"]\s*\)/, 'a node network module'],
  [/\bimport\(\s*['"]node:(https?|net|tls|dgram|dns)['"]\s*\)/, 'a dynamic import of a node network module'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bnew\s+WebSocket\b/, 'a WebSocket'],
  [/\bnew\s+XMLHttpRequest\b/, 'an XMLHttpRequest'],
  [/\bfrom\s+['"](undici|axios|node-fetch|got|superagent|ws)['"]/, 'an HTTP client package'],
  [/\bnavigator\.sendBeacon\b/, 'sendBeacon'],
  // A key read here would mean the vendor reached into the free half even if
  // nothing was sent yet.
  [/\bPOLYX_JEV_KEY\b|\bTYPESAFE_API_KEY\b/, 'a vendor API key'],
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|mjs|js)$/.test(name)) yield p;
  }
}

const failures = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*')) return;
      for (const [re, what] of FORBIDDEN) {
        if (re.test(line)) failures.push(`${rel}:${i + 1}: ${what} — ${t}`);
      }
    });
}

// The dependency list is part of the claim: a transitive HTTP client is still
// a way out of the machine.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (/^(undici|axios|node-fetch|got|superagent|ws|openai|@anthropic-ai\/)/.test(dep)) {
    failures.push(`package.json: dependency '${dep}' can make a network call`);
  }
}

if (failures.length) {
  console.error('OFFLINE VIOLATION — polyx-lens claims nothing leaves the machine, and this code could:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('offline ok — no module in polyx-lens/src can make a network call');
