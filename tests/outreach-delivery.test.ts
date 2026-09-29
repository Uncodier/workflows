const mockApiPost = jest.fn();
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: mockApiPost } }));

import { sendOutreachMessageActivity } from '../src/temporal/activities/outreachDeliveryActivities';
import { resolveOutreachActivity } from '../src/temporal/utils/outreachActivity';

describe('managed outreach identification and delivery', () => {
  beforeEach(() => jest.clearAllMocks());

  it('preserves cold outreach attribution over follow-up metadata', () => {
    expect(resolveOutreachActivity({ outreach_activity: 'leads_initial_cold_outreach', follow_up_type: 'lead_nurture' }))
      .toBe('leads_initial_cold_outreach');
    expect(resolveOutreachActivity({ triggeredBy: 'dailyProspectionWorkflow' })).toBe('leads_initial_cold_outreach');
    expect(resolveOutreachActivity({ sequence_stage: 'reminder' })).toBe('leads_follow_up');
    expect(resolveOutreachActivity({ follow_up_type: 'lead_nurture' })).toBe('leads_follow_up');
    expect(resolveOutreachActivity({ source: 'customer_support' })).toBeUndefined();
  });

  it('passes only site and stored message identity to the account-aware sender', async () => {
    mockApiPost.mockResolvedValue({ success: true, data: { success: true, messageId: 'provider-message' } });
    await expect(sendOutreachMessageActivity({ site_id: 'site', message_id: 'message' }))
      .resolves.toEqual({ success: true, messageId: 'provider-message' });
    expect(mockApiPost).toHaveBeenCalledWith('/api/agents/tools/sendOutreachMessage', { site_id: 'site', message_id: 'message' });
  });

  it('preserves daily limit deferral rather than reporting a delivery failure', async () => {
    const result = { success: false, deferred: true, reason: 'Daily limit reached', retryAt: '2026-09-30T06:00:00Z' };
    mockApiPost.mockResolvedValue({ success: true, data: result });
    await expect(sendOutreachMessageActivity({ site_id: 'site', message_id: 'message' })).resolves.toEqual(result);
  });

  it('defers ambiguous network results without retrying through a fallback sender', async () => {
    mockApiPost.mockRejectedValue(new Error('Timeout'));
    await expect(sendOutreachMessageActivity({ site_id: 'site', message_id: 'message' }))
      .resolves.toMatchObject({ success: false, deferred: true, reason: 'Timeout' });
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });
});