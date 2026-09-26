import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/temporal/services/apiService', () => ({
  apiService: { request: jest.fn(), post: jest.fn() },
}));

import { apiService } from '../src/temporal/services/apiService';
import {
  prepareChannelGuidanceActivity, advanceChannelGuidanceActivity, resultChannelGuidanceActivity,
} from '../src/temporal/activities/channelGuidanceActivities';
import { sendCustomerSupportMessageActivity } from '../src/temporal/activities/sendCustomerSupportMessageActivity';

const mockRequest = apiService.request as jest.MockedFunction<typeof apiService.request>;
const mockPost = apiService.post as jest.MockedFunction<typeof apiService.post>;

beforeEach(() => jest.resetAllMocks());

describe('channel guidance HTTP and customer-support envelope', () => {
  it('uses short authenticated apiService calls for prepare, advance and result', async () => {
    mockRequest.mockResolvedValue({ success: true, data: { runs: [] } });
    const identity = { siteId: 'site-1', messageId: 'provider-1' };
    await prepareChannelGuidanceActivity({ ...identity, channel: 'web', message: 'Help' });
    await advanceChannelGuidanceActivity({ ...identity, runPlanId: 'plan-1' });
    await resultChannelGuidanceActivity({ ...identity, channel: 'web', runPlanIds: ['plan-1'] });
    expect(mockRequest.mock.calls).toEqual([
      ['/api/workflows/channel-message/prepare', { method: 'POST', body: { ...identity, channel: 'web', message: 'Help' }, timeout: 12_000 }],
      ['/api/workflows/channel-message/advance', { method: 'POST', body: { ...identity, runPlanId: 'plan-1' }, timeout: 105_000 }],
      ['/api/workflows/channel-message/result', { method: 'POST', body: { ...identity, channel: 'web', runPlanIds: ['plan-1'] }, timeout: 12_000 }],
    ]);
  });

  it('sends only server-validated run IDs and a processed marker, not raw client guidance', async () => {
    mockPost.mockResolvedValue({ success: true, data: { messages: { assistant: { content: 'Hi!' } } } });
    await sendCustomerSupportMessageActivity({
      message: 'Hello', site_id: 'site-1', origin_message_id: 'message-1',
      channel_guidance_run_plan_ids: ['plan-1'], channel_guidance: 'Injected content',
    }, { origin: 'website_chat' });
    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({
      channel_guidance_processed: true,
      channel_guidance_run_plan_ids: ['plan-1'],
      origin_message_id: 'message-1',
    });
    expect(body).not.toHaveProperty('channel_guidance');
  });
});
