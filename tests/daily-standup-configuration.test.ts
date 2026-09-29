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
});