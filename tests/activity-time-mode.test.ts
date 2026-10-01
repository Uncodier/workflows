import { resolveActivityStartTime } from '../src/temporal/utils/activityStartTime';
import { activityStartTimes, nextActivityRun } from '../src/temporal/utils/activityScheduling';
import { resolveDailyStandUpConfiguration } from '../src/temporal/utils/dailyStandUpConfiguration';
import { nextDailyStandUpRun } from '../src/temporal/utils/dailyStandUpScheduling';
import { nextConfiguredOutreachRun, resolveOutreachConfiguration } from '../src/temporal/utils/outreachConfiguration';

const standup = 'daily_resume_and_stand_up';
const keys = [standup, 'leads_follow_up', 'leads_initial_cold_outreach'] as const;
const now = new Date('2026-09-29T08:00:00Z');
const settings = (key: string, timing: Record<string, unknown> = {}) => ({
  channels: { email: { status: 'synced', email: 'sender@example.org' } },
  business_hours: [{ timezone: 'UTC', days: {
    tuesday: { enabled: true, start: '10:30' }, friday: { enabled: true, start: '08:15' },
  } }],
  activities: { [key]: { status: 'active', weekdays: [2, 5], all_segments: true,
    channel_accounts: { email: ['email'] }, ...timing } },
});
const resolve = (input: any, key: typeof keys[number], date = now, checkDay = true) => key === standup
  ? resolveDailyStandUpConfiguration(input, date, checkDay)
  : resolveOutreachConfiguration(input, key, date, checkDay);
const next = (input: any, key: typeof keys[number], date = now) => key === standup
  ? nextDailyStandUpRun(input, date)
  : nextConfiguredOutreachRun(date, resolveOutreachConfiguration(input, key, date, false));

describe('persisted activity time choices', () => {
  it('preserves legacy absence, infers custom times, and ignores stale overrides on reset', () => {
    expect(resolveActivityStartTime({})).toEqual({});
    expect(resolveActivityStartTime({ start_time: '12:30' })).toEqual({ mode: 'custom', startTime: '12:30' });
    expect(resolveActivityStartTime({ start_time_mode: 'business_opening', start_time: 'invalid' }))
      .toEqual({ mode: 'business_opening' });
  });

  describe.each(keys)('%s', key => {
    it.each([
      { start_time_mode: null }, { start_time_mode: '' }, { start_time_mode: 'opening' },
      { start_time_mode: 'custom' }, { start_time_mode: 'custom', start_time: null },
      { start_time_mode: 'custom', start_time: '9:00' }, { start_time_mode: 'custom', start_time: '24:00' },
    ])('fails closed for invalid timing %j', timing => {
      const input = settings(key, timing);
      expect(resolve(input, key).shouldExecute).toBe(false);
      expect(resolve(input, key, now, false).shouldExecute).toBe(false);
      expect(next(input, key)).toBeNull();
    });

    it.each(['23:59', '', null, 'invalid'])('opening mode supersedes a stale custom time %j', start_time => {
      const input = settings(key, { start_time_mode: 'business_opening', start_time });
      expect(resolve(input, key)).toMatchObject({ shouldExecute: false, startTimeMode: 'business_opening' });
      expect(resolve(input, key)).not.toHaveProperty('startTime');
      expect(next(input, key)).toMatchObject({ targetTime: new Date('2026-09-29T10:30:00Z'), scheduledTime: '10:30', fallbackUsed: false });
      expect(resolve(input, key, new Date('2026-09-29T10:29:59.999Z')).shouldExecute).toBe(false);
      expect(resolve(input, key, new Date('2026-09-29T10:30:00Z')).shouldExecute).toBe(true);
    });

    it('custom mode uses the chosen time instead of opening or historical offsets', () => {
      const input = settings(key, { start_time_mode: 'custom', start_time: '08:15' });
      expect(next(input, key)).toMatchObject({ targetTime: new Date('2026-09-29T08:15:00Z'), fallbackUsed: false });
      expect(resolve(input, key).shouldExecute).toBe(false);
      expect(resolve(input, key, new Date('2026-09-29T08:15:00Z')).shouldExecute).toBe(true);
    });

    it('uses the next selected day opening rather than the previous day snapshot', () => {
      const input = settings(key, { start_time_mode: 'business_opening' });
      // Disable intervening business days for cold outreach, which has no weekday picker.
      Object.assign(input.business_hours[0].days, { wednesday: { enabled: false }, thursday: { enabled: false } });
      expect(next(input, key, new Date('2026-09-29T10:31:00Z')))
        .toMatchObject({ targetTime: new Date('2026-10-02T08:15:00Z'), scheduledTime: '08:15' });
    });

    it('skips explicitly closed days in opening mode, rather than inventing an opening', () => {
      const input = settings(key, { start_time_mode: 'business_opening' });
      input.business_hours[0].days.tuesday.enabled = false;
      expect(resolve(input, key)).toMatchObject({ shouldExecute: false, reason: expect.stringContaining('closed') });
      expect(next(input, key)?.localDate).not.toBe('2026-09-29');
    });

    it('uses the documented 09:00 fallback when no opening is available', () => {
      const input: any = settings(key, { start_time_mode: 'business_opening' });
      input.business_hours = { timezone: 'UTC' };
      expect(next(input, key)).toMatchObject({ scheduledTime: '09:00', fallbackUsed: true });
      expect(resolve(input, key).shouldExecute).toBe(false);
      expect(resolve(input, key, new Date('2026-09-29T09:00:00Z')).shouldExecute).toBe(true);
    });

    it('supports legacy object hours, local date rollover and quarter-hour offsets', () => {
      const input: any = settings(key, { start_time_mode: 'business_opening' });
      input.business_hours = { timezone: 'Asia/Kathmandu', tuesday: { open: '00:15' } };
      const before = new Date('2026-09-28T18:29:59Z');
      const target = new Date('2026-09-28T18:30:00Z');
      expect(next(input, key, before)).toMatchObject({ targetTime: target, localDate: '2026-09-29' });
      expect(resolve(input, key, before).shouldExecute).toBe(false);
      expect(resolve(input, key, target).shouldExecute).toBe(true);
    });
  });

  it.each(['custom', 'business_opening'])('cold outreach keeps operating days for %s mode', start_time_mode => {
    const key = 'leads_initial_cold_outreach';
    const input: any = settings(key, { start_time_mode, start_time: '11:00' });
    const saturday = new Date('2026-10-03T12:00:00Z');
    expect(resolve(input, key, saturday).shouldExecute).toBe(false);
    input.business_hours[0].days.saturday = { enabled: true, start: '09:00' };
    expect(resolve(input, key, saturday).shouldExecute).toBe(true);
    input.business_hours[0].days.saturday.enabled = false;
    expect(resolve(input, key, saturday).shouldExecute).toBe(false);
  });

  it.each([standup, 'leads_follow_up'] as const)('%s custom time can run on explicitly selected closed days', key => {
    const input = settings(key, { start_time_mode: 'custom', start_time: '08:00' });
    input.business_hours[0].days.tuesday.enabled = false;
    expect(resolve(input, key).shouldExecute).toBe(true);
    expect(next(input, key)?.targetTime).toEqual(now);
  });

  it('handles a business opening in a DST gap and rejects invalid scheduler input', () => {
    const times = activityStartTimes({ business_hours: { days: { sunday: { start: '02:30' } } } },
      [0], { mode: 'business_opening' });
    expect(nextActivityRun(new Date('2026-03-08T06:59:59Z'), 'America/New_York', times)?.targetTime)
      .toEqual(new Date('2026-03-08T07:00:00Z'));
    expect(nextActivityRun(now, 'Invalid/Zone', times)).toBeNull();
    expect(nextActivityRun(now, 'UTC', {})).toBeNull();
  });
});