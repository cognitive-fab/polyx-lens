// ABCD — the primary corpus (TS §4.1). Chen et al. 2021, MIT.
//
// Source: abcd_v1.1.json, keyed train / dev / test, each a list of
// conversations carrying convo_id, scenario, original and delexed.
//
// We read `delexed`, never `original`. It is only PARTLY delexicalised: agent
// and customer text carry <account_id>-style tokens, but action turns still
// carry the literal values in `targets[3]` and often in their text
// ("account has been pulled up for crystal minh."). So free text is dropped
// on the floor here, and every slot value goes through the alphabet's
// redaction before anything is persisted.
//
// What each turn's `targets` holds: [subflow, kind, button, values, utt_id].
//   kind = 'take_action'         → action, button names it, values are slots
//   kind = 'retrieve_utterance'  → agent utterance
//   kind = null                  → customer turn
//
// Slot NAMES come from ontology.json's per-button value lists when the
// count lines up; otherwise the values are kept as value_0…n and redacted by
// the wildcard rule. Guessing a name for a positional value would put a phone
// number under `amount` and then keep it because amounts are kept.
//
// ABCD has no agent ids and no timestamps. Every conversation is handled by
// one operator; provenance collapses to operator level on this corpus, and
// `at` is turn order. Both are stated in the spec, not hidden here.
//
// guidelines.json and kb.json are the answer key. This adapter does not open
// them, and the boundary check makes sure nothing on this side ever does.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Scalar } from '../record.ts';
import type { Adapter, RawEvent, RawInteraction } from './types.ts';

interface AbcdTurn {
  speaker: 'agent' | 'customer' | 'action';
  text: string;
  turn_count: number;
  targets: [string, string | null, string | null, Scalar[], number];
}

interface AbcdConversation {
  convo_id: number;
  scenario: {
    personal?: Record<string, Scalar>;
    order?: Record<string, Scalar>;
    flow: string;
    subflow: string;
  };
  delexed: AbcdTurn[];
}

interface AbcdFile {
  train: AbcdConversation[];
  dev: AbcdConversation[];
  test: AbcdConversation[];
}

interface Ontology {
  actions: Record<string, Record<string, string[]>>;
}

export const ABCD_OPERATOR = 'abcd';

/** The vocabulary — button → slot names — from ontology.json beside the corpus file. */
export function loadOntology(corpusFile: string): Map<string, string[]> {
  const o = JSON.parse(readFileSync(join(dirname(corpusFile), 'ontology.json'), 'utf8')) as Ontology;
  const out = new Map<string, string[]>();
  for (const group of Object.values(o.actions)) for (const [button, slots] of Object.entries(group)) out.set(button, slots);
  return out;
}

/** Scenario state the agent had on screen: categorical account facts, never identifying. */
const FACTS: Array<[string, 'personal' | 'order', string]> = [
  ['customer.member_level', 'personal', 'member_level'],
  ['order.payment_method', 'order', 'payment_method'],
  ['order.num_products', 'order', 'num_products'],
  ['order.packaging', 'order', 'packaging'],
  ['order.state', 'order', 'state'],
];

export function toRaw(convo: AbcdConversation, split: string, index: number, file: string, ontology: Map<string, string[]>): RawInteraction {
  const startedAt = convo.convo_id * 1000;
  let firstCustomer = true;
  const events: RawEvent[] = convo.delexed.map((t, ti) => {
    const raw = { file, path: `/${split}/${index}/delexed/${ti}` };
    const at = startedAt + t.turn_count;
    if (t.speaker === 'action') {
      const button = t.targets[2] ?? 'unknown-action';
      const values = t.targets[3] ?? [];
      const names = ontology.get(button);
      const slots: Record<string, Scalar> = {};
      if (names && names.length === values.length) values.forEach((v, i) => (slots[names[i]!] = v));
      else values.forEach((v, i) => (slots[`value_${i}`] = v));
      return { at, features: { speaker: 'action', button }, slots, raw };
    }
    if (t.speaker === 'customer') {
      const features: Record<string, Scalar> = { speaker: 'customer' };
      if (firstCustomer) {
        // The one classified customer turn: the scenario's subflow stands in
        // for an intent classifier's output. Later customer turns are untyped.
        features.intent = convo.scenario.subflow;
        features.flow = convo.scenario.flow;
        firstCustomer = false;
      }
      return { at, features, slots: {}, raw };
    }
    return { at, features: { speaker: 'agent' }, slots: {}, raw };
  });
  // One scenario, one subflow, per conversation: the ground truth for
  // segmentation on this corpus is exactly one episode (F3.3).
  const hints: Record<string, Scalar> = { split, flow: convo.scenario.flow, subflow: convo.scenario.subflow, expected_episodes: 1 };
  const facts: Record<string, Scalar> = {};
  for (const [name, section, key] of FACTS) {
    const v = convo.scenario[section]?.[key];
    if (v !== undefined && v !== null && v !== '') facts[name] = v;
  }
  return {
    id: `abcd-${convo.convo_id}`,
    corpus: 'abcd',
    actor: { operatorId: ABCD_OPERATOR },
    startedAt,
    events,
    facts,
    hints,
  };
}

export const abcdAdapter: Adapter = {
  name: 'abcd',
  async read(source: string): Promise<RawInteraction[]> {
    const doc = JSON.parse(readFileSync(source, 'utf8')) as AbcdFile;
    const ontology = loadOntology(source);
    const out: RawInteraction[] = [];
    for (const split of ['train', 'dev', 'test'] as const) {
      (doc[split] ?? []).forEach((c, i) => out.push(toRaw(c, split, i, source, ontology)));
    }
    return out;
  },
};
