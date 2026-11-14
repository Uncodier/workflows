const mockSend = jest.fn();
const mockLegacySend = jest.fn();
const mockFetch = jest.fn();
const mockStatus = jest.fn();
const mockCleanup = jest.fn();
const mockTemplate = jest.fn();
const mockReconcile = jest.fn();
const mockMark = jest.fn();
const mockReadOptions: any[] = [];
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'),
  proxyActivities: (options: any) => {
    if (options.scheduleToCloseTimeout) mockReadOptions.push(options);
    return ({
    sendWhatsAppFromAgentActivity: options.retry.maximumAttempts === 1 ? mockSend : mockLegacySend,
    sendChannelMessageFromAgentActivity: options.retry.maximumAttempts === 1 ? mockSend : mockLegacySend,
    sendEmailFromAgentActivity: options.retry.maximumAttempts === 1 ? mockSend : mockLegacySend,
    fetchRecordByTableAndIdActivity: mockFetch,
    updateMessageStatusToSentActivity: mockStatus,
    cleanupFailedFollowUpActivity: mockCleanup,
    createTemplateActivity: mockTemplate,
    reconcileTemplateDeliveryActivity: mockReconcile,
    markTemplateReconciliationRequiredActivity: mockMark,
  }); },
  upsertSearchAttributes: jest.fn(),
  patched: jest.fn(() => true),
  sleep: jest.fn(),
}));
import { sendWhatsappFromAgent } from '../src/temporal/workflows/sendWhatsappFromAgentWorkflow';
import { sendChannelMessageFromAgentWorkflow } from '../src/temporal/workflows/sendChannelMessageFromAgentWorkflow';
import { sendEmailFromAgent } from '../src/temporal/workflows/sendEmailFromAgentWorkflow';
import { patched, sleep } from '@temporalio/workflow';

const common = { site_id: 'site', message: 'Hello', message_id: 'message', conversation_id: 'conversation', lead_id: 'lead' };
beforeEach(() => {
  jest.clearAllMocks();
  (patched as jest.Mock).mockReturnValue(true);
  mockFetch.mockResolvedValue({ content: 'Refreshed hello' });
  mockSend.mockResolvedValue({ success: true, messageId: 'message' });
  mockLegacySend.mockResolvedValue({ success: true, messageId: 'message' });
  mockReconcile.mockReset().mockRejectedValue(new Error('reconciliation unavailable'));
  mockMark.mockReset().mockResolvedValue(undefined);
});

const pendingTemplate = { success: true, status: 'template_pending', template_pending: true,
  delivery_format: 'template', requested_response_format: 'audio', message_id: 'message',
  template_id: 'template', retry_after_seconds: 60 };
const templateParams = { ...common, channel: 'whatsapp', to: '+15555550100', response_format: 'audio' as const };
it('polls a durable pending template with identical saved inputs then returns template sent without extra audio', async () => {
  mockSend.mockResolvedValueOnce(pendingTemplate).mockResolvedValueOnce({ success: true, status: 'sent',
    delivery_format: 'template', requested_response_format: 'audio', template_used: true, messageId: 'provider' });
  expect(await sendChannelMessageFromAgentWorkflow(templateParams)).toMatchObject({
    success: true, status: 'sent', delivery_format: 'template', requested_response_format: 'audio',
    template_used: true, messageId: 'provider' });
  expect(sleep).toHaveBeenCalledWith('1 minute');
  expect(mockSend.mock.calls).toEqual([[templateParams], [templateParams]]);
  expect(mockLegacySend).not.toHaveBeenCalled();
});
it('polls at most hourly through the API 24h deadline then persists unconfirmed, not active pending', async () => {
  mockSend.mockResolvedValue(pendingTemplate);
  expect(await sendChannelMessageFromAgentWorkflow(templateParams)).toMatchObject({
    success: false, status: 'needs_reconciliation', template_pending: false, polling_exhausted: true,
    reconciliation_persisted: true });
  expect((sleep as jest.Mock).mock.calls.map(([delay]) => delay)).toEqual(['1 minute', '30 minutes', ...Array(24).fill('1 hour')]);
  expect(mockSend).toHaveBeenCalledTimes(27);
});
it.each(['rejected', 'placement_unknown', 'dispatching'])('stops immediately on %s receipt', async status => {
  mockSend.mockResolvedValue({ ...pendingTemplate, status, template_pending: false });
  await expect(sendChannelMessageFromAgentWorkflow(templateParams)).rejects.toMatchObject({ nonRetryable: true });
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});
it('unavailable reconciliation retains prior receipt, not active pending, and never repeats POST', async () => {
  mockSend.mockResolvedValueOnce(pendingTemplate).mockRejectedValueOnce(new Error('timeout'));
  await expect(sendChannelMessageFromAgentWorkflow(templateParams)).resolves.toMatchObject({ success: false,
    status: 'needs_reconciliation', needs_reconciliation: true, template_pending: false,
    message_id: 'message', template_id: 'template' });
  expect(mockSend).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);
  expect(mockReconcile).toHaveBeenCalledTimes(1);
  expect(mockReadOptions).toEqual(expect.arrayContaining([expect.objectContaining({ startToCloseTimeout: '30 seconds',
    scheduleToCloseTimeout: '3 minutes', retry: expect.objectContaining({ maximumAttempts: 4 }) })]));
  expect(mockMark).toHaveBeenCalledWith({ site_id: 'site', conversation_id: 'conversation', message_id: 'message', template_id: 'template' });
});
it('prolonged read and control outage explicitly reports unpersisted reconciliation requirement', async () => {
  mockSend.mockResolvedValueOnce(pendingTemplate).mockRejectedValueOnce(new Error('503'));
  mockMark.mockRejectedValue(new Error('503'));
  expect(await sendChannelMessageFromAgentWorkflow(templateParams)).toMatchObject({ success: false,
    status: 'needs_reconciliation', template_pending: false, reconciliation_persisted: false,
    message_id: 'message', template_id: 'template' });
  expect(mockSend).toHaveBeenCalledTimes(2);
});
it.each([
  { recovery_action: 'resume', template_state: 'dispatching' },
  { recovery_action: 'resume', template_state: 'submitting' },
  { recovery_action: 'resume', template_state: 'pending', template_id: 'other' },
  { recovery_action: 'resume', template_state: 'pending', message_id: 'other' },
  { recovery_action: 'complete', template_state: 'sent', delivery_status: 'failed', messageId: 'provider' },
  { recovery_action: 'complete', template_state: 'sent' },
])('malformed or unsafe read %# fails closed', async metadata => {
  mockSend.mockResolvedValueOnce(pendingTemplate).mockRejectedValueOnce(new Error('503'));
  mockReconcile.mockResolvedValue({ ...pendingTemplate, ...metadata });
  expect(await sendChannelMessageFromAgentWorkflow(templateParams)).toMatchObject({ success: false, template_pending: false });
  expect(mockSend).toHaveBeenCalledTimes(2);
});
it('503 poll -> durable pending read -> next poll sent uses same saved identity', async () => {
  mockSend.mockResolvedValueOnce(pendingTemplate).mockRejectedValueOnce(new Error('503'))
    .mockResolvedValueOnce({ success: true, status: 'sent', delivery_format: 'template',
      template_used: true, messageId: 'provider', delivery_status: 'accepted' });
  mockReconcile.mockResolvedValue({ ...pendingTemplate, recovery_action: 'resume', template_state: 'pending' });
  expect(await sendChannelMessageFromAgentWorkflow(templateParams)).toMatchObject({
    success: true, status: 'sent', delivery_status: 'accepted' });
  expect(mockReconcile).toHaveBeenCalledWith({ site_id: 'site', conversation_id: 'conversation', message_id: 'message' });
  expect(mockSend.mock.calls).toEqual(Array(3).fill([templateParams]));
});
it.each(['dispatching', 'unknown', 'submitting', 'rejected', 'failed'])('read %s stops without another POST', async state => {
  mockSend.mockResolvedValueOnce(pendingTemplate).mockRejectedValueOnce(new Error('503'));
  mockReconcile.mockResolvedValue({ ...pendingTemplate, recovery_action: 'stop', template_state: state,
    status: ['failed', 'rejected'].includes(state) ? 'failed' : 'placement_unknown', template_pending: false });
  expect(await sendChannelMessageFromAgentWorkflow(templateParams)).toMatchObject({ success: false, template_pending: false });
  expect(mockSend).toHaveBeenCalledTimes(2);
});
it.each(['accepted', 'sent', 'delivered', 'read'])('read %s completes without another POST and preserves delivery status', async state => {
  mockSend.mockResolvedValueOnce(pendingTemplate).mockRejectedValueOnce(new Error('503'));
  mockReconcile.mockResolvedValue({ ...pendingTemplate, recovery_action: 'complete', template_state: state,
    delivery_status: state, local_message_id: 'message', message_id: 'provider', messageId: 'provider' });
  expect(await sendChannelMessageFromAgentWorkflow(templateParams)).toMatchObject({
    success: true, messageId: 'provider', template_pending: false, delivery_status: state });
  expect(mockSend).toHaveBeenCalledTimes(2);
});
it('prior polling patch retains original timer schedule without recovery patch', async () => {
  (patched as jest.Mock).mockImplementation(id => id !== 'template-poll-read-reconciliation-v1');
  mockSend.mockResolvedValue(pendingTemplate);
  await sendChannelMessageFromAgentWorkflow(templateParams);
  expect((sleep as jest.Mock).mock.calls.map(([delay]) => delay)).toEqual(['1 minute', '30 minutes', '1 hour', '6 hours', '8 hours', '9 hours']);
  expect(mockReconcile).not.toHaveBeenCalled();
  expect(mockMark).not.toHaveBeenCalled();
});
it('prior polling patch failure adds neither a read nor control command', async () => {
  (patched as jest.Mock).mockImplementation(id => id !== 'template-poll-read-reconciliation-v1');
  mockSend.mockResolvedValueOnce(pendingTemplate).mockRejectedValueOnce(new Error('503'));
  await expect(sendChannelMessageFromAgentWorkflow(templateParams)).rejects.toMatchObject({ nonRetryable: true });
  expect(mockSend).toHaveBeenCalledTimes(2);
  expect(mockReconcile).not.toHaveBeenCalled();
  expect(mockMark).not.toHaveBeenCalled();
});
it('old channel histories never add polling timers', async () => {
  (patched as jest.Mock).mockReturnValue(false);
  mockSend.mockResolvedValue(pendingTemplate);
  await sendChannelMessageFromAgentWorkflow(templateParams);
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});
it('uses one attempt for explicit channel audio and normal retry proxy for omission', async () => {
  await sendChannelMessageFromAgentWorkflow({ ...common, channel: 'telegram', to: '123', response_format: 'audio' });
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ response_format: 'audio', message_id: 'message' }));
  expect(mockLegacySend).not.toHaveBeenCalled();
  await sendChannelMessageFromAgentWorkflow({ ...common, channel: 'telegram', to: '123' });
  expect(mockLegacySend).toHaveBeenCalledTimes(1);
});
it('audio template response never creates a template, deletes a message or overwrites the HTTP receipt', async () => {
  mockSend.mockResolvedValue({ success: true, template_required: true });
  await expect(sendWhatsappFromAgent({ ...common, phone_number: '+15555550100', response_format: 'audio' }))
    .rejects.toMatchObject({ type: 'AUDIO_TEMPLATE_REQUIRED', nonRetryable: true });
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ response_format: 'audio', message_id: 'message' }));
  expect(mockLegacySend).not.toHaveBeenCalled();
  expect(mockTemplate).not.toHaveBeenCalled();
  expect(mockCleanup).not.toHaveBeenCalled();
  expect(mockStatus).not.toHaveBeenCalled();
});
it('legacy WhatsApp command retains its old argument shape', async () => {
  (patched as jest.Mock).mockReturnValue(false);
  await sendWhatsappFromAgent({ ...common, phone_number: '+15555550100' });
  expect(mockLegacySend).toHaveBeenCalledTimes(1);
  expect(mockLegacySend.mock.calls[0][0]).not.toHaveProperty('response_format');
  expect(mockLegacySend.mock.calls[0][0]).not.toHaveProperty('message_id');
});

it('makes ambiguous activity timeout terminal for workflow-level retries as well', async () => {
  mockSend.mockRejectedValue(new Error('Activity timed out'));
  await expect(sendChannelMessageFromAgentWorkflow({ ...common, channel: 'telegram', to: '123', response_format: 'audio' }))
    .rejects.toMatchObject({ type: 'AUDIO_DELIVERY_FAILED_OR_UNKNOWN', nonRetryable: true });
  await expect(sendWhatsappFromAgent({ ...common, phone_number: '+15555550100', response_format: 'audio' }))
    .rejects.toMatchObject({ type: 'AUDIO_DELIVERY_FAILED_OR_UNKNOWN', nonRetryable: true });
  expect(mockStatus).not.toHaveBeenCalled();
  expect(mockCleanup).not.toHaveBeenCalled();
});

it('sends channel media-only through one-attempt proxy without a text command', async () => {
  await sendChannelMessageFromAgentWorkflow({ ...common, message: '', channel: 'telegram', to: '123',
    message_type: 'image', media_url: 'https://assets.example.test/a.jpg' });
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ message: '', message_type: 'image', media_url: 'https://assets.example.test/a.jpg' }));
  expect(mockLegacySend).not.toHaveBeenCalled();
});

it('refreshes saved WhatsApp media-only metadata and does not retry/template/cleanup an ambiguous send', async () => {
  const media = { message_type: 'image' as const, media_url: 'https://assets.example.test/latest.jpg' };
  mockFetch.mockResolvedValue({ content: '', custom_data: media });
  mockSend.mockRejectedValueOnce(new Error('timeout'));
  await expect(sendWhatsappFromAgent({ ...common, message: '', phone_number: '+15555550100',
    message_type: 'image', media_url: 'https://assets.example.test/original.jpg' }))
    .rejects.toMatchObject({ type: 'MEDIA_DELIVERY_FAILED_OR_UNKNOWN', nonRetryable: true });
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ message: '', ...media }));
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockLegacySend).not.toHaveBeenCalled();
  expect(mockTemplate).not.toHaveBeenCalled();
  expect(mockStatus).not.toHaveBeenCalled();
  expect(mockCleanup).not.toHaveBeenCalled();
});

it('keeps pre-media replay branch on legacy channel retry proxy', async () => {
  (patched as jest.Mock).mockImplementation(id => id !== 'send-channel-outbound-media-v1');
  await sendChannelMessageFromAgentWorkflow({ ...common, channel: 'telegram', to: '123' });
  expect(mockLegacySend).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalled();
});
it('email media-only uses one attempt and does not overwrite receipts after an unknown delivery', async () => {
  mockSend.mockRejectedValueOnce(new Error('timeout'));
  await expect(sendEmailFromAgent({ ...common, message: '', email: 'recipient@example.test', subject: 'File',
    message_type: 'document', media_url: 'https://assets.example.test/a.pdf' }))
    .rejects.toMatchObject({ nonRetryable: true, type: 'MEDIA_DELIVERY_FAILED_OR_UNKNOWN' });
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ message: '', media_url: 'https://assets.example.test/a.pdf', message_type: 'document' }));
  expect(mockLegacySend).not.toHaveBeenCalled();
  expect(mockStatus).not.toHaveBeenCalled();
});
it('email old histories retain legacy argument shape and retry proxy', async () => {
  (patched as jest.Mock).mockReturnValue(false);
  await sendEmailFromAgent({ ...common, email: 'recipient@example.test', subject: 'Hello' });
  expect(mockLegacySend).toHaveBeenCalledTimes(1);
  expect(mockLegacySend.mock.calls[0][0]).not.toHaveProperty('media_url');
  expect(mockLegacySend.mock.calls[0][0]).not.toHaveProperty('message_id');
  expect(mockSend).not.toHaveBeenCalled();
});