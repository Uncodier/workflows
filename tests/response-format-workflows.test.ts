const mockSend = jest.fn();
const mockLegacySend = jest.fn();
const mockFetch = jest.fn();
const mockStatus = jest.fn();
const mockCleanup = jest.fn();
const mockTemplate = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'),
  proxyActivities: (options: any) => ({
    sendWhatsAppFromAgentActivity: options.retry.maximumAttempts === 1 ? mockSend : mockLegacySend,
    sendChannelMessageFromAgentActivity: options.retry.maximumAttempts === 1 ? mockSend : mockLegacySend,
    fetchRecordByTableAndIdActivity: mockFetch,
    updateMessageStatusToSentActivity: mockStatus,
    cleanupFailedFollowUpActivity: mockCleanup,
    createTemplateActivity: mockTemplate,
  }),
  upsertSearchAttributes: jest.fn(),
}));
import { sendWhatsappFromAgent } from '../src/temporal/workflows/sendWhatsappFromAgentWorkflow';
import { sendChannelMessageFromAgentWorkflow } from '../src/temporal/workflows/sendChannelMessageFromAgentWorkflow';

const common = { site_id: 'site', message: 'Hello', message_id: 'message', conversation_id: 'conversation', lead_id: 'lead' };
beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({ content: 'Refreshed hello' });
  mockSend.mockResolvedValue({ success: true, messageId: 'message' });
  mockLegacySend.mockResolvedValue({ success: true, messageId: 'message' });
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