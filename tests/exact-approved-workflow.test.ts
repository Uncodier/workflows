const mockActivities: Record<string, jest.Mock> = {
  resetStuckSendingMessagesActivity: jest.fn(), getApprovedMessagesActivity: jest.fn(),
  claimApprovedMessagesBatchActivity: jest.fn(), sendOutreachMessageActivity: jest.fn(),
  sendExactQueuedMessageActivity: jest.fn(), deferOutreachMessageActivity: jest.fn(), sendEmailFromAgentActivity: jest.fn(),
  updateMessageStatusToSentActivity: jest.fn(), updateMessageTimestampActivity: jest.fn(),
  updateConversationStatusAfterFollowUpActivity: jest.fn(), updateTaskStatusToCompletedActivity: jest.fn(),
  cleanupFailedFollowUpActivity: jest.fn(),
};
jest.mock('@temporalio/workflow', () => ({ proxyActivities: () => mockActivities, patched: () => true,
  startChild: jest.fn(), ParentClosePolicy: {} }));
jest.mock('../src/temporal/workflows/sendWhatsappFromAgentWorkflow', () => ({ sendWhatsappFromAgent: jest.fn() }));
jest.mock('../src/temporal/workflows/sendChannelMessageFromAgentWorkflow', () => ({ sendChannelMessageFromAgentWorkflow: jest.fn() }));
jest.mock('../src/temporal/workflows/sendVoiceCallFromAgentWorkflow', () => ({ sendVoiceCallFromAgentWorkflow: jest.fn() }));
import { sendApprovedMessagesWorkflow } from '../src/temporal/workflows/sendApprovedMessagesWorkflow';
import { startChild } from '@temporalio/workflow';

const proposal = (channel: string, connectionId: unknown = 'selected') => ({
  message_id: 'message', conversation_id: 'conversation', site_id: 'site', lead_id: 'lead', content: 'Hello',
  custom_data: { channel, connection_id: connectionId, voice_mode: 'agent_call' },
});
beforeEach(() => {
  jest.clearAllMocks();
  mockActivities.resetStuckSendingMessagesActivity.mockResolvedValue({ resetCount: 0 });
  mockActivities.claimApprovedMessagesBatchActivity.mockResolvedValue(['message']);
  mockActivities.sendExactQueuedMessageActivity.mockResolvedValue({ success: true, messageId: 'provider-id', recipient: 'known-recipient' });
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