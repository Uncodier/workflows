import { shouldSyncSocialComments } from '../src/temporal/workflows/helpers/socialCommentCadence';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.parse('2026-09-29T01:20:00.000Z');
const ago = (elapsedMs: number) => new Date(now - elapsedMs).toISOString();

describe('initial social comment ingestion', () => {
  it('syncs a September 4 post imported September 29 at 01:20 immediately', () => {
    expect(shouldSyncSocialComments('2026-09-04T12:00:00Z', null, now)).toBe(true);
  });

  it.each([undefined, null, '', 'not-a-date'])('always syncs without a valid success time (%j)', (lastSuccess) => {
    for (const publishedAt of [ago(HOUR), ago(5 * DAY), ago(25 * DAY), ago(365 * DAY), undefined, 'invalid']) {
      expect(shouldSyncSocialComments(publishedAt, lastSuccess, now)).toBe(true);
    }
  });

  it('does not abandon a never-successful post older than 30 days', () => {
    expect(shouldSyncSocialComments(ago(31 * DAY), undefined, now)).toBe(true);
    expect(shouldSyncSocialComments(ago(31 * DAY), undefined, now + DAY)).toBe(true);
  });
});

describe('elapsed-time refresh cadence', () => {
  it.each([
    ['under one day', DAY - 1, 5 * MINUTE],
    ['exactly one day', DAY, 5 * MINUTE],
    ['just over one day', DAY + 1, 6 * HOUR],
    ['exactly seven days', 7 * DAY, 6 * HOUR],
    ['just over seven days', 7 * DAY + 1, DAY],
    ['exactly thirty days', 30 * DAY, DAY],
  ])('%s refreshes at its interval and not before it', (_label, ageMs, intervalMs) => {
    const publishedAt = ago(ageMs);
    expect(shouldSyncSocialComments(publishedAt, ago(intervalMs - 1), now)).toBe(false);
    expect(shouldSyncSocialComments(publishedAt, ago(intervalMs), now)).toBe(true);
    expect(shouldSyncSocialComments(publishedAt, ago(intervalMs + 1), now)).toBe(true);
  });

  it('catches up at 01:20 after missing midnight rather than waiting another day', () => {
    expect(shouldSyncSocialComments('2026-09-04T12:00:00Z', '2026-09-28T00:00:00Z', now)).toBe(true);
  });

  it('does not repeat a daily sync merely because another wall-clock bucket begins', () => {
    const nextMidnight = Date.parse('2026-09-30T00:00:00Z');
    expect(shouldSyncSocialComments('2026-09-04T12:00:00Z', ago(0), nextMidnight)).toBe(false);
  });

  it('catches up a six-hour interval outside the scheduled hour', () => {
    expect(shouldSyncSocialComments(ago(3 * DAY), ago(7 * HOUR), now)).toBe(true);
  });

  it('stops all refreshes after a successful ingestion once older than 30 days', () => {
    expect(shouldSyncSocialComments(ago(30 * DAY + 1), ago(2 * DAY), now)).toBe(false);
    expect(shouldSyncSocialComments(ago(365 * DAY), ago(100 * DAY), now)).toBe(false);
  });

  it.each([undefined, null, '', 'invalid'])('uses six hours for unknown/invalid publication (%j)', (publishedAt) => {
    expect(shouldSyncSocialComments(publishedAt, ago(6 * HOUR - 1), now)).toBe(false);
    expect(shouldSyncSocialComments(publishedAt, ago(6 * HOUR), now)).toBe(true);
  });

  it('does not refresh a future success timestamp or a just-completed ingestion', () => {
    expect(shouldSyncSocialComments(ago(HOUR), ago(-HOUR), now)).toBe(false);
    expect(shouldSyncSocialComments(ago(HOUR), ago(0), now)).toBe(false);
  });

  it('handles future publication dates as young posts', () => {
    expect(shouldSyncSocialComments(ago(-DAY), ago(5 * MINUTE), now)).toBe(true);
    expect(shouldSyncSocialComments(ago(-DAY), ago(5 * MINUTE - 1), now)).toBe(false);
  });

  it('uses only the supplied clock and rejects invalid refresh clocks', () => {
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Ambient clock used'); });
    try {
      expect(shouldSyncSocialComments(ago(HOUR), ago(5 * MINUTE), now)).toBe(true);
      expect(shouldSyncSocialComments(ago(HOUR), ago(5 * MINUTE), NaN)).toBe(false);
      expect(shouldSyncSocialComments(ago(HOUR), ago(5 * MINUTE), Infinity)).toBe(false);
      expect(shouldSyncSocialComments(ago(365 * DAY), null, NaN)).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});