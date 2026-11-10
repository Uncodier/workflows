jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: jest.fn(), request: jest.fn() } }));
import { apiService } from '../src/temporal/services/apiService';
import { sendChannelMessageFromAgentActivity, reconcileTemplateDeliveryActivity, markTemplateReconciliationRequiredActivity } from '../src/temporal/activities/channelActivities';
import { sendExactQueuedMessageActivity } from '../src/temporal/activities/exactDeliveryActivities';

const post = apiService.post as jest.Mock;
const request = { site_id: 'site', message_id: 'saved', conversation_id: 'conversation',
  channel: 'whatsapp', response_format: 'audio' as const };
const pending = { success: true, delivery_format: 'template', requested_response_format: 'audio',
  status: 'template_pending', template_pending: true, retry_after_seconds: 60, message_id: 'saved', template_id: 'template' };
const senders = [
  () => sendChannelMessageFromAgentActivity({ ...request, to: '+15555550100', message: 'Hello' }),
  () => sendExactQueuedMessageActivity(request),
];
beforeEach(() => { post.mockReset(); });
describe.each(senders)('template delivery activity %#', send => {
  test('passes pending metadata intact, does not dispatch again within activity', async () => {
    post.mockResolvedValue({ success: true, data: pending });
    expect(await send()).toMatchObject(pending);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toMatchObject({ message_id: 'saved' });
  });
  test.each(['messageId', 'message_id'])('normalizes provider receipt %s and forwards final format', async key => {
    post.mockResolvedValue({ success: true, data: { success: true, status: 'sent',
      template_pending: false, template_used: true, delivery_format: 'template', requested_response_format: 'audio', [key]: 'provider' } });
    expect(await send()).toMatchObject({ success: true, status: 'sent', messageId: 'provider',
      template_used: true, delivery_format: 'template', requested_response_format: 'audio' });
  });
  test.each([
    { ...pending, message_id: 'different' },
    { ...pending, template_id: undefined },
    { ...pending, status: 'placement_unknown' },
    { ...pending, status: 'rejected', template_pending: false },
    { success: true, status: 'sent', delivery_format: 'template' },
    { success: false, error: 'rejected' },
    {},
  ])('rejects incomplete, terminal or mismatched receipt %# without retry', async data => {
    post.mockResolvedValue({ success: true, data });
    await expect(send()).rejects.toMatchObject({ nonRetryable: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
  test.each([409, 422, 500])('HTTP %s is nonretryable for audio', async status => {
    post.mockResolvedValue({ success: false, error: { status, message: 'not confirmed' } });
    await expect(send()).rejects.toMatchObject({ nonRetryable: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
  test('network uncertainty is nonretryable', async () => {
    post.mockRejectedValue(new Error('timeout'));
    await expect(send()).rejects.toMatchObject({ nonRetryable: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('read-only reconciliation', () => {
  const read = apiService.request as jest.Mock;
  test('GET uses encoded saved identity and short timeout; no POST', async () => {
    read.mockResolvedValue({ success: true, data: { ...pending, recovery_action: 'resume', template_state: 'pending' } });
    await reconcileTemplateDeliveryActivity({ ...request, conversation_id: 'conversation & test' });
    expect(read).toHaveBeenLastCalledWith('/api/agents/tools/templateDeliveryStatus?site_id=site&conversation_id=conversation+%26+test&message_id=saved',
      { method: 'GET', timeout: 15_000 });
    expect(post).not.toHaveBeenCalled();
  });
  test.each([408, 429, 500, 503, undefined])('GET %s safe retryable failure', async status => {
    read.mockResolvedValue({ success: false, error: { status } });
    await expect(reconcileTemplateDeliveryActivity(request)).rejects.toMatchObject({ nonRetryable: false });
    expect(post).not.toHaveBeenCalled();
  });
  test.each([400, 401, 403, 404, 422])('GET %s terminal unavailable failure', async status => {
    read.mockResolvedValue({ success: false, error: { status } });
    await expect(reconcileTemplateDeliveryActivity(request)).rejects.toMatchObject({ nonRetryable: true });
  });
  test('mismatched read cannot authorize dispatch', async () => {
    read.mockResolvedValue({ success: true, data: { ...pending, recovery_action: 'resume', message_id: 'different' } });
    await expect(reconcileTemplateDeliveryActivity(request)).rejects.toMatchObject({ nonRetryable: true });
  });
  test('control POST only marks the saved template; never calls send endpoint', async () => {
    read.mockResolvedValue({ success: true, data: { success: true } });
    await markTemplateReconciliationRequiredActivity({ site_id: 'site', conversation_id: 'conversation',
      message_id: 'saved', template_id: 'template' });
    expect(read).toHaveBeenLastCalledWith('/api/agents/tools/templateDeliveryStatus', {
      method: 'POST', timeout: 15_000, body: { site_id: 'site', conversation_id: 'conversation',
        message_id: 'saved', template_id: 'template', action: 'mark_reconciliation_required' } });
    expect(post).not.toHaveBeenCalled();
  });
});