import { DAILY_STAND_UP_REPORT_SECTIONS, resolveDailyStandUpConfiguration } from '../src/temporal/utils/dailyStandUpConfiguration';

const monday = new Date('2026-09-28T16:00:00Z');
const settings = (activity: any, timezone: any = 'America/Mexico_City') => ({
  activities: { daily_resume_and_stand_up: activity }, business_hours: [{ timezone }],
});

describe('Daily Standup configuration', () => {
  it('preserves Monday/Friday and all sections for active legacy settings', () => {
    expect(resolveDailyStandUpConfiguration(settings({ status: 'active' }), monday)).toMatchObject({
      shouldExecute: true, weekdays: [1, 5], reportSections: [...DAILY_STAND_UP_REPORT_SECTIONS],
    });
  });

  it.each([undefined, {}, { status: 'default' }, { status: 'inactive' }])('requires explicit activation: %j', raw => {
    expect(resolveDailyStandUpConfiguration(settings(raw), monday).shouldExecute).toBe(false);
  });

  it('honors active legacy string status', () => {
    expect(resolveDailyStandUpConfiguration(settings('active'), monday).shouldExecute).toBe(true);
  });

  it('normalizes duplicate selections without enabling additional sections', () => {
    expect(resolveDailyStandUpConfiguration(settings({ status: 'active', weekdays: [5, 1, 1], report_sections: ['orders', 'sales', 'orders'] }), monday))
      .toMatchObject({ shouldExecute: true, weekdays: [1, 5], reportSections: ['sales', 'orders'] });
  });

  it.each([[], null, 'monday', [7], [-1], [1.5], ['1'], [true]])('blocks invalid or empty weekdays: %j', weekdays => {
    expect(resolveDailyStandUpConfiguration(settings({ status: 'active', weekdays }), monday).shouldExecute).toBe(false);
  });

  it.each([[], null, 'sales', ['unknown'], ['sales', 'unknown'], [1]])('blocks invalid or empty sections: %j', sections => {
    expect(resolveDailyStandUpConfiguration(settings({ status: 'active', report_sections: sections }), monday).shouldExecute).toBe(false);
  });

  it('uses the local weekday instead of the server/UTC weekday', () => {
    const config = settings({ status: 'active', weekdays: [0], report_sections: ['tasks'] }, 'America/Los_Angeles');
    expect(resolveDailyStandUpConfiguration(config, new Date('2026-09-28T01:00:00Z')).shouldExecute).toBe(true);
    expect(resolveDailyStandUpConfiguration(config, monday).shouldExecute).toBe(false);
  });

  it('allows a selected weekend and can validate future scheduling independently of today', () => {
    const config = settings({ status: 'active', weekdays: [6], report_sections: ['inventory'] });
    expect(resolveDailyStandUpConfiguration(config, monday).shouldExecute).toBe(false);
    expect(resolveDailyStandUpConfiguration(config, monday, false).shouldExecute).toBe(true);
    expect(resolveDailyStandUpConfiguration(config, new Date('2026-10-03T16:00:00Z')).shouldExecute).toBe(true);
  });

  it.each(['Not/A_Zone', '', 123])('fails closed for an invalid timezone: %j', timezone => {
    expect(resolveDailyStandUpConfiguration(settings({ status: 'active' }, timezone), monday))
      .toMatchObject({ shouldExecute: false, reason: 'Invalid site timezone' });
  });

  it.each([null, '', '9:00', '09:0', '24:00', '12:60', ' 09:00', '09:00 ', '09:00\n', '09:00\r\n', 900, false, {}, []])(
    'fails closed for a supplied invalid start time in scheduling and execution: %j', start_time => {
      const config = settings({ status: 'active', start_time });
      for (const checkDay of [true, false]) {
        expect(resolveDailyStandUpConfiguration(config, monday, checkDay)).toMatchObject({
          shouldExecute: false, reason: 'Invalid Daily Standup start time; expected HH:mm',
        });
      }
    },
  );

  it.each(['00:00', '09:05', '23:59'])('accepts strict HH:mm start time %s for future scheduling', start_time => {
    expect(resolveDailyStandUpConfiguration(settings({ status: 'active', start_time }), monday, false))
      .toMatchObject({ shouldExecute: true, startTime: start_time });
  });

  it('checks the configured start in the site timezone, with an inclusive boundary and no end-time restriction', () => {
    const config = settings({ status: 'active', start_time: '10:30' });
    expect(resolveDailyStandUpConfiguration(config, new Date('2026-09-28T16:29:59.999Z')))
      .toMatchObject({ shouldExecute: false, reason: 'Before configured Daily Standup start time' });
    for (const now of ['2026-09-28T16:30:00Z', '2026-09-29T05:59:59Z']) {
      expect(resolveDailyStandUpConfiguration(config, new Date(now)).shouldExecute).toBe(true);
    }
    expect(resolveDailyStandUpConfiguration(config, new Date('2026-09-29T16:30:00Z')).shouldExecute).toBe(false);
  });

  it('does not impose an opening-time or 09:00 runtime guard when start_time is missing', () => {
    const config = settings({ status: 'active' });
    expect(resolveDailyStandUpConfiguration(config, new Date('2026-09-28T06:01:00Z')))
      .toMatchObject({ shouldExecute: true });
    expect(resolveDailyStandUpConfiguration(config, monday)).not.toHaveProperty('startTime');
  });

  it('allows a spring-forward gap target at the first valid minute after it', () => {
    const config = settings({ status: 'active', weekdays: [0], start_time: '02:30' }, 'America/New_York');
    expect(resolveDailyStandUpConfiguration(config, new Date('2026-03-08T06:59:59Z')).shouldExecute).toBe(false);
    expect(resolveDailyStandUpConfiguration(config, new Date('2026-03-08T07:00:00Z')).shouldExecute).toBe(true);
  });
});