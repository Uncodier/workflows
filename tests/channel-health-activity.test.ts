const mockGetConnectionStatus = jest.fn();
const mockFetchCompleteSettings = jest.fn();
const mockHealthQuery = jest.fn();

jest.mock('../src/temporal/services/supabaseService', () => ({
  getSupabaseService: () => ({
    getConnectionStatus: mockGetConnectionStatus,
    fetchCompleteSettings: mockFetchCompleteSettings,
  }),
}));

jest.mock('../src/lib/supabase/client', () => ({
  supabaseServiceRole: {
    from: (table: string) => {
      if (table !== 'channel_health') throw new Error(`Unexpected table: ${table}`);
      return { select: () => ({ eq: () => ({ eq: mockHealthQuery }) }) };
    },
  },
}));

import { validateCommunicationChannelsActivity } from '../src/temporal/activities/daily-prospection/validate';
import { assertOutboundChannelAvailable, OutboundChannelUnavailable } from '../src/temporal/activities/daily-prospection/outboundGate';

describe('observed channel health activity', () => {
  const now = new Date().toISOString();
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnectionStatus.mockResolvedValue(true);
    mockFetchCompleteSettings.mockResolvedValue([{
      channels: {
        email: { enabled: true, status: 'active', email: 'configured@example.org' },
        whatsapp: { enabled: true, status: 'active', phone_number: '+1234567890' },
      },
    }]);
    mockHealthQuery.mockResolvedValue({ data: [], error: null });
  });

  it('does not equate enabled configuration with operational health', async () => {
    const configured = await validateCommunicationChannelsActivity({ site_id: 'site-1' });
    expect(configured.hasAnyChannel).toBe(true);
    const observed = await validateCommunicationChannelsActivity({
      site_id: 'site-1', requireHealthyOutbound: true,
    });
    expect(observed).toMatchObject({ success: true, hasAnyChannel: false });
    await expect(assertOutboundChannelAvailable('site-1')).rejects.toBeInstanceOf(OutboundChannelUnavailable);
  });

  it('accepts a recently proven channel and excludes unhealthy alternatives', async () => {
    mockHealthQuery.mockResolvedValue({
      data: [
        { channel: 'email', status: 'healthy', updated_at: now, last_success_at: now },
        { channel: 'whatsapp', status: 'unhealthy', updated_at: now, last_success_at: now },
      ],
      error: null,
    });
    const available = await validateCommunicationChannelsActivity({
      site_id: 'site-1', requireHealthyOutbound: true,
    });
    expect(available).toMatchObject({
      success: true, hasEmailChannel: true, hasWhatsappChannel: false, hasAnyChannel: true,
    });
    await expect(assertOutboundChannelAvailable('site-1')).resolves.toBeUndefined();
    expect(mockHealthQuery).toHaveBeenCalledWith('direction', 'outbound');
  });

  it('never authorizes a new AI call when the health read fails', async () => {
    mockHealthQuery.mockResolvedValue({ data: null, error: { code: '42P01' } });
    const result = await validateCommunicationChannelsActivity({
      site_id: 'site-1', requireHealthyOutbound: true,
    });
    expect(result).toMatchObject({ success: false, hasAnyChannel: false });
    await expect(assertOutboundChannelAvailable('site-1')).rejects.toThrow('Outbound channel health unavailable');
  });
});