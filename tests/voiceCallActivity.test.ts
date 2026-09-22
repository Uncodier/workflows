const mockPost = jest.fn();

jest.mock('../src/temporal/services/apiService', () => ({
  apiService: { post: mockPost },
}));

import { placeVoiceCallFromAgentActivity } from '../src/temporal/activities/channelActivities';

const params = {
  to: '+5215551234567',
  message: 'Hello from Acme',
  site_id: 'site-1',
  message_id: 'message-1',
  conversation_id: 'conversation-1',
  lead_id: 'lead-1',
  audience_id: 'audience-1',
};

describe('placeVoiceCallFromAgentActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls the dedicated internal endpoint with delivery identity', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: { callId: 'call-1', status: 'queued', deliveryId: 'delivery-1' },
    });

    await expect(placeVoiceCallFromAgentActivity(params)).resolves.toEqual({
      callId: 'call-1',
      status: 'queued',
      deliveryId: 'delivery-1',
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/agents/tools/placeVoiceCall',
      expect.objectContaining({
        to: params.to,
        message_id: params.message_id,
        audience_id: params.audience_id,
      })
    );
  });

  it('marks ambiguous transport failures as placement unknown', async () => {
    mockPost.mockResolvedValue({
      success: false,
      error: { code: 'TIMEOUT', message: 'Request timeout' },
    });

    await expect(placeVoiceCallFromAgentActivity(params)).rejects.toMatchObject({
      type: 'VOICE_CALL_PLACEMENT_UNKNOWN',
      nonRetryable: true,
    });
  });
});
