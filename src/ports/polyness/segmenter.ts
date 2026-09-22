// polyness behind the segmentation port. Nothing outside ports/polyness/
// imports a polyness symbol (TS §1, rule 1).
//
// polyness segments a journal at USER PROMPTS: the run of records between one
// prompt and the next is the task boundary. The dialogue analogue is a
// classified customer intent — a new intent starts a new episode. Events
// before the first intent (the agent's greeting) form their own episode;
// polyness's default minimum of three records is lowered to one, because a
// two-turn episode in a chat is not noise the way a two-call episode in a
// shell is.
//
// polyness treats the prompt as a boundary, not a record. polyx never drops
// an event, so the intent event is assigned to the episode it opens.
//
// Modification of upstream: none. The upstream module is called as published.
import { episodes } from '#polyness/episodes.mjs';
import { UNKNOWN_TYPE, type EpisodeId, type Event } from '../../record.ts';
import type { Segmenter } from '../segmentation.ts';

interface Rec {
  seq: number;
}

export const polynessSegmenter: Segmenter = {
  name: 'polyness',
  async segment(events: Event[]): Promise<Map<number, EpisodeId>> {
    const stream = events.map((e) =>
      e.kind === 'customer_intent' && e.type !== UNKNOWN_TYPE
        ? { kind: 'prompt', intent: e.type, at: e.at, seq: e.seq }
        : { kind: 'record', record: { seq: e.seq } as Rec },
    );
    const out = new Map<number, EpisodeId>();
    const starts: Array<{ firstSeq: number; id: string }> = [];
    for await (const ep of episodes<Rec>(stream, { minCalls: 1 })) {
      const id = String(ep.index);
      for (const r of ep.records) out.set(r.seq, id);
      const first = ep.records[0];
      if (first) starts.push({ firstSeq: first.seq, id });
    }
    // Intent events: the episode whose first record follows them; failing
    // that (a trailing intent with nothing after it) the last episode.
    for (const e of events) {
      if (out.has(e.seq)) continue;
      const next = starts.find((s) => s.firstSeq > e.seq);
      out.set(e.seq, next?.id ?? starts[starts.length - 1]?.id ?? '0');
    }
    return out;
  },
};
