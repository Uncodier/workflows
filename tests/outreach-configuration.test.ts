import { resolveOutreachConfiguration, nextOutreachRun, localOutreachDay } from '../src/temporal/utils/outreachConfiguration';
import { evaluateOutreachHistory, summarizeOutreachHistory } from '../src/temporal/utils/outreachHistory';

const cold = 'leads_initial_cold_outreach' as const;
const followup = 'leads_follow_up' as const;
const now = new Date('2026-09-29T16:00:00Z');
const settings = (overrides = {}) => ({
  business_hours: [{ timezone: 'America/Mexico_City' }],
  channels: { email: { status: 'synced', email: 'sergio@uncodie.com' }, connections: [
    { id: 'zavu-email', type: 'email', status: 'connected', zavu_sender_id: 'sender', metadata: { from_address: 'hi@makinari.email' } },
  ] },
  activities: { [cold]: { status: 'active', channel_accounts: { email: ['zavu-email'], whatsapp: [] },
    segment_ids: ['segment'], daily_message_limit: 30, max_unanswered_messages: 3, ...overrides } },
});
const sent = (id: string, date: string, extra = {}) => ({ id, role: 'assistant', created_at: date, custom_data: { status: 'sent', ...extra } });

describe('outreach configuration', () => {
  it('defaults both activities to inactive and selects no accounts or segments implicitly', () => {
    for (const key of [cold, followup]) expect(resolveOutreachConfiguration({}, key, now).shouldExecute).toBe(false);
    expect(resolveOutreachConfiguration(settings({ status: 'default' }), cold, now).shouldExecute).toBe(false);
    expect(resolveOutreachConfiguration(settings({ channel_accounts: {} }), cold, now).shouldExecute).toBe(false);
    expect(resolveOutreachConfiguration(settings({ segment_ids: [] }), cold, now).shouldExecute).toBe(false);
    expect(resolveOutreachConfiguration(settings({ all_segments: true, segment_ids: [] }), cold, now).shouldExecute).toBe(true);
  });
  it('uses only the selected Zavu account, not configured SMTP', () => {
    expect(resolveOutreachConfiguration(settings(), cold, now)).toMatchObject({ shouldExecute: true,
      channelAccounts: { email: ['zavu-email'], whatsapp: [] }, dailyMessageLimit: 30, maxUnansweredMessages: 3 });
    expect(resolveOutreachConfiguration(settings({ channel_accounts: { email: ['missing'] } }), cold, now).shouldExecute).toBe(false);
  });
  it.each([0, -1, 1.5, 10001, '30'])('rejects invalid daily cap %s', value => {
    expect(resolveOutreachConfiguration(settings({ daily_message_limit: value }), cold, now).shouldExecute).toBe(false);
  });
  it.each([0, 101, 1.5, '3'])('rejects invalid unanswered cap %s', value => {
    expect(resolveOutreachConfiguration(settings({ max_unanswered_messages: value }), cold, now).shouldExecute).toBe(false);
  });
  it('checks follow-up weekdays locally, and schedules across DST correctly', () => {
    const input = settings();
    const config = { ...input, activities: { [followup]: { ...input.activities[cold], weekdays: [1] } } };
    expect(resolveOutreachConfiguration(config, followup, now).shouldExecute).toBe(false);
    expect(resolveOutreachConfiguration(config, followup, now, false).shouldExecute).toBe(true);
    const next = nextOutreachRun(new Date('2026-03-07T20:00:00Z'), 'America/New_York', [0]);
    expect(next?.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(localOutreachDay(new Date('2026-09-29T02:00:00Z'), 'America/Mexico_City').weekday).toBe(1);
  });
});

describe('outreach audience and unanswered limit', () => {
  it('separates never-replied contacts from contacts who have written', () => {
    const messages = [sent('one', '2026-09-01T12:00:00Z')];
    expect(evaluateOutreachHistory(messages, cold, 3, 0, now.getTime()).eligible).toBe(true);
    expect(evaluateOutreachHistory(messages, followup, 3, 0, now.getTime()).matchesAudience).toBe(false);
    messages.push({ id: 'reply', role: 'user', created_at: '2026-09-02T12:00:00Z', custom_data: { status: 'received' } });
    expect(evaluateOutreachHistory(messages, cold, 3, 0, now.getTime()).matchesAudience).toBe(false);
    expect(evaluateOutreachHistory(messages, followup, 3, 0, now.getTime())).toMatchObject({ eligible: true, unanswered: 0 });
  });
  it('counts confirmed sends across channels, resets after reply, and ignores failed/drafts', () => {
    const messages = [sent('old', '2026-09-01T12:00:00Z'),
      { id: 'reply', role: 'user', created_at: '2026-09-02T12:00:00Z' },
      sent('email', '2026-09-03T12:00:00Z', { channel: 'email' }),
      sent('whatsapp', '2026-09-04T12:00:00Z', { channel: 'whatsapp' }),
      { id: 'failed', role: 'assistant', created_at: '2026-09-05T12:00:00Z', custom_data: { status: 'failed' } },
    ];
    expect(summarizeOutreachHistory(messages).unanswered).toBe(2);
    expect(evaluateOutreachHistory(messages, followup, 2, 7 * 86400000, now.getTime())).toMatchObject({ eligible: false, shouldMarkCold: true });
    expect(evaluateOutreachHistory(messages, followup, 2, 7 * 86400000, Date.parse('2026-09-05T12:00:00Z')).shouldMarkCold).toBe(false);
    messages.push({ id: 'draft', role: 'assistant', created_at: '2026-09-06T12:00:00Z', custom_data: { status: 'pending' } });
    expect(summarizeOutreachHistory(messages)).toMatchObject({ unanswered: 2, hasPending: true });
  });
  it('deduplicates confirmed tracking copies by provider identity', () => {
    expect(summarizeOutreachHistory([
      sent('one', '2026-09-02T12:00:00Z', { external_message_id: 'provider' }),
      sent('two', '2026-09-02T12:00:00Z', { delivery: { success: true, details: { message_id: 'provider' } } }),
    ]).unanswered).toBe(1);
  });
});