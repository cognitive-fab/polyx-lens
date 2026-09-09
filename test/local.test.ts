// The zero-configuration entry: where an agent's own logs already are.
//
// These tests inject a home directory rather than reading the real one — a test
// that passes only on a machine with transcripts on it is not a test.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { claudeProjectsDir, localCorpus } from '../src/lens/local.ts';

function withHome(build: (projects: string) => void): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'lens-home-'));
  const projects = claudeProjectsDir(home);
  mkdirSync(projects, { recursive: true });
  build(projects);
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('with no transcripts there is nothing to report, and it says so rather than reporting nothing', () => {
  const missing = mkdtempSync(join(tmpdir(), 'lens-empty-'));
  try {
    assert.equal(localCorpus(missing), null, 'no .claude/projects at all');
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }

  const empty = withHome(() => {});
  try {
    assert.equal(localCorpus(empty.home), null, 'the directory exists and holds nothing');
  } finally {
    empty.cleanup();
  }

  // A directory of directories with no transcripts in them is still nothing.
  const bare = withHome((p) => mkdirSync(join(p, 'C--Users-someone-code-thing')));
  try {
    assert.equal(localCorpus(bare.home), null);
  } finally {
    bare.cleanup();
  }
});

test('transcripts are found and counted before anything is parsed', () => {
  const h = withHome((p) => {
    mkdirSync(join(p, 'C--Users-someone-code-alpha'));
    writeFileSync(join(p, 'C--Users-someone-code-alpha', 'one.jsonl'), '');
    writeFileSync(join(p, 'C--Users-someone-code-alpha', 'two.jsonl'), '');
    mkdirSync(join(p, 'C--Users-someone-code-beta'));
    writeFileSync(join(p, 'C--Users-someone-code-beta', 'three.jsonl'), '');
    // Not a transcript, and not counted as one.
    writeFileSync(join(p, 'C--Users-someone-code-beta', 'notes.md'), '');
  });
  try {
    const local = localCorpus(h.home)!;
    assert.ok(local);
    assert.equal(local.projects, 2);
    assert.equal(local.sessions, 3);
    assert.equal(local.config.adapter, 'cc');
    assert.equal(local.config.domain, 'claude-code', 'the contract set is keyed by the system');
    assert.equal(local.config.segmenter, 'polyness', 'a session holds many tasks; the null segmenter would make one episode of an afternoon');
    // Both the alphabet and the adapter assert the corpus family of a record
    // they produced, so the name has to start with it.
    assert.ok(local.name.startsWith('cc'), `${local.name} must be in the cc family`);
  } finally {
    h.cleanup();
  }
});
