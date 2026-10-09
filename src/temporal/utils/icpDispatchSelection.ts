import { isIcpOrganizationIdentityError } from './icpIdentityReview';

/** A list candidate with a snapshot of its site's shared daily dispatch budget. */
export interface IcpDispatchCandidate {
  siteId: string;
  userId: string;
  icpId: string;
  /** null means unknown, not exhausted. A checkpoint does not override zero. */
  remainingTargets: number | null;
  hasCheckpoint: boolean;
  lastSiteDispatchAt: string | null;
  lastListDispatchAt: string | null;
  dailyFound: number;
  dailyReservedMatches: number;
  dailyCandidateReservations: number;
  targetLeads: number;
  nextEligibleAt?: string | null;
  listNextEligibleAt?: string | null;
  /** Whether this site already has an active dispatch run (not an enabled flag). */
  active: boolean;
}

export interface IcpDispatchSelectionOptions {
  now: Date;
  limit: number;
  /** Defaults to 3000; each site's candidate cap is also bounded by targetLeads * 10. */
  dailyCandidateLimit?: number;
}

interface RankedCandidate<T extends IcpDispatchCandidate> {
  candidate: T;
  lastSiteDispatch: number;
  lastListDispatch: number;
  servedRatio: number;
  requiredLoad: number;
}

const defaultDailyCandidateLimit = 3000;
const baseCooldownSeconds = 5 * 60;
const longCooldownSeconds = 6 * 60 * 60;

function nonemptyId(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function dispatchTime(value: string | null): number {
  if (value === null) return Number.NEGATIVE_INFINITY;
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

function cooldownElapsed(value: string | null | undefined, now: number): boolean {
  if (value === null || value === undefined) return true;
  const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  // Invalid supplied cooldowns fail closed rather than looking like missing state.
  return Number.isFinite(timestamp) && timestamp <= now;
}

function compare<T extends number | string>(left: T, right: T): number {
  // Unlike subtraction, this also compares two null/oldest (-Infinity) timestamps.
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareLists<T extends IcpDispatchCandidate>(
  left: RankedCandidate<T>,
  right: RankedCandidate<T>,
): number {
  // Rotate lists by service age; checkpoint priority on equal age must not let
  // a perpetually pending checkpoint starve every other list of the same site.
  return compare(left.lastListDispatch, right.lastListDispatch)
    || compare(Number(right.candidate.hasCheckpoint), Number(left.candidate.hasCheckpoint))
    || compare(right.requiredLoad, left.requiredLoad)
    || compare(left.candidate.icpId, right.candidate.icpId)
    || compare(left.candidate.userId, right.candidate.userId);
}

function compareSites<T extends IcpDispatchCandidate>(
  left: RankedCandidate<T>,
  right: RankedCandidate<T>,
): number {
  return compare(left.lastSiteDispatch, right.lastSiteDispatch)
    || compare(Number(right.candidate.hasCheckpoint), Number(left.candidate.hasCheckpoint))
    || compare(left.servedRatio, right.servedRatio)
    || compare(right.requiredLoad, left.requiredLoad)
    || compare(left.candidate.siteId, right.candidate.siteId);
}

/**
 * Ranks caller-supplied, already-scoped lists without mutating candidates or quotas.
 * Returns the original candidate objects, retaining any additional planner data.
 * Invalid counters, timestamps or options fail closed. Identifiers need not be UUIDs.
 * Lists rotate oldest-first with checkpoint priority on equal service age; sites
 * rotate oldest-first, then prefer checkpoints, lower served ratio and more load.
 *
 * Site snapshots must be shared by every candidate of that site. This is a pure
 * selection, not a reservation: the caller must atomically recheck budgets/active
 * runs and persist both dispatch timestamps when reserving the selected work.
 */
export function selectIcpDispatchCandidates<T extends IcpDispatchCandidate>(
  candidates: readonly T[],
  options: IcpDispatchSelectionOptions,
): T[] {
  const now = options.now.getTime();
  const dailyCandidateLimit = options.dailyCandidateLimit ?? defaultDailyCandidateLimit;
  if (!Number.isFinite(now)
    || !Number.isSafeInteger(options.limit) || options.limit <= 0
    || !validCount(dailyCandidateLimit) || dailyCandidateLimit === 0) {
    return [];
  }

  const bestBySite = new Map<string, RankedCandidate<T>>();
  for (const candidate of candidates) {
    if (!nonemptyId(candidate.siteId) || !nonemptyId(candidate.userId) || !nonemptyId(candidate.icpId)
      || candidate.active !== false || typeof candidate.hasCheckpoint !== 'boolean'
      || !Number.isInteger(candidate.targetLeads) || candidate.targetLeads < 1 || candidate.targetLeads > 3000
      || !validCount(candidate.dailyFound) || !validCount(candidate.dailyReservedMatches)
      || !validCount(candidate.dailyCandidateReservations)
      || (candidate.remainingTargets !== null
        && (!validCount(candidate.remainingTargets) || candidate.remainingTargets === 0))
      || !cooldownElapsed(candidate.nextEligibleAt, now)
      || !cooldownElapsed(candidate.listNextEligibleAt, now)) {
      continue;
    }

    const dailyServed = candidate.dailyFound + candidate.dailyReservedMatches;
    const dailyRemaining = candidate.targetLeads - dailyServed;
    const candidateRemaining = Math.min(dailyCandidateLimit, candidate.targetLeads * 10)
      - candidate.dailyCandidateReservations;
    const lastSiteDispatch = dispatchTime(candidate.lastSiteDispatchAt);
    const lastListDispatch = dispatchTime(candidate.lastListDispatchAt);
    if (dailyRemaining <= 0 || candidateRemaining <= 0
      || Number.isNaN(lastSiteDispatch) || Number.isNaN(lastListDispatch)) {
      continue;
    }

    const ranked: RankedCandidate<T> = {
      candidate,
      lastSiteDispatch,
      lastListDispatch,
      servedRatio: dailyServed / candidate.targetLeads,
      requiredLoad: Math.min(candidate.remainingTargets ?? Number.POSITIVE_INFINITY, dailyRemaining),
    };
    const previous = bestBySite.get(candidate.siteId);
    if (!previous || compareLists(ranked, previous) < 0) {
      bestBySite.set(candidate.siteId, ranked);
    }
  }

  return [...bestBySite.values()]
    .sort(compareSites)
    .slice(0, options.limit)
    .map(({ candidate }) => candidate);
}

/**
 * Returns a base cooldown in seconds, not an exponentially increased duration.
 * The optional failures argument is accepted for callers that have a failure
 * count, but SQL/API owns the 5-minute-to-6-hour backoff to avoid applying it twice.
 * Identity-only diagnostics return zero: their durable reviews need resolution,
 * not a time delay. The dispatcher still runs on its normal five-minute schedule.
 */
export function classifyIcpDispatchCooldown(errors: readonly string[], failures?: number): number {
  void failures;
  const retryableErrors = errors.filter(error => !isIcpOrganizationIdentityError(error));
  if (errors.length > 0 && retryableErrors.length === 0) return 0;
  const needsLongCooldown = retryableErrors.some(error => {
    if (isIcpCreditFailure(error)) return true;
    const normalized = error.toLowerCase().replace(/[_-]+/g, ' ');
    return /\bsubmission\s*(?:(?:status|outcome)\s+(?:is\s+)?)?unknown\b/.test(normalized)
      || /\bunknown\s*submission\b/.test(normalized)
      || /\bambiguous\s+(?:initial\s+)?submission\b/.test(normalized);
  });
  return needsLongCooldown ? longCooldownSeconds : baseCooldownSeconds;
}

/** Only credit exhaustion should trigger the site-owner email, not other provider errors. */
export function isIcpCreditFailure(error: string): boolean {
  const normalized = error.toLowerCase().replace(/[_-]+/g, ' ');
  return /\b(?:402|http\s*402|insufficient\s*(?:funds|credits?))\b/.test(normalized)
    || /\b(?:no|not enough|out of)\s+(?:available\s+)?(?:verification\s+)?credits?\b/.test(normalized)
    || /\bcredits?\s+(?:balance\s+)?(?:exhausted|depleted|insufficient)\b/.test(normalized);
}