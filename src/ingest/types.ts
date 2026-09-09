// What an adapter produces. It is NOT the canonical record: the alphabet has
// not been applied, nothing is redacted, and no episode has been assigned.
// Adapters know their source format and nothing else — typing, redaction and
// segmentation happen downstream so that every corpus gets the same treatment
// and every figure can be traced to one alphabet version.
import type { ActorRef, EventResult, Outcome, RawRef, Scalar } from '../record.ts';

export interface RawEvent {
  at: number;
  /** What the alphabet matches on: `{ speaker: 'action', button: 'issue-refund' }`. */
  features: Record<string, Scalar>;
  /** Structured values carried by the event. Unredacted here; redacted before persistence. */
  slots: Record<string, Scalar>;
  result?: EventResult;
  raw: RawRef;
}

export interface RawInteraction {
  id: string;
  corpus: string;
  actor: ActorRef;
  startedAt: number;
  events: RawEvent[];
  /** An outcome the source states directly. The alphabet derives one when absent. */
  outcome?: Outcome;
  /** Customer / account state known at the start of the contact. Redacted downstream; mined as data conditions. */
  facts?: Record<string, Scalar>;
  /** Source-level labels worth keeping for evaluation — e.g. ABCD's subflow. Never mined. */
  hints?: Record<string, Scalar>;
}

export interface Adapter {
  readonly name: string;
  /** Pure: source files in, raw interactions out. */
  read(source: string): Promise<RawInteraction[]>;
  /** What produced a generated corpus — backbone, simulator, benchmark commit — for the manifest. */
  meta?(source: string): Record<string, string>;
}
