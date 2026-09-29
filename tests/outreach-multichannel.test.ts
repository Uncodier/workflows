const mockPatched = jest.fn().mockReturnValue(true);
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'), patched: mockPatched,
}));
import { resolveOutreachConfiguration } from '../src/temporal/utils/outreachConfiguration';
import { hasOutreachRecipient } from '../src/temporal/utils/outreachRecipients';
import { performEarlyValidation } from '../src/temporal/workflows/leadFollowUp/validation';

describe('all connected agent outreach channels', () => {
  it.each(['sms', 'telegram', 'messenger', 'instagram', 'voice', 'custom_agent'])('supports %s without email or WhatsApp', channel => {
    const config = resolveOutreachConfiguration({
      channels: { connections: [{ id: 'account', type: channel, status: 'connected', zavu_sender_id: 'sender' }] },
      activities: { leads_initial_cold_outreach: { status: 'active', channel_accounts: { [channel]: ['account'] }, all_segments: true } },
    }, 'leads_initial_cold_outreach');
    expect(config).toMatchObject({ shouldExecute: true, hasAnyChannel: true, hasEmailChannel: false,
      hasWhatsappChannel: false, availableChannels: [channel], channelAccounts: { [channel]: ['account'] } });
  });

  it.each(['audio', 'constructor', '__proto__', 'toString', 'prototype', 'bad.channel'])('rejects unsafe or format-only key %s', channel => {
    const config = resolveOutreachConfiguration({
      channels: { connections: [{ id: 'account', type: channel, status: 'connected', zavu_sender_id: 'sender' }] },
      activities: { leads_initial_cold_outreach: { status: 'active', channel_accounts: { [channel]: ['account'] }, all_segments: true } },
    }, 'leads_initial_cold_outreach');
    expect(config.hasAnyChannel).toBe(false);
  });

  it('does not select a disconnected or duplicate account ID', () => {
    const config = resolveOutreachConfiguration({
      channels: { connections: [
        { id: 'account', type: 'sms', status: 'connected', zavu_sender_id: 'a' },
        { id: 'account', type: 'sms', status: 'connected', zavu_sender_id: 'b' },
        { id: 'other', type: 'telegram', status: 'disconnected', zavu_sender_id: 'c' },
      ] },
      activities: { leads_initial_cold_outreach: { status: 'active', channel_accounts: { sms: ['account'], telegram: ['other'] }, all_segments: true } },
    }, 'leads_initial_cold_outreach');
    expect(config.hasAnyChannel).toBe(false);
  });

  it('uses phone for SMS but never guesses a chat identity from an unrelated phone', () => {
    expect(hasOutreachRecipient({ phone: '+15555550123' }, 'sms')).toBe(true);
    expect(hasOutreachRecipient({ phone: '+15555550123' }, 'telegram')).toBe(false);
    expect(hasOutreachRecipient({ social_networks: { telegram: { chat_id: '12345' } } }, 'telegram')).toBe(true);
    expect(hasOutreachRecipient({ social_networks: { telegram: 'https://t.me/person' } }, 'telegram')).toBe(false);
  });

  it('requires consent for voice even when a valid phone is present', () => {
    const lead = { phone: '+15555550123', voice_call_consent_status: 'granted', voice_call_consent_at: '2026-01-01T00:00:00Z' };
    expect(hasOutreachRecipient({ phone: lead.phone }, 'voice')).toBe(false);
    expect(hasOutreachRecipient(lead, 'voice')).toBe(true);
    expect(hasOutreachRecipient({ ...lead, do_not_call: true }, 'voice')).toBe(false);
  });

  it('rejects cross-tenant and public-comment conversation identities', () => {
    const lead = { id: 'lead', site_id: 'site' };
    const conversation = { id: 'conversation', site_id: 'site', lead_id: 'lead', channel: 'instagram', custom_data: { recipient_id: 'user-123' } };
    expect(hasOutreachRecipient(lead, 'instagram', [conversation], 'site')).toBe(true);
    expect(hasOutreachRecipient(lead, 'instagram', [{ ...conversation, site_id: 'other' }], 'site')).toBe(false);
    expect(hasOutreachRecipient(lead, 'instagram', [{ ...conversation, custom_data: { ...conversation.custom_data, comment_id: 'comment' } }], 'site')).toBe(false);
    expect(hasOutreachRecipient({ ...lead, phone: '+521234567890', origin: 'instagram' }, 'instagram', [], 'site')).toBe(false);
    expect(hasOutreachRecipient({ ...lead, social_networks: { instagram: 'public-profile' },
      metadata: { social_network: 'instagram', social_handle: 'public-profile' } }, 'instagram', [], 'site')).toBe(false);
    expect(hasOutreachRecipient({ ...lead, social_networks: { instagram: 'public-profile' } }, 'instagram',
      [{ ...conversation, custom_data: { comment_id: 'comment' } }], 'site')).toBe(false);
  });

  it('does not email-validate or reject a Telegram-only contact', async () => {
    const activities = { validateContactInformation: jest.fn() };
    const result = await performEarlyValidation({
      lead_id: 'lead', site_id: 'site', leadInfo: {}, options: { lead_id: 'lead', site_id: 'site' },
      site: { name: 'Site' }, activities, startTime: Date.now(), workflowId: 'workflow',
      selectedChannels: { email: false, whatsapp: false }, alternativeChannels: ['telegram'],
    });
    expect(result.shouldReturn).toBe(false);
    expect(activities.validateContactInformation).not.toHaveBeenCalled();
  });
});