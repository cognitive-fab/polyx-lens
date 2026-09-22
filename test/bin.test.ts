// The command line as `npx` runs it: from a directory that is not this
// package, with no polyx.config.json in sight. The shipped sample must still
// be reachable by name, or the README's second command fails for everyone
// who did not clone the repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const bin = fileURLToPath(new URL('../bin/polyx-lens.mjs', import.meta.url));

test('cc-sample resolves from a directory with no polyx.config.json', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'lens-cwd-'));
  try {
    const r = spawnSync(process.execPath, ['--no-warnings', bin, 'cc-sample'], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /polyx lens — cc-sample against the claude-code contracts/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
