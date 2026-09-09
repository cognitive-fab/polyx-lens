import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RecordError, validateInteraction } from '../src/index.ts';

const good = () => ({
  id: 'i1',
  corpus: 'synthetic',
  actor: { operatorId: 'op', teamId: 't', agentId: 'a' },
  startedAt: 1,
  events: [
    { seq: 0, at: 1, episode: 'i1#0', kind: 'action', type: 'action:x', slots: { a: 1 }, raw: { file: 'f', path: '/0' } },
    { seq: 1, at: 2, episode: 'i1#0', kind: 'system', type: 'system:ok', slots: {}, result: 'ok', raw: { file: 'f', path: '/1' } },
  ],
  outcome: { label: 'resolved', at: 2, lagMs: 0, source: 'in_band' },
});

test('validateInteraction accepts a well-formed record and copies it', () => {
  const g = good();
  const v = validateInteraction(g);
  assert.deepEqual(v, g);
  assert.notEqual(v.events, g.events);
});

test('validateInteraction rejects every malformed shape it is asked about', () => {
  const cases: Array<[string, (g: ReturnType<typeof good>) => void]> = [
    ['missing id', (g) => delete (g as Partial<typeof g>).id],
    ['missing operator', (g) => delete (g.actor as Partial<typeof g.actor>).operatorId],
    ['seq mismatch', (g) => (g.events[1]!.seq = 5)],
    ['bad kind', (g) => (g.events[0]!.kind = 'tool_call')],
    ['empty type', (g) => (g.events[0]!.type = '')],
    ['object slot', (g) => ((g.events[0]!.slots as Record<string, unknown>).a = { nested: true })],
    ['bad result', (g) => (g.events[1]!.result = 'meh')],
    ['raw without file', (g) => delete (g.events[0]!.raw as Partial<{ file: string }>).file],
    ['bad outcome source', (g) => (g.outcome.source = 'guess')],
  ];
  for (const [name, mutate] of cases) {
    const g = good();
    mutate(g);
    assert.throws(() => validateInteraction(g), RecordError, name);
  }
});
