const mockConfig = jest.fn();
jest.mock('../src/temporal/activities/outreachConfigurationActivity', () => ({ getOutreachConfigurationActivity: mockConfig }));
jest.mock('../src/temporal/services/supabaseService', () => ({ getSupabaseService: jest.fn() }));
import { validateCommunicationChannelsActivity } from '../src/temporal/activities/daily-prospection/validate';

describe('configured multichannel activity validation', () => {
  it.each(['sms', 'telegram', 'voice', 'custom_chat'])('does not discard healthy configured %s because email and WhatsApp are absent', async channel => {
    mockConfig.mockResolvedValue({ shouldExecute: true, hasEmailChannel: false, hasWhatsappChannel: false,
      channelAccounts: { email: [], whatsapp: [], [channel]: ['selected'] }, availableChannels: [channel] });
    await expect(validateCommunicationChannelsActivity({ site_id: 'site', outreach_activity: 'leads_follow_up', requireHealthyOutbound: true }))
      .resolves.toMatchObject({ success: true, hasAnyChannel: true, availableChannels: [channel], hasEmailChannel: false, hasWhatsappChannel: false });
  });

  it('does not let another connected channel override inactive outreach', async () => {
    mockConfig.mockResolvedValue({ shouldExecute: false, reason: 'Inactive', hasEmailChannel: false, hasWhatsappChannel: false,
      channelAccounts: { email: [], whatsapp: [], sms: ['selected'] }, availableChannels: ['sms'] });
    await expect(validateCommunicationChannelsActivity({ site_id: 'site', outreach_activity: 'leads_follow_up' }))
      .resolves.toMatchObject({ hasAnyChannel: false, availableChannels: [] });
  });
});