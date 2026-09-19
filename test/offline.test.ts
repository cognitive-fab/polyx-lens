// "No mining, no model call, nothing leaves the machine" is the first line of
// this package's description. The check makes it inspectable; this makes sure
// the check can fail, because a check that cannot fail is decoration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'check-offline.mjs');
const run = () => spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });

test('the package passes the offline check', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

// The script walks the real src/, so a negative test has to plant a file in it
// and remove it again. Written and deleted in one test so a failure cannot
// leave the tree dirty.
const plant = (name: string, body: string, expect: RegExp) => {
  const f = join(ROOT, 'src', name);
  try {
    writeFileSync(f, body);
    const r = run();
    assert.equal(r.status, 1, `expected a violation for ${name}`);
    assert.match(r.stderr, /OFFLINE VIOLATION/);
    assert.match(r.stderr, expect);
  } finally {
    rmSync(f, { force: true });
  }
};

test('an http import in the free half fails the offline check', () => {
  plant('__probe_http.ts', "import { request } from 'node:https';\nexport const r = request;\n", /a node network module/);
});

test('a bare fetch in the free half fails the offline check', () => {
  plant('__probe_fetch.ts', "export const get = (u: string) => fetch(u);\n", /fetch\(\)/);
});

test('reading the vendor key in the free half fails the offline check', () => {
  plant('__probe_key.ts', 'export const on = Boolean(process.env.POLYX_JEV_KEY);\n', /a vendor API key/);
});

test('the tree is left clean afterwards', () => {
  assert.equal(run().status, 0);
});

test('the description still makes the claim the check enforces', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { description: string; scripts: Record<string, string> };
  assert.match(pkg.description, /nothing leaves the machine/);
  assert.match(pkg.scripts.ci ?? '', /check:offline/, 'the check has to run in CI or it is not a check');
});
