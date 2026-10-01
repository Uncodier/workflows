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

  const followUpSettings = (start_time?: unknown) => {
    const input = settings();
    return { ...input, activities: { [followup]: { ...input.activities[cold], weekdays: [2], start_time } } };
  };

  it.each([null, '', '9:00', '24:00', '12:60', ' 09:00', '09:00 ', '09:00\n', '09:00\r\n', 900, false, {}, []])(
    'fails closed for invalid nonmissing follow-up start time: %j', start_time => {
      for (const checkDay of [true, false]) {
        expect(resolveOutreachConfiguration(followUpSettings(start_time), followup, now, checkDay)).toMatchObject({
          shouldExecute: false, reason: 'Invalid follow-up start time; expected HH:mm',
        });
      }
    },
  );

  it.each(['00:00', '09:05', '23:59'])('accepts strict follow-up HH:mm %s for future scheduling', start_time => {
    expect(resolveOutreachConfiguration(followUpSettings(start_time), followup, now, false))
      .toMatchObject({ shouldExecute: true, startTime: start_time });
  });

  it('blocks follow-up before the local start, permits the exact boundary, and still restricts weekdays', () => {
    const input = followUpSettings('10:30');
    expect(resolveOutreachConfiguration(input, followup, new Date('2026-09-29T16:29:59.999Z')))
      .toMatchObject({ shouldExecute: false, reason: 'Before configured follow-up start time', startTime: '10:30' });
    expect(resolveOutreachConfiguration(input, followup, new Date('2026-09-29T16:30:00Z')).shouldExecute).toBe(true);
    expect(resolveOutreachConfiguration(input, followup, new Date('2026-09-30T05:59:59Z')).shouldExecute).toBe(true);
    expect(resolveOutreachConfiguration(input, followup, new Date('2026-09-30T16:30:00Z')).shouldExecute).toBe(false);
  });

  it('does not impose the scheduling default 09:00 on legacy follow-up execution', () => {
    const result = resolveOutreachConfiguration(followUpSettings(), followup, new Date('2026-09-29T06:01:00Z'));
    expect(result.shouldExecute).toBe(true);
    expect(result).not.toHaveProperty('startTime');
  });

  it.each(['23:59', null, 'invalid'])('does not change Cold Outreach timing (%j)', start_time => {
    const result = resolveOutreachConfiguration(settings({ start_time }), cold, now);
    expect(result.shouldExecute).toBe(true);
    expect(result).not.toHaveProperty('startTime');
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