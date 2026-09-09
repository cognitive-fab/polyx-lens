// Episodes (§4.3). A session is not a task: one measured transcript held 5,863
// records over two days, and mining across that boundary asks what a fortnight
// of unrelated work has in common.
//
// The run of records between one user prompt and the next is the only task
// boundary today's journal offers. It is a poor one — a prompt can interrupt
// work rather than start it — and §6 is how a better one arrives.
//
// Episodes shorter than three tool calls are dropped. Two calls cannot show a
// guard preceding a consequential step, so they can only add noise to a
// denominator.
export const MIN_CALLS = 3;

/**
 * Group an event stream into episodes.
 *
 * One episode is held at a time, never a transcript. The prompt's text rides
 * along as `intent`: unindexed in v0, but it is what makes a proposal nameable
 * (§9.2) and what v1 needs to cluster shapes by what they were FOR rather than
 * by which commands they used.
 */
export async function* episodes(eventStream, { minCalls = MIN_CALLS } = {}) {
  let index = 0;
  let intent = '';
  let at = 0;
  let records = [];

  const flush = function* () {
    if (records.length >= minCalls) {
      for (const r of records) r.episode = index;
      yield { index, intent, at, records };
      index++;
    }
    records = [];
  };

  for await (const e of eventStream) {
    if (e.kind === 'boundary') {
      // A session ended. Whatever is open belongs to it and to nothing after.
      yield* flush();
      intent = '';
      at = 0;
      continue;
    }
    if (e.kind === 'prompt') {
      yield* flush();
      intent = e.intent;
      at = e.at;
      continue;
    }
    records.push(e.record);
  }
  yield* flush();
}

/** The records of every kept episode, flattened — what the miner consumes. */
export async function* records(eventStream, opts) {
  for await (const ep of episodes(eventStream, opts)) yield* ep.records;
}
