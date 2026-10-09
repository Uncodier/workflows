import { resolveOutreachConfiguration } from '../src/temporal/utils/outreachConfiguration';
import { shouldScheduleWorkflow } from '../src/temporal/utils/activityOptIn';
import { resolveOutreachActivity } from '../src/temporal/utils/outreachActivity';
import { advanceSubscriptionDueDate, invoiceDate } from '../src/temporal/utils/invoiceDueDate';
import { summarizeOutreachHistory } from '../src/temporal/utils/outreachHistory';

const now = new Date('2026-10-06T16:00:00Z');
const settings = (changes: Record<string, unknown> = {}) => ({
  business_hours: { timezone: 'UTC' },
  channels: { email: { status: 'active', email: 'billing@example.test' } },
  activities: { invoices_due: { status: 'active', channel_accounts: { email: ['email'] }, ...changes } },
});

describe('due invoice configuration', () => {
  it.each([undefined, 'inactive', 'default'])('defaults status %s to off at both scheduling and execution', status => {
    expect(shouldScheduleWorkflow({ settings: settings({ status }) }, 'invoices_due')).toBe(false);
    expect(resolveOutreachConfiguration(settings({ status }), 'invoices_due', now).shouldExecute).toBe(false);
  });
  it('uses unpaid invoices as audience rather than requiring lead segments', () => {
    expect(resolveOutreachConfiguration(settings(), 'invoices_due', now)).toMatchObject({
      shouldExecute: true, allSegments: true, segmentIds: [], repeatIntervalDays: 3, cooldownMode: 'progressive',
      availableChannels: ['email'], weekdays: [1, 2, 3, 4, 5],
      startTimeMode: 'business_opening',
    });
  });
  it.each([0, -1, 1.5, 366, '3', null])('rejects invalid intervals %j when provided', value => {
    expect(resolveOutreachConfiguration(settings({ repeat_interval_days: value }), 'invoices_due', now).shouldExecute).toBe(false);
  });
  it('preserves legacy fixed invoice settings and validates explicit cadence', () => {
    expect(resolveOutreachConfiguration(settings({ repeat_interval_days: 5 }), 'invoices_due', now)).toMatchObject({ shouldExecute: true, cooldownMode: 'fixed', repeatIntervalDays: 5 });
    expect(resolveOutreachConfiguration(settings({ cooldown_mode: 'fixed', repeat_interval_days: 5 }), 'invoices_due', now)).toMatchObject({ shouldExecute: true, cooldownMode: 'fixed' });
    expect(resolveOutreachConfiguration(settings({ cooldown_mode: 'invalid' }), 'invoices_due', now).shouldExecute).toBe(false);
  });
  it('requires a selected connected account and honors weekdays and opening time', () => {
    expect(resolveOutreachConfiguration(settings({ channel_accounts: {} }), 'invoices_due', now).shouldExecute).toBe(false);
    expect(resolveOutreachConfiguration(settings({ weekdays: [1] }), 'invoices_due', now).shouldExecute).toBe(false);
    expect(resolveOutreachConfiguration(settings({ start_time_mode: 'custom', start_time: '17:00' }), 'invoices_due', now).shouldExecute).toBe(false);
    expect(resolveOutreachConfiguration(settings(), 'invoices_due', new Date('2026-10-06T08:00:00Z')).shouldExecute).toBe(false);
  });
  it('recognizes invoice metadata for managed delivery rather than the lead fallback', () => {
    expect(resolveOutreachActivity({ outreach_activity: 'invoices_due', sequence_stage: 'reminder' })).toBe('invoices_due');
  });
  it('does not count invoice reminders toward unanswered prospecting messages', () => {
    expect(summarizeOutreachHistory([{ id: 'invoice-message', role: 'assistant', created_at: now.toISOString(),
      custom_data: { status: 'sent', outreach_activity: 'invoices_due' } }])).toMatchObject({ unanswered: 0, lastSentAt: 0 });
  });
});

describe('invoice calendar dates', () => {
  it.each(['0000-01-01', '2026-02-30', '2026-2-03', 'invalid', '2026-10-06T00:00:00Z'])('rejects %s', date => {
    expect(() => invoiceDate(date)).toThrow('Invalid invoice due date');
  });
  it('keeps net terms across clamped months and UTC rollover', () => {
    expect(advanceSubscriptionDueDate('2026-02-10', '2026-01-31T12:00:00Z', '2026-02-28T12:00:00Z')).toBe('2026-03-10');
    expect(advanceSubscriptionDueDate('2026-10-11', '2026-09-30T18:00:00-06:00', '2026-11-01T00:00:00Z')).toBe('2026-11-11');
  });
});