// BPIC 2017 — the banking corpus (TS §4.3). van Dongen 2017, 4TU.ResearchData.
//
// Real loan-application event logs from a financial institution: 31,509
// cases, 1.2M events, genuine consequential events (offers created and
// sent, applications accepted, denied, cancelled), genuine outcomes, no
// dialogue and no agent. `customer_intent`, `customer_utterance` and
// `agent_utterance` are simply absent; the miner does not assume they exist.
//
// Source: one XES file, gzipped, on ONE LINE — 578 MB uncompressed. It is
// read as a gunzip stream and cut at `</trace>` boundaries; no DOM, no XML
// library. Only the attributes the mapping needs are read.
//
// Mapping:
//   trace                     → Interaction, id = concept:name (Application_…)
//   event                     → features { speaker: action, name: concept:name, lifecycle, origin }
//   org:resource              → the case's most frequent resource is its agentId (provenance at agent level)
//   trace attributes          → facts: ApplicationType, LoanGoal (RequestedAmount is continuous; kept as a fact, never a condition)
//   terminal A_* state        → outcome accepted (A_Pending) | declined (A_Denied) | cancelled (A_Cancelled)
//   time:timestamp            → at; the outcome's lagMs is the case duration — real, and days long
//
// Licence: 4TU General Terms of Use; recorded in DATASETS.md before ingestion.
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import type { Scalar } from '../record.ts';
import type { Adapter, RawEvent, RawInteraction } from './types.ts';
import { cmp } from '../order.ts';

export const BPIC_OPERATOR = 'bpic2017';

const ATTR = /<(string|date|float|int|boolean) key="([^"]+)" value="([^"]*)"\/?>/g;

function attrs(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(ATTR)) out[m[2]!] = m[3]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  return out;
}

const OUTCOMES: Record<string, string> = { A_Pending: 'accepted', A_Denied: 'declined', A_Cancelled: 'cancelled' };

export function traceToRaw(traceXml: string, index: number, file: string): RawInteraction {
  const firstEvent = traceXml.indexOf('<event>');
  const head = attrs(firstEvent >= 0 ? traceXml.slice(0, firstEvent) : traceXml);
  const id = head['concept:name'] ?? `trace-${index}`;
  const events: RawEvent[] = [];
  const resources = new Map<string, number>();
  let outcome: string | undefined;
  let outcomeAt = 0;
  let j = 0;
  for (const m of traceXml.matchAll(/<event>([\s\S]*?)<\/event>/g)) {
    const a = attrs(m[1]!);
    const at = Date.parse(a['time:timestamp'] ?? '') || 0;
    const name = a['concept:name'] ?? 'unknown';
    const lifecycle = a['lifecycle:transition'] ?? '';
    const origin = a['EventOrigin'] ?? '';
    const resource = a['org:resource'];
    if (resource) resources.set(resource, (resources.get(resource) ?? 0) + 1);
    const features: Record<string, Scalar> = { speaker: 'action', name, lifecycle, origin };
    const slots: Record<string, Scalar> = {};
    if (a['Action']) slots.action = a['Action'];
    if (a['OfferedAmount']) slots.offered_amount = Number(a['OfferedAmount']);
    if (a['NumberOfTerms']) slots.number_of_terms = Number(a['NumberOfTerms']);
    if (a['Accepted']) slots.accepted = a['Accepted'] === 'true';
    if (a['Selected']) slots.selected = a['Selected'] === 'true';
    events.push({ at, features, slots, raw: { file, path: `/trace/${index}/event/${j}` } });
    if (OUTCOMES[name] && lifecycle === 'complete') {
      outcome = OUTCOMES[name];
      outcomeAt = at;
    }
    j++;
  }
  const startedAt = events[0]?.at ?? 0;
  const agent = [...resources].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]))[0]?.[0];
  const facts: Record<string, Scalar> = {};
  if (head['ApplicationType']) facts['application.type'] = head['ApplicationType'];
  if (head['LoanGoal']) facts['application.goal'] = head['LoanGoal'];
  if (head['RequestedAmount']) facts['application.requested_amount'] = Number(head['RequestedAmount']);
  const out: RawInteraction = {
    id,
    corpus: 'bpic2017',
    actor: agent ? { operatorId: BPIC_OPERATOR, agentId: agent } : { operatorId: BPIC_OPERATOR },
    startedAt,
    events,
    facts,
    hints: { expected_episodes: 1 },
  };
  if (outcome) out.outcome = { label: outcome, at: outcomeAt, lagMs: outcomeAt - startedAt, source: 'in_band' };
  return out;
}

/** Stream a gzipped (or plain) XES file, yielding each <trace>…</trace> block. */
export async function* traces(file: string): AsyncGenerator<string> {
  const raw = createReadStream(file);
  let stream: NodeJS.ReadableStream = raw;
  if (file.endsWith('.gz')) {
    const gunzip = createGunzip();
    // pipe() does not forward the source's errors: a missing file must reject
    // the read, not crash the process with an unhandled 'error'.
    raw.on('error', (e) => gunzip.destroy(e));
    stream = raw.pipe(gunzip);
  }
  let buf = '';
  for await (const chunk of stream) {
    buf += (chunk as Buffer).toString('utf8');
    let end: number;
    while ((end = buf.indexOf('</trace>')) >= 0) {
      const start = buf.indexOf('<trace>');
      if (start >= 0 && start < end) yield buf.slice(start, end + '</trace>'.length);
      buf = buf.slice(end + '</trace>'.length);
    }
    // keep the tail small: nothing before the last '<trace>' is needed once the block before it is out
    const last = buf.lastIndexOf('<trace>');
    if (last > 0) buf = buf.slice(last);
    else if (last < 0 && buf.length > 1 << 20) buf = buf.slice(-1024);
  }
}

export const bpicAdapter: Adapter = {
  name: 'bpic',
  async read(source: string): Promise<RawInteraction[]> {
    const out: RawInteraction[] = [];
    let i = 0;
    for await (const t of traces(source)) out.push(traceToRaw(t, i++, source));
    return out;
  },
};
