import { createHash } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stable per-site slots spread daily mining across all 24 hours, not business openings. */
export function nextDistributedIcpRun(siteId: string, now = new Date()): Date {
  if (!siteId || !Number.isFinite(now.getTime())) throw new Error('Invalid ICP scheduling input');
  const secondOfDay = createHash('sha256').update(`icp-mining:${siteId}`).digest().readUInt32BE(0) % 86400;
  const dayStart = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  let target = dayStart + secondOfDay * 1000;
  if (target < now.getTime()) target += DAY_MS;
  return new Date(target);
}