// polyness ships plain .mjs with no types. These declarations cover exactly
// the surface the adapters use and nothing more; anything else polyness
// exports is not part of the port.
declare module '#polyness/episodes.mjs' {
  export const MIN_CALLS: number;
  export interface PolynessEpisode<R = unknown> {
    index: number;
    intent: string;
    at: number;
    records: R[];
  }
  export function episodes<R = unknown>(
    eventStream: Iterable<unknown> | AsyncIterable<unknown>,
    opts?: { minCalls?: number },
  ): AsyncGenerator<PolynessEpisode<R>>;
}

declare module '#polyness/subjects.mjs' {
  export const CONSEQUENTIAL: Set<string>;
  export interface PolynessInstance<R = unknown> {
    record: R;
    episode: unknown;
    episodeKey: string;
    all: R[];
    readonly before: R[];
    readonly after: R[];
    readonly sessionBefore: R[];
  }
  export function subjects<R = unknown>(
    records: R[],
    opts?: { thresholds?: { minInstances: number }; consequential?: Set<string> },
  ): Array<{ kind: string; instances: PolynessInstance<R>[]; count: number }>;
}

declare module '#polyness/provenance.mjs' {
  export const OWN: 'own';
  export const BORROWED: 'borrowed';
  export const NEITHER: 'neither';
  export function classify(
    rule: { support: { holds: number; of: number } },
    elsewhere?: Array<{ project: string; holds: number; of: number }>,
    opts?: { thresholds?: { ownSupport: number; borrowedProjects: number } },
  ): 'own' | 'borrowed' | 'neither';
}
