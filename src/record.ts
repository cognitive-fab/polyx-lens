// The canonical record (TS §3). Everything normalises to this before anything
// else runs. It borrows the Agent Data Protocol's action/observation split and
// adds what ADP has no reason to carry: consequence and outcome.

export type InteractionId = string;
export type EpisodeId = string;
export type Scalar = string | number | boolean | null;

export interface Interaction {
  id: InteractionId;
  corpus: string; // 'abcd' | 'tau2:retail' | 'bpic2017' | 'synthetic' | ...
  actor: ActorRef; // who handled it — for provenance levels
  startedAt: number;
  events: Event[];
  outcome?: Outcome; // known later; absent is normal
  /**
   * Customer / account state known at the start of the contact — what the
   * agent had on screen: 'customer.member_level', 'order.payment_method'.
   * Redacted like slots. The fact base data conditions are mined over and
   * the advisor is queried with (rev. 2).
   */
  facts?: Record<string, Scalar>;
}

export interface ActorRef {
  agentId?: string; // provenance level 1
  teamId?: string; //                  2
  operatorId: string; //               3  (tenant / merchant / bank)
}

export type EventKind =
  | 'customer_intent' // a classified customer turn
  | 'customer_utterance' // a customer turn no classifier ruled on
  | 'agent_utterance' // an agent turn carrying no action
  | 'action' // the agent did something
  | 'system' // the environment responded
  | 'unknown'; // the adapter could not classify — counted, never dropped

export const EVENT_KINDS: readonly EventKind[] = [
  'customer_intent',
  'customer_utterance',
  'agent_utterance',
  'action',
  'system',
  'unknown',
];

export type EventResult = 'ok' | 'failed' | 'refused';

export interface Event {
  seq: number; // 0-based within the interaction
  at: number;
  episode: EpisodeId; // assigned by the segmentation port
  kind: EventKind;
  type: string; // from the alphabet, e.g. 'action:issue_refund'
  slots: Record<string, Scalar>; // redacted at ingestion
  result?: EventResult;
  raw: RawRef; // pointer back to source — never the source itself
}

export interface Outcome {
  label: string; // 'resolved' | 'escalated' | 'complaint' | ...
  at: number;
  lagMs: number; // how late it arrived — matters for scheduling
  source: 'in_band' | 'external';
}

/** JSON-pointer-ish. `--show` resolves it; nothing else reads it. */
export interface RawRef {
  file: string;
  path: string;
}

/** The type an event carries when the alphabet could not place it. */
export const UNKNOWN_TYPE = 'unknown';
/** The episode an event carries before the segmentation port has run. */
export const UNSEGMENTED: EpisodeId = 'unsegmented';

// ---------------------------------------------------------------------------
// Runtime validation. Every adapter's fixture test asserts against this, and
// the store refuses anything that does not pass it.

export class RecordError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'RecordError';
    this.path = path;
  }
}

const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function need(cond: unknown, path: string, msg: string): asserts cond {
  if (!cond) throw new RecordError(path, msg);
}

export function validateRawRef(v: unknown, path: string): RawRef {
  need(isObject(v), path, 'raw must be an object');
  need(typeof v.file === 'string' && v.file.length > 0, `${path}.file`, 'must be a non-empty string');
  need(typeof v.path === 'string', `${path}.path`, 'must be a string');
  return { file: v.file, path: v.path };
}

export function validateEvent(v: unknown, path: string): Event {
  need(isObject(v), path, 'event must be an object');
  need(Number.isInteger(v.seq) && (v.seq as number) >= 0, `${path}.seq`, 'must be a non-negative integer');
  need(typeof v.at === 'number' && Number.isFinite(v.at), `${path}.at`, 'must be a finite number');
  need(typeof v.episode === 'string' && v.episode.length > 0, `${path}.episode`, 'must be a non-empty string');
  need(
    typeof v.kind === 'string' && (EVENT_KINDS as readonly string[]).includes(v.kind),
    `${path}.kind`,
    `must be one of ${EVENT_KINDS.join(', ')}`,
  );
  need(typeof v.type === 'string' && v.type.length > 0, `${path}.type`, 'must be a non-empty string');
  need(isObject(v.slots), `${path}.slots`, 'must be an object');
  for (const [k, s] of Object.entries(v.slots)) {
    need(isScalar(s), `${path}.slots.${k}`, 'slot values must be scalar');
  }
  if (v.result !== undefined) {
    need(
      v.result === 'ok' || v.result === 'failed' || v.result === 'refused',
      `${path}.result`,
      'must be ok | failed | refused',
    );
  }
  const raw = validateRawRef(v.raw, `${path}.raw`);
  const out: Event = {
    seq: v.seq as number,
    at: v.at as number,
    episode: v.episode as string,
    kind: v.kind as EventKind,
    type: v.type as string,
    slots: { ...(v.slots as Record<string, Scalar>) },
    raw,
  };
  if (v.result !== undefined) out.result = v.result as EventResult;
  return out;
}

export function validateOutcome(v: unknown, path: string): Outcome {
  need(isObject(v), path, 'outcome must be an object');
  need(typeof v.label === 'string' && v.label.length > 0, `${path}.label`, 'must be a non-empty string');
  need(typeof v.at === 'number' && Number.isFinite(v.at), `${path}.at`, 'must be a finite number');
  need(typeof v.lagMs === 'number' && Number.isFinite(v.lagMs), `${path}.lagMs`, 'must be a finite number');
  need(v.source === 'in_band' || v.source === 'external', `${path}.source`, 'must be in_band | external');
  return { label: v.label, at: v.at, lagMs: v.lagMs, source: v.source };
}

export function validateInteraction(v: unknown, path = 'interaction'): Interaction {
  need(isObject(v), path, 'interaction must be an object');
  need(typeof v.id === 'string' && v.id.length > 0, `${path}.id`, 'must be a non-empty string');
  need(typeof v.corpus === 'string' && v.corpus.length > 0, `${path}.corpus`, 'must be a non-empty string');
  need(isObject(v.actor), `${path}.actor`, 'must be an object');
  need(
    typeof v.actor.operatorId === 'string' && v.actor.operatorId.length > 0,
    `${path}.actor.operatorId`,
    'must be a non-empty string',
  );
  for (const k of ['agentId', 'teamId'] as const) {
    if (v.actor[k] !== undefined) need(typeof v.actor[k] === 'string', `${path}.actor.${k}`, 'must be a string');
  }
  need(typeof v.startedAt === 'number' && Number.isFinite(v.startedAt), `${path}.startedAt`, 'must be a finite number');
  need(Array.isArray(v.events), `${path}.events`, 'must be an array');
  const events = v.events.map((e, i) => validateEvent(e, `${path}.events[${i}]`));
  events.forEach((e, i) => need(e.seq === i, `${path}.events[${i}].seq`, `must equal its index (${i})`));
  const actor: ActorRef = { operatorId: v.actor.operatorId };
  if (typeof v.actor.agentId === 'string') actor.agentId = v.actor.agentId;
  if (typeof v.actor.teamId === 'string') actor.teamId = v.actor.teamId;
  const out: Interaction = { id: v.id, corpus: v.corpus, actor, startedAt: v.startedAt, events };
  if (v.outcome !== undefined) out.outcome = validateOutcome(v.outcome, `${path}.outcome`);
  if (v.facts !== undefined) {
    need(isObject(v.facts), `${path}.facts`, 'must be an object');
    for (const [k, s] of Object.entries(v.facts)) need(isScalar(s), `${path}.facts.${k}`, 'fact values must be scalar');
    out.facts = { ...(v.facts as Record<string, Scalar>) };
  }
  return out;
}

/** The provenance level an actor can be evaluated at, most specific first. */
export function actorLevels(actor: ActorRef): Array<{ level: 'agent' | 'team' | 'operator'; id: string }> {
  const out: Array<{ level: 'agent' | 'team' | 'operator'; id: string }> = [];
  if (actor.agentId) out.push({ level: 'agent', id: actor.agentId });
  if (actor.teamId) out.push({ level: 'team', id: actor.teamId });
  out.push({ level: 'operator', id: actor.operatorId });
  return out;
}
