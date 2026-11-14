const mockActivities: Record<string, jest.Mock> = {
  checkConversationAutomationActivity: jest.fn(),
  resetStuckSendingMessagesActivity: jest.fn(), getApprovedMessagesActivity: jest.fn(),
  claimApprovedMessagesBatchActivity: jest.fn(), sendOutreachMessageActivity: jest.fn(),
  sendExactQueuedMessageActivity: jest.fn(), deferOutreachMessageActivity: jest.fn(), sendEmailFromAgentActivity: jest.fn(),
  sendChannelMessageFromAgentActivity: jest.fn(),
  sendWhatsAppFromAgentActivity: jest.fn(),
  updateMessageStatusToSentActivity: jest.fn(), updateMessageTimestampActivity: jest.fn(),
  updateConversationStatusAfterFollowUpActivity: jest.fn(), updateTaskStatusToCompletedActivity: jest.fn(),
  cleanupFailedFollowUpActivity: jest.fn(),
  reconcileTemplateDeliveryActivity: jest.fn(),
  markTemplateReconciliationRequiredActivity: jest.fn(),
};
const mockPatched = jest.fn(() => true);
const mockExactOptions = jest.fn();
const mockDmOptions = jest.fn();
const mockLegacyMediaOptions = jest.fn();
jest.mock('@temporalio/workflow', () => ({ ...jest.requireActual('@temporalio/workflow'), proxyActivities: (options: any) => ({ ...mockActivities,
  sendExactQueuedMessageActivity: (...args: any[]) => {
    mockExactOptions(options);
    return mockActivities.sendExactQueuedMessageActivity(...args);
  },
  sendChannelMessageFromAgentActivity: (...args: any[]) => {
    mockDmOptions(options);
    return mockActivities.sendChannelMessageFromAgentActivity(...args);
  },
  sendWhatsAppFromAgentActivity: (...args: any[]) => {
    mockLegacyMediaOptions(options);
    return mockActivities.sendWhatsAppFromAgentActivity(...args);
  },
  sendEmailFromAgentActivity: (...args: any[]) => {
    mockLegacyMediaOptions(options);
    return mockActivities.sendEmailFromAgentActivity(...args);
  },
}), patched: mockPatched,
  startChild: jest.fn(), sleep: jest.fn(), ParentClosePolicy: {} }));
jest.mock('../src/temporal/workflows/sendWhatsappFromAgentWorkflow', () => ({ sendWhatsappFromAgent: jest.fn() }));
jest.mock('../src/temporal/workflows/sendChannelMessageFromAgentWorkflow', () => ({ sendChannelMessageFromAgentWorkflow: jest.fn() }));
jest.mock('../src/temporal/workflows/sendVoiceCallFromAgentWorkflow', () => ({ sendVoiceCallFromAgentWorkflow: jest.fn() }));
import { sendApprovedMessagesWorkflow } from '../src/temporal/workflows/sendApprovedMessagesWorkflow';
import { startChild, sleep } from '@temporalio/workflow';

const proposal = (channel: string, connectionId: unknown = 'selected') => ({
  message_id: 'message', conversation_id: 'conversation', site_id: 'site', lead_id: 'lead', content: 'Hello',
  custom_data: { channel, connection_id: connectionId, voice_mode: 'agent_call' },
});

const queuedAudio = () => ({ ...proposal('whatsapp'), custom_data: {
  channel: 'whatsapp', connection_id: 'selected', response_format: 'audio' } });
test('approved media-only uses exact saved-record delivery once, without child/text fallback or cleanup', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...proposal('telegram'), content: '', custom_data: {
    channel: 'telegram', message_type: 'image', media_url: 'https://assets.example.test/a.jpg' } }]);
  mockActivities.sendExactQueuedMessageActivity.mockRejectedValueOnce(new Error('timeout'));
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 1 });
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalledWith({ site_id: 'site', message_id: 'message', conversation_id: 'conversation', channel: 'telegram', existing_media: true });
  expect(mockExactOptions.mock.calls[0][0].retry.maximumAttempts).toBe(1);
  expect(startChild).not.toHaveBeenCalled();
  expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
  expect(mockActivities.deferOutreachMessageActivity).not.toHaveBeenCalled();
});
test('managed outreach media retains the central outreach policy and lease boundary', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...proposal('telegram'), content: '', custom_data: {
    channel: 'telegram', outreach_activity: 'lead_outreach', message_type: 'image', media_url: 'https://assets.example.test/a.jpg' } }]);
  mockActivities.sendOutreachMessageActivity.mockResolvedValueOnce({ success: true, messageId: 'provider' });
  await sendApprovedMessagesWorkflow();
  expect(mockActivities.sendOutreachMessageActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.sendExactQueuedMessageActivity).not.toHaveBeenCalled();
  expect(startChild).not.toHaveBeenCalled();
});
test('approved Outstand Instagram media without a Zavu connection uses one scoped native DM send and stays pending', async () => {
  const media = { message_type: 'image', media_url: 'https://assets.example.test/a.jpg', mime_type: 'image/jpeg' };
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...proposal('instagram'), content: '', custom_data: { channel: 'instagram', ...media } }]);
  mockActivities.sendChannelMessageFromAgentActivity.mockResolvedValueOnce({ success: true, messageId: 'outstand-provider' });
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 0, pending: 1 });
  expect(mockActivities.sendChannelMessageFromAgentActivity).toHaveBeenCalledWith(expect.objectContaining({ channel: 'instagram', message: '',
    site_id: 'site', message_id: 'message', conversation_id: 'conversation', ...media }));
  expect(mockDmOptions.mock.calls[0][0].retry.maximumAttempts).toBe(1);
  expect(mockActivities.sendExactQueuedMessageActivity).not.toHaveBeenCalled();
  expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
  expect(mockActivities.updateTaskStatusToCompletedActivity).not.toHaveBeenCalled();
});
test('unknown approved Outstand DM send is not retried through exact, child, or text', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...proposal('instagram'), content: '', custom_data: {
    channel: 'instagram', message_type: 'video', media_url: 'https://assets.example.test/a.mp4' } }]);
  mockActivities.sendChannelMessageFromAgentActivity.mockRejectedValueOnce(new Error('timeout'));
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 1 });
  expect(mockActivities.sendChannelMessageFromAgentActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.sendExactQueuedMessageActivity).not.toHaveBeenCalled();
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
  expect(startChild).not.toHaveBeenCalled();
});
test.each(['whatsapp', 'email'])('approved legacy %s media-only uses current adapter once with saved identity', async channel => {
  const activity = channel === 'whatsapp' ? mockActivities.sendWhatsAppFromAgentActivity : mockActivities.sendEmailFromAgentActivity;
  const media = { message_type: 'document', media_url: 'https://assets.example.test/a.pdf', mime_type: 'application/pdf' };
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...proposal(channel), content: '', lead_phone: '+15555550100', lead_email: 'recipient@example.test',
    custom_data: { channel, ...media } }]);
  activity.mockResolvedValueOnce({ success: true, messageId: 'provider' });
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 1, failed: 0 });
  expect(activity).toHaveBeenCalledWith(expect.objectContaining({ site_id: 'site', message_id: 'message', conversation_id: 'conversation', message: '', ...media }));
  expect(mockLegacyMediaOptions.mock.calls[0][0].retry.maximumAttempts).toBe(1);
  expect(mockActivities.sendExactQueuedMessageActivity).not.toHaveBeenCalled();
  expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
  expect(startChild).not.toHaveBeenCalled();
});
test('legacy WhatsApp media never substitutes a text template after adapter refusal', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...proposal('whatsapp'), content: '', custom_data: {
    channel: 'whatsapp', message_type: 'image', media_url: 'https://assets.example.test/a.jpg' } }]);
  mockActivities.sendWhatsAppFromAgentActivity.mockResolvedValueOnce({ success: true, messageId: 'saved', template_required: true });
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 1 });
  expect(mockActivities.sendWhatsAppFromAgentActivity).toHaveBeenCalledTimes(1);
  expect(startChild).not.toHaveBeenCalled();
  expect(mockActivities.sendExactQueuedMessageActivity).not.toHaveBeenCalled();
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
});
test('saved Zavu media with missing connection never guesses a legacy adapter', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...proposal('whatsapp'), content: '', custom_data: {
    channel: 'whatsapp', channel_delivery: { provider: 'zavu' }, message_type: 'image', media_url: 'https://assets.example.test/a.jpg' } }]);
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 1 });
  expect(mockActivities.sendWhatsAppFromAgentActivity).not.toHaveBeenCalled();
  expect(mockActivities.sendExactQueuedMessageActivity).not.toHaveBeenCalled();
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
});
const pending = { success: true, status: 'template_pending', template_pending: true,
  delivery_format: 'template', requested_response_format: 'audio', message_id: 'message', template_id: 'template' };
test('exact queued pending polls and only completes once after API acceptance', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([queuedAudio()]);
  mockActivities.sendExactQueuedMessageActivity.mockResolvedValueOnce(pending).mockResolvedValueOnce({
    success: true, status: 'sent', delivery_format: 'template', requested_response_format: 'audio',
    template_used: true, messageId: 'provider' });
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 1, failed: 0, pending: 0 });
  expect(mockActivities.sendExactQueuedMessageActivity.mock.calls).toEqual(Array(2).fill([{
    site_id: 'site', message_id: 'message', conversation_id: 'conversation', channel: 'whatsapp', response_format: 'audio' }]));
  expect(mockActivities.updateMessageStatusToSentActivity).toHaveBeenCalledTimes(1);
  expect(mockExactOptions.mock.calls.every(([options]) => options.retry.maximumAttempts === 1)).toBe(true);
  expect(mockActivities.updateMessageStatusToSentActivity).toHaveBeenCalledWith(expect.objectContaining({
    delivery_details: expect.objectContaining({ delivery_format: 'template', template_used: true, status: 'sent' }) }));
  expect(startChild).not.toHaveBeenCalled();
});
test('exact pending exhaustion exposes unconfirmed and does not mark sent, defer or complete', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([queuedAudio()]);
  mockActivities.sendExactQueuedMessageActivity.mockResolvedValue(pending);
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 1, pending: 0, deferred: 0,
    needs_reconciliation: [expect.objectContaining({ needs_reconciliation: true, template_pending: false })] });
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalledTimes(27);
  expect(sleep).toHaveBeenCalledTimes(26);
  expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
  expect(mockActivities.updateTaskStatusToCompletedActivity).not.toHaveBeenCalled();
  expect(mockActivities.deferOutreachMessageActivity).not.toHaveBeenCalled();
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
});
test('exact uncertain response is not deferred to another send', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([queuedAudio()]);
  mockActivities.sendExactQueuedMessageActivity.mockRejectedValueOnce(new Error('timeout'));
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 1, pending: 0 });
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.deferOutreachMessageActivity).not.toHaveBeenCalled();
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
});
test('exact pending poll recovers only from read pending and completes once', async () => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([queuedAudio()]);
  mockActivities.sendExactQueuedMessageActivity.mockResolvedValueOnce(pending).mockRejectedValueOnce(new Error('503'))
    .mockResolvedValueOnce({ success: true, status: 'sent', delivery_format: 'template', template_used: true,
      messageId: 'provider', delivery_status: 'accepted' });
  mockActivities.reconcileTemplateDeliveryActivity.mockResolvedValue({ ...pending,
    recovery_action: 'resume', template_state: 'pending' });
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 1, failed: 0, pending: 0 });
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalledTimes(3);
  expect(mockActivities.updateMessageStatusToSentActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.deferOutreachMessageActivity).not.toHaveBeenCalled();
});
test.each(['outage', 'dispatching', 'unknown', 'rejected'])('exact failed poll read %s never resets or repeats', async state => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([queuedAudio()]);
  mockActivities.sendExactQueuedMessageActivity.mockResolvedValueOnce(pending).mockRejectedValueOnce(new Error('503'));
  if (state === 'outage') mockActivities.reconcileTemplateDeliveryActivity.mockRejectedValue(new Error('retry limit reached'));
  else mockActivities.reconcileTemplateDeliveryActivity.mockResolvedValue({ ...pending,
    recovery_action: 'stop', template_state: state });
  const result = await sendApprovedMessagesWorkflow();
  expect(result).toMatchObject({ success: 0, failed: 1, pending: 0, deferred: 0 });
  if (state !== 'rejected') expect(result.needs_reconciliation).toEqual([expect.objectContaining({
    message_id: 'message', template_id: 'template', status: 'needs_reconciliation', template_pending: false })]);
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalledTimes(2);
  for (const name of ['updateMessageStatusToSentActivity', 'updateTaskStatusToCompletedActivity',
    'deferOutreachMessageActivity', 'cleanupFailedFollowUpActivity']) expect(mockActivities[name]).not.toHaveBeenCalled();
});
test('old exact histories retain old arguments and never add polling', async () => {
  mockPatched.mockImplementation((...args: unknown[]) => args[0] !== 'approved-audio-template-polling-v1');
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([queuedAudio()]);
  await sendApprovedMessagesWorkflow();
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalledWith({ site_id: 'site', message_id: 'message',
    conversation_id: 'conversation', channel: 'whatsapp' });
  expect(sleep).not.toHaveBeenCalled();
  expect(mockExactOptions.mock.calls[0][0].retry.maximumAttempts).not.toBe(1);
});
beforeEach(() => {
  jest.clearAllMocks();
  mockPatched.mockReturnValue(true);
  mockActivities.checkConversationAutomationActivity.mockResolvedValue({ success: true });
    mockActivities.resetStuckSendingMessagesActivity.mockResolvedValue({ resetCount: 0 });
  mockActivities.claimApprovedMessagesBatchActivity.mockResolvedValue(['message']);
  mockActivities.sendExactQueuedMessageActivity.mockResolvedValue({ success: true, messageId: 'provider-id', recipient: 'known-recipient' });
});
test.each(['whatsapp', 'telegram', 'messenger'])('approved %s propagates stored response format', async channel => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{
    ...proposal(channel), lead_phone: '+15555550100', custom_data: { channel, response_format: 'audio' },
  }]);
  await sendApprovedMessagesWorkflow();
  expect(startChild).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    args: [expect.objectContaining({ response_format: 'audio', message_id: 'message' })],
  }));
});
test('old approval histories do not add response_format to child commands', async () => {
  mockPatched.mockImplementation((...args: unknown[]) => args[0] !== 'approved-message-response-format-v1');
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{
    ...proposal('whatsapp'), lead_phone: '+15555550100', custom_data: { channel: 'whatsapp', response_format: 'audio' },
  }]);
  await sendApprovedMessagesWorkflow();
  expect((startChild as jest.Mock).mock.calls[0][1].args[0]).not.toHaveProperty('response_format');
});

test('Messenger audio with a saved connection uses channel child and retains pinned metadata', async () => {
  const custom_data = { channel: 'messenger', connection_id: 'pinned-account', response_format: 'audio' };
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{
    ...proposal('messenger'), lead_phone: '123456', custom_data,
  }]);
  await sendApprovedMessagesWorkflow();
  expect(mockActivities.sendExactQueuedMessageActivity).not.toHaveBeenCalled();
  expect(startChild).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    args: [expect.objectContaining({ channel: 'messenger', response_format: 'audio', message_id: 'message', custom_data })],
  }));
});

test.each(['text', undefined])('Messenger format=%s preserves exact connection routing', async response_format => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{
    ...proposal('messenger'), lead_phone: '123456',
    custom_data: { channel: 'messenger', connection_id: 'pinned-account', response_format },
  }]);
  await sendApprovedMessagesWorkflow();
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalled();
  expect(startChild).not.toHaveBeenCalled();
});

test('old patch branch retains exact routing for Messenger audio', async () => {
  mockPatched.mockImplementation((...args: unknown[]) => args[0] !== 'approved-message-response-format-v1');
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{
    ...proposal('messenger'), lead_phone: '123456',
    custom_data: { channel: 'messenger', connection_id: 'pinned-account', response_format: 'audio' },
  }]);
  await sendApprovedMessagesWorkflow();
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalled();
  expect(startChild).not.toHaveBeenCalled();
});
test.each(['email', 'whatsapp', 'sms', 'voice', 'telegram'])('approved %s uses exact stored API dispatch and no default child', async channel => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([proposal(channel)]);
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 1, failed: 0 });
  expect(mockActivities.sendExactQueuedMessageActivity).toHaveBeenCalledWith({ site_id: 'site', message_id: 'message', conversation_id: 'conversation', channel });
  expect(startChild).not.toHaveBeenCalled(); expect(mockActivities.sendEmailFromAgentActivity).not.toHaveBeenCalled();
  if (channel === 'voice') expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
  else expect(mockActivities.updateMessageStatusToSentActivity).toHaveBeenCalledWith(expect.objectContaining({ delivery_channel: channel, delivery_success: true }));
});
test.each(['', null, 'removed'])('invalid %s connection never falls back or invalidates recipient', async id => {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([proposal('email', id)]);
  mockActivities.sendExactQueuedMessageActivity.mockResolvedValue({ success: false, reason: 'Exact unavailable' });
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 0, deferred: 1 });
  expect(mockActivities.deferOutreachMessageActivity).toHaveBeenCalled();
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
  expect(mockActivities.sendEmailFromAgentActivity).not.toHaveBeenCalled(); expect(startChild).not.toHaveBeenCalled();
});