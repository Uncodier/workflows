const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Use elapsed time since durable success, never a wall-clock polling bucket. */
export function shouldSyncSocialComments(
  publishedAt: string | null | undefined,
  lastSuccessAt: string | null | undefined,
  nowMs: number
): boolean {
  const lastSuccessMs = lastSuccessAt ? Date.parse(lastSuccessAt) : NaN;
  // Initial ingestion is required even for newly imported historical posts.
  if (!Number.isFinite(lastSuccessMs)) return true;
  if (!Number.isFinite(nowMs)) return false;

  const publishedMs = publishedAt ? Date.parse(publishedAt) : NaN;
  let intervalMs = 6 * HOUR_MS;
  if (Number.isFinite(publishedMs)) {
    const ageMs = nowMs - publishedMs;
    if (ageMs > 30 * DAY_MS) return false;
    if (ageMs <= DAY_MS) intervalMs = 5 * MINUTE_MS;
    else if (ageMs > 7 * DAY_MS) intervalMs = DAY_MS;
  }
  return nowMs - lastSuccessMs >= intervalMs;
}