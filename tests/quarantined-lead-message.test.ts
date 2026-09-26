const mockGetConnectionStatus = jest.fn();
const mockMessagesLimit = jest.fn();
const mockLeadsIn = jest.fn();
const mockConversationsIn = jest.fn();

jest.mock('../src/temporal/services/supabaseService', () => ({
  getSupabaseService: () => ({ getConnectionStatus: mockGetConnectionStatus }),
}));
jest.mock('../src/lib/supabase/client', () => ({
  supabaseServiceRole: {
    from: (table: string) => {
      if (table === 'messages') {
        return { select: () => ({
          eq: () => ({ order: () => ({ limit: mockMessagesLimit }) }),
        }) };
      }
      if (table === 'conversations') return { select: () => ({ in: mockConversationsIn }) };
      if (table === 'leads') return { select: () => ({ in: mockLeadsIn }) };
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

import { getApprovedMessagesActivity } from '../src/temporal/activities/messageActivities';

describe('approved messages for quarantined cross-tenant leads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnectionStatus.mockResolvedValue(true);
    mockMessagesLimit.mockResolvedValue({
      data: [
        { id: 'message-1', conversation_id: 'conversation-1', content: 'wrong-site reply', custom_data: { status: 'accepted' } },
        { id: 'message-2', conversation_id: 'conversation-2', content: 'normal reply', custom_data: { status: 'accepted' } },
      ], error: null,
    });
    mockConversationsIn.mockResolvedValue({
      data: [
        { id: 'conversation-1', site_id: 'site-1', lead_id: 'lead-1', channel: 'linkedin' },
        { id: 'conversation-2', site_id: 'site-2', lead_id: 'lead-2', channel: 'linkedin' },
      ], error: null,
    });
    mockLeadsIn.mockResolvedValue({
      data: [
        { id: 'lead-1', name: 'Social User', metadata: { quarantined_cross_tenant: true } },
        { id: 'lead-2', name: 'Customer', metadata: {} },
      ], error: null,
    });
  });

  it('never dispatches an approved message for a quarantined lead', async () => {
    const approved = await getApprovedMessagesActivity();
    expect(approved.map((message) => message.message_id)).toEqual(['message-2']);
    expect(mockLeadsIn).toHaveBeenCalledWith('id', ['lead-1', 'lead-2']);
  });

  it('fails closed when the lead quarantine lookup is unavailable', async () => {
    mockLeadsIn.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    await expect(getApprovedMessagesActivity()).rejects.toThrow('Failed to fetch lead batch: unavailable');
  });
});