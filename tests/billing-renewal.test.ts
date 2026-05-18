import { countMissedRenewalCycles } from '../src/temporal/activities/billingActivities';

describe('countMissedRenewalCycles', () => {
  it('counts one missed cycle when renewal day passed this month', () => {
    const start = new Date('2026-03-24T22:50:25Z');
    const today = new Date('2026-05-18T12:00:00Z');

    expect(countMissedRenewalCycles(start, null, today)).toBe(1);
  });

  it('returns zero when no renewal dates have passed yet', () => {
    const start = new Date('2026-05-10T00:00:00Z');
    const today = new Date('2026-05-18T12:00:00Z');

    expect(countMissedRenewalCycles(start, null, today)).toBe(0);
  });

  it('returns zero when last renewal covers the latest cycle', () => {
    const start = new Date('2025-01-15T00:00:00Z');
    const lastRenewal = new Date('2026-04-15T00:00:00Z');
    const today = new Date('2026-05-10T12:00:00Z');

    expect(countMissedRenewalCycles(start, lastRenewal, today)).toBe(0);
  });

  it('handles end-of-month anchor days', () => {
    const start = new Date('2025-01-31T00:00:00Z');
    const today = new Date('2026-03-31T12:00:00Z');

    expect(countMissedRenewalCycles(start, null, today)).toBeGreaterThan(0);
  });
});
