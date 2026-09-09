// Adapter registry. One entry per source format; each is a pure function from
// source files to raw interactions with a fixture test asserting field-level
// output on hand-checked examples (F1.1).
import { abcdAdapter } from './abcd.ts';
import { bpicAdapter } from './bpic.ts';
import { ccAdapter } from './cc.ts';
import { syntheticAdapter } from './synthetic.ts';
import { tau2Adapter } from './tau2.ts';
import type { Adapter } from './types.ts';

const ADAPTERS: Record<string, Adapter> = {
  synthetic: syntheticAdapter,
  abcd: abcdAdapter,
  tau2: tau2Adapter,
  bpic: bpicAdapter,
  cc: ccAdapter,
};

export function adapterFor(name: string): Adapter {
  const a = ADAPTERS[name];
  if (!a) throw new Error(`no adapter named '${name}' (known: ${Object.keys(ADAPTERS).join(', ')})`);
  return a;
}

export function registerAdapter(adapter: Adapter): void {
  ADAPTERS[adapter.name] = adapter;
}

export function adapterNames(): string[] {
  return Object.keys(ADAPTERS);
}

export type { Adapter, RawEvent, RawInteraction } from './types.ts';
