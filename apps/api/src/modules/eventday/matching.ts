/**
 * Match decision: pure functions, no database, no provider. The provider only says how similar faces are (0..1);
 * whether that is enough is application policy and lives here, configured through FACE_* settings.
 *
 * The input is already event-scoped: the service has mapped provider references to ACTIVE profiles, to players
 * registered for THIS event. Candidates from other events never reach this function, so they can influence
 * nothing (and the result reveals nothing about them).
 */
export interface FaceScanPolicy {
  /** At or above this a single, clearly-leading candidate is a MATCH. */
  matchThreshold: number;
  /** From here up to matchThreshold a candidate needs a person to look (REVIEW_REQUIRED). Below: ignored. */
  reviewThreshold: number;
  /** The leader must beat the runner-up by at least this much, or the result is ambiguous. */
  ambiguityMargin: number;
  /** Deadline for the provider's identify() call. */
  timeoutMs: number;
}

/** Provisional until calibrated against the chosen provider (see docs/architecture.md). */
export const DEFAULT_FACE_SCAN_POLICY: FaceScanPolicy = {
  matchThreshold: 0.9,
  reviewThreshold: 0.75,
  ambiguityMargin: 0.05,
  timeoutMs: 5_000,
};

export type ReviewReason =
  | 'LOW_CONFIDENCE'
  | 'MULTIPLE_STRONG_CANDIDATES'
  | 'AMBIGUOUS_MATCH'
  /** A clear match, but the registration is not eligible right now (see the eligibility reasons). */
  | 'NOT_ELIGIBLE';

export type MatchDecision<C> =
  | { kind: 'NO_MATCH' }
  | { kind: 'REVIEW_REQUIRED'; reason: Exclude<ReviewReason, 'NOT_ELIGIBLE'>; candidates: C[] }
  /** One clear leader. Still has to pass eligibility before it is reported as a MATCH. */
  | { kind: 'CANDIDATE'; top: C };

/** How many people a REVIEW_REQUIRED answer may name. */
export const MAX_REVIEW_CANDIDATES = 3;

/** Float noise must not decide a boundary case (0.95 - 0.90 is 0.04999...). */
const EPSILON = 1e-9;

export function decideMatch<C extends { similarity: number; registrationId: string }>(
  candidates: readonly C[],
  policy: FaceScanPolicy,
): MatchDecision<C> {
  // Defensive: a score outside 0..1 (or NaN) is a provider/adapter bug and is never trusted. One entry per
  // registration, best score.
  const best = new Map<string, C>();
  for (const c of candidates) {
    if (!Number.isFinite(c.similarity) || c.similarity < 0 || c.similarity > 1) continue;
    const seen = best.get(c.registrationId);
    if (!seen || c.similarity > seen.similarity) best.set(c.registrationId, c);
  }
  const sorted = [...best.values()].sort((a, b) => b.similarity - a.similarity);

  const inBand = sorted.filter((c) => c.similarity >= policy.reviewThreshold - EPSILON);
  if (inBand.length === 0) return { kind: 'NO_MATCH' };

  const strong = inBand.filter((c) => c.similarity >= policy.matchThreshold - EPSILON);
  if (strong.length === 0) {
    return {
      kind: 'REVIEW_REQUIRED',
      reason: 'LOW_CONFIDENCE',
      candidates: inBand.slice(0, MAX_REVIEW_CANDIDATES),
    };
  }
  if (strong.length > 1) {
    return {
      kind: 'REVIEW_REQUIRED',
      reason: 'MULTIPLE_STRONG_CANDIDATES',
      candidates: strong.slice(0, MAX_REVIEW_CANDIDATES),
    };
  }

  const [top, runnerUp] = sorted as [C, C | undefined];
  // The runner-up counts even below the review band: the margin is about how clearly the leader stands out.
  if (runnerUp && top.similarity - runnerUp.similarity < policy.ambiguityMargin - EPSILON) {
    return { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS_MATCH', candidates: [top, runnerUp] };
  }
  return { kind: 'CANDIDATE', top };
}
