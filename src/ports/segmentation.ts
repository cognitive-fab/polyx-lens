// The segmentation port (TS §6). polyx defines the interface; polyness is one
// implementation behind it, and `NullSegmenter` is another from day one — a
// port with one implementation is a wish.
//
// A segmenter returns LOCAL episode ids ('0', '1', …) keyed by event seq. The
// pipeline composes the global id as `<interactionId>#<local>`, so no
// implementation needs to know how interactions are named.
import type { Event, EpisodeId, Scalar } from '../record.ts';

export interface SegmentContext {
  interactionId: string;
  /** Source-level labels an adapter chose to keep — e.g. ABCD's subflow. */
  hints?: Record<string, Scalar>;
}

export interface Segmenter {
  readonly name: string;
  segment(events: Event[], context: SegmentContext): Map<number, EpisodeId> | Promise<Map<number, EpisodeId>>;
}

/** One episode per interaction. The reference implementation and the fallback. */
export const nullSegmenter: Segmenter = {
  name: 'null',
  segment(events) {
    return new Map(events.map((e) => [e.seq, '0']));
  },
};

export function episodeId(interactionId: string, local: EpisodeId): EpisodeId {
  return `${interactionId}#${local}`;
}
