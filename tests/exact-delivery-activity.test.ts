jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: jest.fn() } }));
import { apiService } from '../src/temporal/services/apiService';
import { sendExactQueuedMessageActivity } from '../src/temporal/activities/exactDeliveryActivities';
beforeEach(() => jest.clearAllMocks());
const request = { site_id: 'site', message_id: 'message', conversation_id: 'conversation', channel: 'whatsapp' };
test('forwards stored message identity to exact provider API', async () => {
  (apiService.post as jest.Mock).mockResolvedValue({ success: true, data: { success: true, messageId: 'exact' } });
  expect(await sendExactQueuedMessageActivity(request)).toEqual({ success: true, messageId: 'exact' });
  expect(apiService.post).toHaveBeenCalledWith('/api/agents/tools/sendExactDelivery', request);
});
test('uncertain delivery returns refusal, no default send endpoint', async () => {
  (apiService.post as jest.Mock).mockRejectedValue(new Error('network failure'));
  expect(await sendExactQueuedMessageActivity(request)).toMatchObject({ success: false });
  expect(apiService.post).toHaveBeenCalledTimes(1);
});